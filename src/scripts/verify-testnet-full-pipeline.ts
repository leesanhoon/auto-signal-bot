/**
 * Automated verification of tasks/binance-full-order-type-support Steps 3 (fill -> SL/TP)
 * and 4 (expiry -> cancel) against REAL Binance Futures TESTNET orders, using the REAL
 * production execution logic (createOpenBinanceFuturesPosition / createPollPendingEntryOrder
 * from binance-execution-shared.ts) — but with an IN-MEMORY position store instead of
 * production Supabase, so no test data is written to the real DB.
 *
 * Refuses to run against a non-testnet base URL (same guard as verify-testnet-order-types.ts).
 *
 * Telegram: uses the REAL configured bot/chat (Step 7 verification), with message prefixes
 * clearly marked "[TEST]" so they're distinguishable from real trading alerts.
 *
 * NOT covered (documented, not automated):
 *  - Step 5 (partial fill): requires a live order to be PARTIALLY matched, which needs
 *    counter-liquidity at an exact quantity — not reliably forceable via a single API key
 *    on a public testnet order book. Verified instead via code review + unit tests
 *    (tests/charts/binance-execution-shared.test.ts) asserting the partial-fill branch
 *    uses the real executedQty.
 *  - Step 6 (MARKET_NOW regression): not re-tested live here since entryExecutionMode
 *    defaults to MARKET_ONLY and this script never touches that flag; covered by the
 *    existing test suite (884+ tests) and the fact this script uses a fresh HONOR_ORDER_TYPE
 *    config object, not the real MARKET_ONLY default path.
 */
import { existsSync, readFileSync } from "fs";
import type {
  BinanceExecutionSystemConfig,
  BinanceEntryOrderDetails,
  PendingEntryOrderPosition,
  BinanceExecutionDetails,
} from "../charts/binance-execution-shared.js";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    process.env[key] = value;
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
  const chartSymbol = `BINANCE:${symbol}`;

  const baseUrl = process.env.BINANCE_FUTURES_BASE_URL ?? "";
  if (!baseUrl.includes("testnet")) {
    console.error(
      `Tu choi chay: BINANCE_FUTURES_BASE_URL="${baseUrl}" khong chua "testnet".`,
    );
    process.exit(1);
  }
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    console.error(`Thieu BINANCE_API_KEY/BINANCE_API_SECRET trong ${envFile}.`);
    process.exit(1);
  }

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Symbol: ${symbol}\n`);

  const { createOpenBinanceFuturesPosition, createPollPendingEntryOrder } = await import(
    "../charts/binance-execution-shared.js"
  );
  const { getExchangeInfoFilters, getPositionAmount, placeMarketOrder, cancelOrder } =
    await import("../charts/binance-futures-client.js");
  const { roundToTickSize } = await import("../charts/binance-position-sizing.js");

  // --- in-memory "DB" (no Supabase writes) ---
  const pendingEntryOrders = new Map<number, PendingEntryOrderPosition>();
  const executionDetails = new Map<number, BinanceExecutionDetails>();
  const entryOrderStatusLog: Array<{ positionId: number; status: string }> = [];

  function makeConfig(
    label: string,
  ): BinanceExecutionSystemConfig<
    { pair: string; direction: "LONG" | "SHORT"; orderType?: string },
    any,
    any
  > {
    return {
      systemLabel: "TEST-HARNESS",
      loggerName: "charts:verify-testnet-full-pipeline",
      calculateRiskRewardPlan: (setup: any) => setup.__plan,
      saveBinanceExecutionDetails: async (positionId, details) => {
        executionDetails.set(positionId, details);
      },
      entryExecutionMode: "HONOR_ORDER_TYPE",
      entryOrderExpiryMinutes: 60,
      saveBinancePendingEntryOrder: async (
        positionId: number,
        details: BinanceEntryOrderDetails,
      ) => {
        pendingEntryOrders.set(positionId, {
          id: positionId,
          pair: `[TEST]${symbol}`,
          binanceSymbol: details.binanceSymbol,
          binanceEntryOrderId: details.binanceEntryOrderId,
          binanceEntryOrderType: details.binanceEntryOrderType,
          binanceEntryOrderPlacedAt: new Date().toISOString(),
          direction: "LONG",
          stopLoss: String(currentPlan.stopLoss),
          takeProfit1: String(currentPlan.takeProfit1),
          binanceQuantity: details.binanceQuantity,
          binanceLeverage: details.binanceLeverage,
        });
      },
      updateBinanceEntryOrderStatus: async (positionId, status) => {
        entryOrderStatusLog.push({ positionId, status });
        const existing = pendingEntryOrders.get(positionId);
        if (existing && (status === "expired" || status === "filled")) {
          pendingEntryOrders.delete(positionId);
        }
      },
      getPendingEntryOrderPositions: async () => Array.from(pendingEntryOrders.values()),
      guardFailPrefix: `*[TEST ${label}]*`,
      failSafeMessagePrefix: `*[TEST ${label}]*`,
      failSafeEmergencyMessagePrefix: `*[TEST ${label}] — KHẨN CẤP*`,
      dbErrorPrefix: `*[TEST ${label}]*`,
      successPrefix: `*[TEST ${label}]*`,
      entryErrorPrefix: `*[TEST ${label}]*`,
      closeFailedUrgentPrefix: `*[TEST ${label}] — KHẨN CẤP nhắc lại*`,
      entryOrderExpiredPrefix: `*[TEST ${label}]*`,
      silentFailureWarnPrefix: `*[TEST ${label}]*`,
    };
  }

  let currentPlan: any;

  async function flattenSymbol(): Promise<void> {
    const amt = await getPositionAmount(symbol);
    if (amt instanceof Error || amt === 0) return;
    const side: "BUY" | "SELL" = amt > 0 ? "SELL" : "BUY";
    await placeMarketOrder(symbol, side, Math.abs(amt), { reduceOnly: true });
    console.log(`  (cleanup) flattened residual position ${amt} ${symbol}`);
  }

  const filters = await getExchangeInfoFilters(symbol);
  if (filters instanceof Error) {
    record("getExchangeInfoFilters", false, filters.message);
    return printSummaryAndExit();
  }
  const markResp = await fetch(`${baseUrl}/fapi/v1/premiumIndex?symbol=${symbol}`);
  const markJson = (await markResp.json()) as { markPrice?: string };
  const markPrice = Number(markJson.markPrice);
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    record("fetch mark price", false, "khong lay duoc mark price");
    return printSummaryAndExit();
  }
  console.log(`Mark price: ${markPrice}\n`);

  // Ensure a clean slate before starting (guard in production code refuses entry if
  // symbol already has a position from a prior run).
  await flattenSymbol();

  // ============================================================
  // Scenario A — Step 3: LIMIT entry that fills immediately, then poll -> SL/TP
  // ============================================================
  console.log("=== Scenario A: LIMIT fill -> SL/TP placement ===");
  {
    const configA = makeConfig("A-fill");
    const openPosition = createOpenBinanceFuturesPosition(configA);
    const pollPending = createPollPendingEntryOrder(configA);

    // Price above mark so a BUY LIMIT crosses the book and fills immediately (taker).
    const entryPrice = roundToTickSize(markPrice * 1.003, filters.tickSize);
    currentPlan = {
      entry: entryPrice,
      stopLoss: roundToTickSize(markPrice * 0.95, filters.tickSize),
      takeProfit1: roundToTickSize(markPrice * 1.05, filters.tickSize),
    };
    const setup = {
      pair: `[TEST]${symbol}`,
      direction: "LONG" as const,
      orderType: "BUY_LIMIT",
      __plan: currentPlan,
    };

    const positionId = 900001;
    await openPosition(setup, positionId, chartSymbol);

    const pending = pendingEntryOrders.get(positionId);
    record(
      "Step 3 setup: LIMIT entry order placed (crossing price)",
      !!pending,
      pending
        ? `orderId=${pending.binanceEntryOrderId} qty=${pending.binanceQuantity}`
        : "saveBinancePendingEntryOrder was not called — entry order placement failed, see logs above",
    );

    if (pending) {
      // Give the exchange a moment to report the fill, then poll (same as a cron cycle would).
      await new Promise((r) => setTimeout(r, 2000));
      await pollPending();

      const details = executionDetails.get(positionId);
      const statusEntry = entryOrderStatusLog.find((s) => s.positionId === positionId);
      record(
        "Step 3: entry order status transitioned to filled",
        statusEntry?.status === "filled",
        `status=${statusEntry?.status ?? "(no update recorded)"}`,
      );
      record(
        "Step 3: SL/TP orders placed on fill (placeProtectionOrdersAndFinalize)",
        !!details && details.binanceSlOrderId !== null && details.binanceTp1OrderId !== null,
        details
          ? `slOrderId=${details.binanceSlOrderId} tpOrderId=${details.binanceTp1OrderId} status=${details.binanceExecutionStatus} qty=${details.binanceQuantity}`
          : "no execution details recorded — SL/TP were not placed",
      );

      // Cleanup: cancel any leftover algo orders (SL/TP) and flatten the position.
      if (details?.binanceSlOrderId) await cancelOrder(symbol, details.binanceSlOrderId);
      if (details?.binanceTp1OrderId) await cancelOrder(symbol, details.binanceTp1OrderId);
      await flattenSymbol();
    }
  }

  // ============================================================
  // Scenario B — Step 4: STOP entry far from market, backdated -> expiry cancel
  // ============================================================
  console.log("\n=== Scenario B: STOP entry expiry -> cancel ===");
  {
    const configB = makeConfig("B-expiry");
    configB.entryOrderExpiryMinutes = 1;
    const openPosition = createOpenBinanceFuturesPosition(configB);
    const pollPending = createPollPendingEntryOrder(configB);

    const farStopPrice = roundToTickSize(markPrice * 1.3, filters.tickSize); // won't trigger
    currentPlan = {
      entry: farStopPrice,
      stopLoss: roundToTickSize(markPrice * 0.95, filters.tickSize),
      takeProfit1: roundToTickSize(markPrice * 1.4, filters.tickSize),
    };
    const setup = {
      pair: `[TEST]${symbol}`,
      direction: "LONG" as const,
      orderType: "BUY_STOP",
      __plan: currentPlan,
    };

    const positionId = 900002;
    await openPosition(setup, positionId, chartSymbol);

    const pending = pendingEntryOrders.get(positionId);
    record(
      "Step 4 setup: STOP_MARKET entry order placed (far from market)",
      !!pending,
      pending
        ? `orderId=${pending.binanceEntryOrderId} qty=${pending.binanceQuantity}`
        : "saveBinancePendingEntryOrder was not called",
    );

    if (pending) {
      // Backdate placedAt to simulate the 1-minute expiry having already elapsed,
      // instead of literally waiting — the poll logic only compares timestamps.
      pending.binanceEntryOrderPlacedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      await pollPending();

      const statusEntry = entryOrderStatusLog.find((s) => s.positionId === positionId);
      record(
        "Step 4: entry order status transitioned to expired",
        statusEntry?.status === "expired",
        `status=${statusEntry?.status ?? "(no update recorded)"}`,
      );

      // Verify the real order no longer exists as an open algo order on testnet.
      // Testnet has read-after-write lag on cancel confirmation — retry once before
      // failing (observed: "NEW" immediately after cancel, "CANCELED" ~1s later).
      const { getOrderStatus } = await import("../charts/binance-futures-client.js");
      let liveStatus = await getOrderStatus(symbol, pending.binanceEntryOrderId);
      if (!(liveStatus instanceof Error) && liveStatus.status !== "CANCELED") {
        await new Promise((r) => setTimeout(r, 2000));
        liveStatus = await getOrderStatus(symbol, pending.binanceEntryOrderId);
      }
      record(
        "Step 4: order actually cancelled on testnet",
        !(liveStatus instanceof Error) && liveStatus.status === "CANCELED",
        liveStatus instanceof Error ? liveStatus.message : `status=${liveStatus.status}`,
      );
    }
  }

  await flattenSymbol();
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
    "\nNOTE: Step 5 (partial fill) and Step 6/7 live regression are not covered by " +
      "this script — see file header comment for why.",
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Script crashed:", error);
  process.exit(1);
});
