import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "../setup-types.js";
import { detectCompression } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, applyStandardConfidenceAdjustments } from "./shared.js";

function checkShiftedFallback(
  candles: Candle[],
  ctx: DetectionContext,
  index: number,
  matchedInnerWindow: number,
  kBlockInner: number,
  direction: "LONG" | "SHORT",
  rangeOuter: NonNullable<ReturnType<typeof detectCompression>>,
): boolean {
  if (index < 2) return false;

  // Recompute the inner compression on `index - 2` so the fallback window excludes
  // the breakout candle at `index - 1` and only inspects data that was actually closed.
  const fallbackInner = detectCompression(
    candles,
    ctx.ema20,
    ctx.atr14,
    index - 2,
    matchedInnerWindow,
    kBlockInner,
  );
  if (fallbackInner === null) return false;

  const prevCandle = candles[index - 1];
  return direction === "LONG"
    ? prevCandle.high > fallbackInner.high && candles[index].high > rangeOuter.high
    : prevCandle.low < fallbackInner.low && candles[index].low < rangeOuter.low;
}

function resolveIrbBreakout(
  candles: Candle[],
  ctx: DetectionContext,
  index: number,
  direction: "LONG" | "SHORT",
  rangeInner: NonNullable<ReturnType<typeof detectCompression>>,
  rangeOuter: NonNullable<ReturnType<typeof detectCompression>>,
  matchedInnerWindow: number,
  kBlockInner: number,
  trace: string[],
): boolean {
  const breaksInner = direction === "LONG"
    ? candles[index].close > rangeInner.high
    : candles[index].close < rangeInner.low;
  if (!breaksInner) {
    trace.push(
      direction === "LONG"
        ? `Chua pha RangeInner high (close=${candles[index].close.toFixed(5)} <= innerHigh=${rangeInner.high.toFixed(5)})`
        : `Chua pha RangeInner low (close=${candles[index].close.toFixed(5)} >= innerLow=${rangeInner.low.toFixed(5)})`,
    );
    return false;
  }

  const breaksOuter = direction === "LONG"
    ? candles[index].close > rangeOuter.high
    : candles[index].close < rangeOuter.low;
  if (!breaksOuter) {
    trace.push(
      direction === "LONG"
        ? `Pha RangeInner nhung chua pha RangeOuter high (close=${candles[index].close.toFixed(5)} <= outerHigh=${rangeOuter.high.toFixed(5)})`
        : `Pha RangeInner nhung chua pha RangeOuter low`,
    );
    if (!checkShiftedFallback(candles, ctx, index, matchedInnerWindow, kBlockInner, direction, rangeOuter)) {
      return false;
    }
    trace.push(`RangeInner pha index ${index - 1}, RangeOuter pha index ${index} -> chap nhan`);
  }

  return true;
}

/**
 * IRB — Inside Range Break
 * RangeOuter (W=10-15) with RangeInner (W=4-6) near RangeOuter boundary.
 * RangeInner breakout simultaneously pushes through RangeOuter.
 */
export function detectIrb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "IRB";

  if (index < 1) return null;

  const ema = ctx.ema20[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // 1. Detect RangeOuter — larger window (10-15), kBlock wide enough for any range
  const outerWindows = [10, 12, 15];
  const kBlockOuter = 2.5;
  let rangeOuter: ReturnType<typeof detectCompression> = null;

  for (const w of outerWindows) {
    rangeOuter = detectCompression(candles, ctx.ema20, ctx.atr14, index - 1, w, kBlockOuter);
    if (rangeOuter !== null) {
      trace.push(`RangeOuter detected w=${w}, range=${rangeOuter.range.toFixed(5)}, high=${rangeOuter.high.toFixed(5)}, low=${rangeOuter.low.toFixed(5)}`);
      break;
    }
  }

  if (rangeOuter === null) {
    trace.push(`Khong phat hien RangeOuter`);
    return null;
  }

  // 2. Detect RangeInner — smaller window (4-6) contained within RangeOuter
  const innerWindows = [4, 5, 6];
  const kBlockInner = 1.5;
  let rangeInner: ReturnType<typeof detectCompression> = null;
  let matchedInnerWindow = innerWindows[0];

  for (const w of innerWindows) {
    rangeInner = detectCompression(candles, ctx.ema20, ctx.atr14, index - 1, w, kBlockInner);
    if (rangeInner !== null) {
      // RangeInner must be inside RangeOuter
      if (rangeInner.high <= rangeOuter.high && rangeInner.low >= rangeOuter.low) {
        matchedInnerWindow = w;
        trace.push(`RangeInner detected w=${w}, range=${rangeInner.range.toFixed(5)}`);
        break;
      }
    }
    rangeInner = null;
  }

  if (rangeInner === null) {
    trace.push(`Khong phat hien RangeInner ben trong RangeOuter`);
    return null;
  }

  // 3. RangeInner must be near RangeOuter boundary (top for LONG, bottom for SHORT)
  const innerToOuterTop = rangeOuter.high - rangeInner.high;
  const innerToOuterBottom = rangeInner.low - rangeOuter.low;
  const nearThreshold = 0.3 * atr;

  // Determine which boundary RangeInner is near
  const nearTop = innerToOuterTop <= nearThreshold;
  const nearBottom = innerToOuterBottom <= nearThreshold;

  if (!nearTop && !nearBottom) {
    trace.push(`RangeInner khong sat bien RangeOuter (topGap=${innerToOuterTop.toFixed(5)}, bottomGap=${innerToOuterBottom.toFixed(5)})`);
    return null;
  }

  const direction = nearTop ? "LONG" : "SHORT";
  trace.push(`RangeInner sat bien ${direction === "LONG" ? "tren" : "duoi"} cua RangeOuter`);

  // 4. Breakout: RangeInner boundary breaks AND simultaneously pushes through RangeOuter
  if (!resolveIrbBreakout(candles, ctx, index, direction, rangeInner, rangeOuter, matchedInnerWindow, kBlockInner, trace)) {
    return null;
  }

  trace.push(`Breakout pha ca RangeInner va RangeOuter`);

  // Entry at RangeInner breakout
  const entry = direction === "LONG" ? rangeInner.high : rangeInner.low;
  const stopLoss = direction === "LONG" ? rangeInner.low : rangeInner.high;
  const risk = Math.abs(entry - stopLoss);

  // Target = RangeOuter height
  const outerHeight = rangeOuter.high - rangeOuter.low;
  const takeProfit1 = direction === "LONG"
    ? entry + outerHeight
    : entry - outerHeight;
  const takeProfit2 = direction === "LONG"
    ? entry + 1.5 * outerHeight
    : entry - 1.5 * outerHeight;

  trace.push(`Entry ${direction} tai ${entry.toFixed(5)}, outerHeight=${outerHeight.toFixed(5)}`);

  // Invalidation check: RangeInner breakout didn't push through RangeOuter in <=2 candles
  // (This can only be checked retroactively with lookahead — we note it here)
  trace.push(`Kiem tra: RangeInner breakout dong thoi pha RangeOuter trong 1-2 nen`);

  // Confidence
  let confidence = baseConfidence;
  const slope = computeSlope(ctx.ema20, ctx.atr14, index);
  const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
  confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    setup: kind,
    pair: ctx.pair,
    timeframe: ctx.timeframe,
    direction,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    confidence,
    triggerIndex: index,
    ruleTrace: trace,
  };
}
