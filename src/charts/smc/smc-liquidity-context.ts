/**
 * Market context helpers cho SMC: premium/discount zone, liquidity levels, RVOL.
 * Pure functions, khong network/side-effect.
 */

import type { Candle } from "../ohlc-provider.js";
import type { SmcSwingPoint } from "./smc-types.js";

export type DealingRangeZone = {
  rangeLow: number;
  rangeHigh: number;
  /** % vi tri entry trong range, 0 = day range, 100 = dinh range. */
  percentInRange: number;
  zone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
};

export function findDealingRange(
  swings: SmcSwingPoint[],
  atIndex: number,
): { rangeLow: number; rangeHigh: number } | null {
  const priorSwings = swings.filter((s) => s.index < atIndex);
  const lastHigh = [...priorSwings]
    .filter((s) => s.kind === "HIGH")
    .sort((a, b) => b.index - a.index)[0];
  const lastLow = [...priorSwings]
    .filter((s) => s.kind === "LOW")
    .sort((a, b) => b.index - a.index)[0];
  if (!lastHigh || !lastLow) return null;

  const rangeHigh = Math.max(lastHigh.price, lastLow.price);
  const rangeLow = Math.min(lastHigh.price, lastLow.price);
  if (rangeHigh <= rangeLow) return null;

  return { rangeLow, rangeHigh };
}

export function calculatePremiumDiscountZone(
  price: number,
  swings: SmcSwingPoint[],
  atIndex: number,
): DealingRangeZone | null {
  const range = findDealingRange(swings, atIndex);
  if (!range) return null;
  const { rangeLow, rangeHigh } = range;
  const percentInRange = ((price - rangeLow) / (rangeHigh - rangeLow)) * 100;
  const clamped = Math.max(0, Math.min(100, percentInRange));

  let zone: DealingRangeZone["zone"] = "EQUILIBRIUM";
  if (clamped >= 55) zone = "PREMIUM";
  else if (clamped <= 45) zone = "DISCOUNT";

  return { rangeLow, rangeHigh, percentInRange: clamped, zone };
}

export type EqualLevel = {
  price: number;
  kind: "EQL" | "EQH";
};

export function findEqualLevels(
  swings: SmcSwingPoint[],
  atIndex: number,
  tolerancePct = 0.001,
): EqualLevel[] {
  const priorSwings = [...swings]
    .filter((s) => s.index < atIndex)
    .sort((a, b) => b.index - a.index);
  const results: EqualLevel[] = [];

  for (const kind of ["LOW", "HIGH"] as const) {
    const points = priorSwings.filter((s) => s.kind === kind);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        const diff = Math.abs(a.price - b.price) / Math.max(Math.abs(a.price), Math.abs(b.price), 0.0001);
        if (diff <= tolerancePct) {
          results.push({
            price: (a.price + b.price) / 2,
            kind: kind === "LOW" ? "EQL" : "EQH",
          });
        }
      }
    }
  }

  return results;
}

export type PriorPeriodLevels = {
  priorDayLow: number | null;
  priorDayHigh: number | null;
  priorWeekLow: number | null;
  priorWeekHigh: number | null;
};

export function calculatePriorPeriodLevels(
  candles: Candle[],
  atIndex: number,
): PriorPeriodLevels {
  if (atIndex < 0 || atIndex >= candles.length) {
    return { priorDayLow: null, priorDayHigh: null, priorWeekLow: null, priorWeekHigh: null };
  }

  const currentDayIndex = Math.floor(candles[atIndex].time / (24 * 60 * 60 * 1000));
  const currentWeekIndex = Math.floor(currentDayIndex / 7);

  let priorDayLow: number | null = null;
  let priorDayHigh: number | null = null;
  let priorWeekLow: number | null = null;
  let priorWeekHigh: number | null = null;

  for (let i = 0; i <= atIndex; i += 1) {
    const c = candles[i];
    const dayIndex = Math.floor(c.time / (24 * 60 * 60 * 1000));
    const weekIndex = Math.floor(dayIndex / 7);

    if (dayIndex === currentDayIndex - 1) {
      priorDayLow = priorDayLow === null ? c.low : Math.min(priorDayLow, c.low);
      priorDayHigh = priorDayHigh === null ? c.high : Math.max(priorDayHigh, c.high);
    }
    if (weekIndex === currentWeekIndex - 1) {
      priorWeekLow = priorWeekLow === null ? c.low : Math.min(priorWeekLow, c.low);
      priorWeekHigh = priorWeekHigh === null ? c.high : Math.max(priorWeekHigh, c.high);
    }
  }

  return { priorDayLow, priorDayHigh, priorWeekLow, priorWeekHigh };
}

export function calculateRvol(
  candles: Candle[],
  index: number,
  lookback = 20,
): number | null {
  if (index < 1 || index >= candles.length) return null;
  const start = Math.max(0, index - lookback);
  const priorCandles = candles.slice(start, index);
  if (priorCandles.length === 0) return null;
  const avgVolume = priorCandles.reduce((sum, c) => sum + c.volume, 0) / priorCandles.length;
  if (avgVolume <= 0) return null;
  return candles[index].volume / avgVolume;
}

export type RejectionWickInfo = {
  hasRejectionWick: boolean;
  wickRatio: number;
};

export function detectRejectionWick(
  candle: Candle,
  direction: "LONG" | "SHORT",
): RejectionWickInfo {
  const range = candle.high - candle.low;
  if (range <= 0) return { hasRejectionWick: false, wickRatio: 0 };
  const bodyTop = Math.max(candle.open, candle.close);
  const bodyBottom = Math.min(candle.open, candle.close);
  const wick = direction === "SHORT" ? candle.high - bodyTop : bodyBottom - candle.low;
  const wickRatio = Math.max(0, wick) / range;
  return { hasRejectionWick: wickRatio >= 0.5, wickRatio };
}
