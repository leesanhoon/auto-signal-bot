import type { TradeSetup } from "./chart-types-smc.js";
import { fetchLastPrice } from "./ohlc-provider.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:signal-freshness");

export type SetupWithFreshness = TradeSetup & {
  noSetupReason?: string;
};

function isFeatureEnabled(): boolean {
  const val = process.env.SIGNAL_FRESHNESS_GUARD_ENABLED;
  if (val === undefined || val === "true") return true;
  return val !== "false" && val !== "0";
}

function parsePrice(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value: number): string {
  const precision = value >= 1000 ? 2 : value >= 100 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(precision);
}

export async function applySignalFreshnessGuard(
  setup: TradeSetup,
  symbol: string,
): Promise<SetupWithFreshness> {
  if (!isFeatureEnabled()) {
    return setup as SetupWithFreshness;
  }

  if (!symbol) {
    logger.warn(`Khong xac dinh duoc symbol cho ${setup.pair}`);
    return setup as SetupWithFreshness;
  }

  const lastPrice = await fetchLastPrice(symbol);

  if (lastPrice instanceof Error) {
    logger.warn(`Khong xac minh duoc gia hien tai cho ${symbol}: ${lastPrice.message}`);
    return setup as SetupWithFreshness;
  }

  const entry = parsePrice(setup.entry);
  const stopLoss = parsePrice(setup.stopLoss);
  const takeProfit1 = parsePrice(setup.takeProfit1);

  if (entry === null || stopLoss === null || takeProfit1 === null) {
    return setup as SetupWithFreshness;
  }

  const isStale = isSetupStale(setup.direction, lastPrice, stopLoss, takeProfit1);

  if (isStale) {
    const reason =
      `Gia da vuot TP1/SL (check gia tuc: ${formatPrice(lastPrice)}). ` +
      `Entry: ${formatPrice(entry)}, TP1: ${formatPrice(takeProfit1)}, SL: ${formatPrice(stopLoss)}.`;

    return {
      ...setup,
      noSetupReason: reason,
    };
  }

  return setup as SetupWithFreshness;
}

function isSetupStale(
  direction: "LONG" | "SHORT",
  lastPrice: number,
  stopLoss: number,
  takeProfit1: number,
): boolean {
  if (direction === "LONG") {
    return lastPrice >= takeProfit1 || lastPrice <= stopLoss;
  } else {
    return lastPrice <= takeProfit1 || lastPrice >= stopLoss;
  }
}
