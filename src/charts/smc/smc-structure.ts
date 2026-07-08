/**
 * Smart Money Concepts (SMC) structure detection — pure functions.
 *
 * Không import Bob Volman modules. Không side effect. Không network/env.
 */

import type { Candle } from "../ohlc-provider.js";
import type {
  SmcDirection,
  SmcFairValueGap,
  SmcLiquiditySweep,
  SmcOrderBlock,
  SmcStructureEvent,
  SmcSwingPoint,
  FindSwingPointsOptions,
} from "./smc-types.js";

// ---------------------------------------------------------------------------
// 1. Swing Points
// ---------------------------------------------------------------------------

/**
 * Tìm swing high/low từ closed candles.
 *
 * Swing HIGH: candle[i].high > high của tất cả candle trong left+right cửa sổ.
 * Swing LOW:  candle[i].low  < low  của tất cả candle trong left+right cửa sổ.
 *
 * Chỉ xét candles đã đóng (tất cả candle trong array đều assumed closed).
 *
 * @returns Mảng swing points sắp xếp theo index tăng dần.
 */
export function findSwingPoints(
  candles: Candle[],
  options?: FindSwingPointsOptions,
): SmcSwingPoint[] {
  if (!candles || candles.length === 0) return [];

  const left = options?.left ?? 2;
  const right = options?.right ?? 2;
  const windowSize = left + right + 1;

  if (candles.length < windowSize) return [];

  const swings: SmcSwingPoint[] = [];

  // Chỉ xét index từ `left` đến `length - right - 1` để đủ cả 2 bên.
  for (let i = left; i <= candles.length - right - 1; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      swings.push({ index: i, price: candles[i].high, kind: "HIGH" });
    }
    if (isLow) {
      swings.push({ index: i, price: candles[i].low, kind: "LOW" });
    }
  }

  return swings;
}

// ---------------------------------------------------------------------------
// 2. Structure Break (BOS / CHOCH)
// ---------------------------------------------------------------------------

/**
 * Kiểm tra xem candle tại `breakIndex` có break qua swing level gần nhất
 * (cùng chiều direction) không.
 *
 * Nếu có, trả về SmcStructureEvent.
 * - previousBias chưa biết → phân loại là BOS.
 * - break cùng chiều previousBias → BOS.
 * - break ngược chiều previousBias → CHOCH.
 */
export function detectStructureBreak(
  candles: Candle[],
  swings: SmcSwingPoint[],
  breakIndex: number,
  previousBias?: SmcDirection,
): SmcStructureEvent | null {
  if (!candles || !swings || breakIndex < 0 || breakIndex >= candles.length) {
    return null;
  }

  const relevantSwings = swings.filter(
    (s) =>
      (s.kind === "HIGH" && s.index < breakIndex) ||
      (s.kind === "LOW" && s.index < breakIndex),
  );

  if (relevantSwings.length === 0) return null;

  const closePrice = candles[breakIndex].close;

  // Tìm swing HIGH gần nhất trước breakIndex (cho bullish break)
  const lastHigh = [...relevantSwings]
    .filter((s) => s.kind === "HIGH")
    .sort((a, b) => b.index - a.index)[0];

  // Tìm swing LOW gần nhất trước breakIndex (cho bearish break)
  const lastLow = [...relevantSwings]
    .filter((s) => s.kind === "LOW")
    .sort((a, b) => b.index - a.index)[0];

  let direction: SmcDirection | null = null;
  let level: number | null = null;

  // Bullish break: close > swing high gần nhất
  if (lastHigh && closePrice > lastHigh.price) {
    direction = "LONG";
    level = lastHigh.price;
  }

  // Bearish break: close < swing low gần nhất
  if (lastLow && closePrice < lastLow.price) {
    direction = "SHORT";
    level = lastLow.price;
  }

  if (direction === null || level === null) return null;

  // Phân loại BOS vs CHOCH
  let kind: "BOS" | "CHOCH" = "BOS";
  if (previousBias && previousBias !== direction) {
    kind = "CHOCH";
  }

  return {
    kind,
    direction,
    breakIndex,
    level,
    previousBias,
  };
}

// ---------------------------------------------------------------------------
// 3. Liquidity Sweep
// ---------------------------------------------------------------------------

/**
 * Detect liquidity sweep tại candle[index]:
 * - Sell-side liquidity sweep (direction=SHORT): high vượt qua swing HIGH
 *   gần nhất, nhưng close quay về dưới swing HIGH.
 * - Buy-side liquidity sweep (direction=LONG): low phá qua swing LOW
 *   gần nhất, nhưng close quay về trên swing LOW.
 */
export function detectLiquiditySweep(
  candles: Candle[],
  swings: SmcSwingPoint[],
  index: number,
): SmcLiquiditySweep | null {
  if (!candles || !swings || index < 0 || index >= candles.length) {
    return null;
  }

  const priorSwings = swings.filter((s) => s.index < index);
  if (priorSwings.length === 0) return null;

  const candle = candles[index];

  // Sell-side sweep: wick above last swing HIGH but close below it
  const lastHigh = [...priorSwings]
    .filter((s) => s.kind === "HIGH")
    .sort((a, b) => b.index - a.index)[0];

  if (lastHigh && candle.high > lastHigh.price && candle.close < lastHigh.price) {
    return {
      direction: "SHORT",
      sweepIndex: index,
      sweptLevel: lastHigh.price,
      reclaimClose: candle.close,
    };
  }

  // Buy-side sweep: wick below last swing LOW but close above it
  const lastLow = [...priorSwings]
    .filter((s) => s.kind === "LOW")
    .sort((a, b) => b.index - a.index)[0];

  if (lastLow && candle.low < lastLow.price && candle.close > lastLow.price) {
    return {
      direction: "LONG",
      sweepIndex: index,
      sweptLevel: lastLow.price,
      reclaimClose: candle.close,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 4. Order Block
// ---------------------------------------------------------------------------

/**
 * Tìm order block gần nhất trước impulse/BOS.
 *
 * - LONG: tìm last bearish candle (close < open) trước `breakIndex`.
 * - SHORT: tìm last bullish candle (close > open) trước `breakIndex`.
 *
 * @returns SmcOrderBlock hoặc null nếu không tìm thấy.
 */
export function findRecentOrderBlock(
  candles: Candle[],
  breakIndex: number,
  direction: SmcDirection,
  lookback: number = 10,
): SmcOrderBlock | null {
  if (!candles || breakIndex < 1 || breakIndex >= candles.length) return null;

  const start = Math.max(0, breakIndex - lookback);

  for (let i = breakIndex - 1; i >= start; i--) {
    const c = candles[i];
    const isBearish = c.close < c.open;
    const isBullish = c.close > c.open;

    if (direction === "LONG" && isBearish) {
      const high = c.high;
      const low = c.low;
      return {
        direction,
        startIndex: i,
        endIndex: i,
        high,
        low,
        midpoint: (high + low) / 2,
      };
    }

    if (direction === "SHORT" && isBullish) {
      const high = c.high;
      const low = c.low;
      return {
        direction,
        startIndex: i,
        endIndex: i,
        high,
        low,
        midpoint: (high + low) / 2,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 5. Fair Value Gap (FVG)
// ---------------------------------------------------------------------------

/**
 * Detect Fair Value Gap tại candle[index] (3-candle imbalance).
 *
 * - Bullish FVG: candle[i-2].high < candle[i].low → gap phía trên.
 * - Bearish FVG: candle[i-2].low > candle[i].high → gap phía dưới.
 */
export function detectFairValueGap(
  candles: Candle[],
  index: number,
): SmcFairValueGap | null {
  if (!candles || index < 2 || index >= candles.length) return null;

  const prev2 = candles[index - 2];
  const current = candles[index];

  // Bullish FVG: gap above
  if (prev2.high < current.low) {
    return {
      direction: "LONG",
      index,
      high: current.low,
      low: prev2.high,
      midpoint: (prev2.high + current.low) / 2,
    };
  }

  // Bearish FVG: gap below
  if (prev2.low > current.high) {
    return {
      direction: "SHORT",
      index,
      high: prev2.low,
      low: current.high,
      midpoint: (prev2.low + current.high) / 2,
    };
  }

  return null;
}
