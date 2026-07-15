/**
 * Verifies tasks/binance-full-order-type-support Steps 1, 2, 6 (client-level, no DB writes)
 * against a real Binance Futures TESTNET account, without touching production Supabase data.
 *
 * Usage:
 *   1. Create .env.testnet with BINANCE_API_KEY / BINANCE_API_SECRET (testnet keys, NOT prod)
 *      and BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com
 *   2. tsx src/scripts/verify-testnet-order-types.ts [SYMBOL]   (default SYMBOL=BTCUSDT)
 *
 * This script only calls the Binance client functions directly (placeLimitOrder,
 * placeStopMarketEntryOrder, getRegularOrderStatus/getOrderStatus, cancel*) — it does
 * NOT run the full pipeline, does NOT write to Supabase, and does NOT send Telegram
 * messages. It intentionally places orders far from market price so they never fill,
 * then cancels them. It refuses to run against a non-testnet base URL.
 *
 * Steps 3/4/5/7 (fill -> SL/TP, expiry auto-cancel via cron, partial fill, Telegram
 * alerts) require the full pipeline + real elapsed time / price movement and are NOT
 * covered here — see the manual checklist in
 * tasks/binance-full-order-type-support/06-config-docs-tests/result.md.
 */
import { existsSync, readFileSync } from "fs";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    process.env[key] = value; // overwrite — testnet file must win over any prior .env
  }
}

const envFile = process.env.TESTNET_ENV_FILE ?? ".env.testnet";
loadEnvFile(envFile);

type CheckResult = { name: string; ok: boolean; detail: string };
const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}: ${detail}`);
}

async function main(): Promise<void> {
  const symbol = process.argv[2] ?? "BTCUSDT";

  const baseUrl = process.env.BINANCE_FUTURES_BASE_URL ?? "";
  if (!baseUrl.includes("testnet")) {
    console.error(
      `Tu choi chay: BINANCE_FUTURES_BASE_URL="${baseUrl}" khong chua "testnet". ` +
        `Script nay CHI chay voi testnet de tranh dat lenh that. ` +
        `Kiem tra file ${envFile} co BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com`,
    );
    process.exit(1);
  }
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    console.error(
      `Thieu BINANCE_API_KEY/BINANCE_API_SECRET trong ${envFile}. Tao testnet API key tai https://testnet.binancefuture.com`,
    );
    process.exit(1);
  }

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Symbol: ${symbol}\n`);

  const {
    getExchangeInfoFilters,
    placeLimitOrder,
    placeStopMarketEntryOrder,
    getRegularOrderStatus,
    getOrderStatus,
    cancelRegularOrder,
    cancelOrder,
  } = await import("../charts/client/binance-futures-client.js");
  const { roundToTickSize } = await import("../charts/binance-position-sizing.js");

  const filters = await getExchangeInfoFilters(symbol);
  if (filters instanceof Error) {
    record("getExchangeInfoFilters", false, filters.message);
    return printSummaryAndExit();
  }
  record(
    "getExchangeInfoFilters",
    true,
    `tickSize=${filters.tickSize} stepSize=${filters.stepSize} minQty=${filters.minQty} minNotional=${filters.minNotional}`,
  );

  // Fetch current mark price so we can place orders far enough away to never fill.
  const markResp = await fetch(`${baseUrl}/fapi/v1/premiumIndex?symbol=${symbol}`);
  const markJson = (await markResp.json()) as { markPrice?: string };
  const markPrice = Number(markJson.markPrice);
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    record("fetch mark price", false, `khong lay duoc mark price: ${JSON.stringify(markJson)}`);
    return printSummaryAndExit();
  }
  record("fetch mark price", true, `markPrice=${markPrice}`);

  // 20% away from mark — safe distance so it stays NEW during this script's run.
  const farBuyLimitPrice = roundToTickSize(markPrice * 0.8, filters.tickSize);
  const farStopEntryPrice = roundToTickSize(markPrice * 1.2, filters.tickSize);

  // Size qty to clear MIN_NOTIONAL (with a 20% buffer) at the far-away test price,
  // rounded up to stepSize so it's never rejected for precision either.
  const decimalsOf = (step: number) => step.toString().split(".")[1]?.length ?? 0;
  const minQtyForNotional = (filters.minNotional * 1.2) / farBuyLimitPrice;
  const rawQty = Math.max(filters.minQty, minQtyForNotional);
  const qty = Number(
    (Math.ceil(rawQty / filters.stepSize) * filters.stepSize).toFixed(
      decimalsOf(filters.stepSize),
    ),
  );

  // --- Step 1 equivalent: BUY_LIMIT entry order ---
  const limitOrder = await placeLimitOrder(symbol, "BUY", farBuyLimitPrice, qty, {
    timeInForce: "GTC",
  });
  if (limitOrder instanceof Error) {
    record("Step 1: placeLimitOrder", false, limitOrder.message);
  } else {
    record(
      "Step 1: placeLimitOrder",
      true,
      `orderId=${limitOrder.orderId} status=${limitOrder.status} price=${farBuyLimitPrice} qty=${qty}`,
    );

    const status = await getRegularOrderStatus(symbol, limitOrder.orderId);
    if (status instanceof Error) {
      record("Step 1: getRegularOrderStatus", false, status.message);
    } else {
      record(
        "Step 1: getRegularOrderStatus",
        status.status === "NEW",
        `status=${status.status} executedQty=${status.executedQty} (expect NEW, unfilled)`,
      );
    }

    const cancelled = await cancelRegularOrder(symbol, limitOrder.orderId);
    record(
      "Step 1: cancelRegularOrder (cleanup)",
      cancelled === true,
      cancelled === true ? "cancelled ok" : String((cancelled as Error).message),
    );
  }

  // --- Step 2 equivalent: BUY_STOP entry order (algo) ---
  const stopOrder = await placeStopMarketEntryOrder(symbol, "BUY", farStopEntryPrice, qty);
  if (stopOrder instanceof Error) {
    record("Step 2: placeStopMarketEntryOrder", false, stopOrder.message);
  } else {
    record(
      "Step 2: placeStopMarketEntryOrder",
      true,
      `orderId(algoId)=${stopOrder.orderId} status=${stopOrder.status} triggerPrice=${farStopEntryPrice} qty=${qty}`,
    );

    const status = await getOrderStatus(symbol, stopOrder.orderId);
    if (status instanceof Error) {
      record("Step 2: getOrderStatus (algo)", false, status.message);
    } else {
      record(
        "Step 2: getOrderStatus (algo)",
        status.status === "NEW" || status.status === "ACCEPTED",
        `status=${status.status} (expect NEW/ACCEPTED, unfilled)`,
      );
    }

    const cancelled = await cancelOrder(symbol, stopOrder.orderId);
    record(
      "Step 2: cancelOrder (cleanup, algo)",
      cancelled === true,
      cancelled === true ? "cancelled ok" : String((cancelled as Error).message),
    );
  }

  return printSummaryAndExit();
}

function printSummaryAndExit(): never {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("\nFailed checks:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  console.log(
    "\nNOTE: Steps 3/4/5/7 (fill -> SL/TP, expiry, partial fill, Telegram) are NOT " +
      "covered by this script — they require the full pipeline + DB + real elapsed " +
      "time/price movement. Follow the manual checklist in " +
      "tasks/binance-full-order-type-support/06-config-docs-tests/result.md for those.",
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Script crashed:", error);
  process.exit(1);
});
