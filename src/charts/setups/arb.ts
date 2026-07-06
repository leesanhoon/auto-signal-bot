import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "../setup-types.js";
import { detectCompression, isFalseBreak } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, applyStandardConfidenceAdjustments } from "./shared.js";

/**
 * ARB — Advanced Range Break
 * Large range with ≥2 failed edge tests before the real breakout.
 * Confidence bonus: +10 per confirmed edge test (max +20).
 * Invalidation: 3rd failure.
 */
export function detectArb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "ARB";

  if (index < 1) return null;

  const ema = ctx.ema20[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // Detect a large range (like RB) — larger window, higher kBlock
  const windowSizes = [10, 8, 6];
  const kBlockArb = 2.0;
  let range: ReturnType<typeof detectCompression> = null;

  for (const w of windowSizes) {
    range = detectCompression(candles, ctx.ema20, ctx.atr14, index, w, kBlockArb);
    if (range !== null) {
      trace.push(`Range detected w=${w}, range=${range.range.toFixed(5)}`);
      break;
    }
  }

  if (range === null) {
    trace.push(`Khong phat hien Range`);
    return null;
  }

  // Check breakout direction
  const breaksUp = candles[index].close > range.high;
  const breaksDown = candles[index].close < range.low;

  if (!breaksUp && !breaksDown) {
    trace.push(`Gia chua pha range (close=${candles[index].close.toFixed(5)})`);
    return null;
  }

  const direction = breaksUp ? "LONG" : "SHORT";
  trace.push(`Breakout ${direction} phat hien`);

  // Count edge tests: scan back from range start for false breaks at the same edge
  let edgeTestCount = 0;
  const testLookback = Math.max(0, range.startIndex - 15);
  const levelHigh = range.high;
  const levelLow = range.low;

  for (let i = range.startIndex; i < index; i++) {
    // Check if candle i tried to break but failed (false break)
    const candle = candles[i];
    if (direction === "LONG") {
      // For LONG: a failed test means high broke above levelLow but close fell back
      if (candle.high > levelLow && candle.close <= levelLow) {
        edgeTestCount++;
        trace.push(`Edge test #${edgeTestCount} at index ${i}: high=${candle.high.toFixed(5)}, close=${candle.close.toFixed(5)}`);
      }
    } else {
      // For SHORT: a failed test means low broke below levelHigh but close bounced back
      if (candle.low < levelHigh && candle.close >= levelHigh) {
        edgeTestCount++;
        trace.push(`Edge test #${edgeTestCount} at index ${i}: low=${candle.low.toFixed(5)}, close=${candle.close.toFixed(5)}`);
      }
    }
  }

  if (edgeTestCount < 2) {
    trace.push(`edgeTestCount=${edgeTestCount} < 2 -> khong du test bien cho ARB`);
    return null;
  }
  trace.push(`edgeTestCount=${edgeTestCount} (can >=2)`);

  // Invalidation: 3rd failure = range is exhausted
  if (edgeTestCount >= 3) {
    trace.push(`edgeTestCount=${edgeTestCount} >= 3 -> range da het hieu luc`);
    return null;
  }

  // Verify current breakout is not false
  if (isFalseBreak(candles, index, levelHigh, levelLow, direction, 2)) {
    // Count this as another failure
    edgeTestCount++;
    trace.push(`Current breakout is false (edgeTestCount now ${edgeTestCount})`);
    if (edgeTestCount >= 3) {
      trace.push(`Lan that bai thu 3 -> range het hieu luc`);
    }
    return null;
  }
  trace.push(`Current breakout khong bi false`);

  // Entry/Stop/Target (same as RB)
  const entry = direction === "LONG" ? range.high : range.low;
  const stopLoss = direction === "LONG" ? range.low : range.high;
  const rangeHeight = range.high - range.low;

  const takeProfit1 = direction === "LONG"
    ? entry + rangeHeight
    : entry - rangeHeight;
  const takeProfit2 = direction === "LONG"
    ? entry + 1.5 * rangeHeight
    : entry - 1.5 * rangeHeight;

  trace.push(`Entry ${direction} tai ${entry.toFixed(5)}, rangeHeight=${rangeHeight.toFixed(5)}`);

  // Confidence
  let confidence = baseConfidence;

  // Bonus: +10 per confirmed edge test (max +20)
  const edgeBonus = Math.min(edgeTestCount * 10, 20);
  confidence += edgeBonus;
  trace.push(`Edge test bonus: +${edgeBonus} (${edgeTestCount} tests x 10)`);

  // Standard confidence adjustments
  const slope = computeSlope(ctx.ema20, ctx.atr14, index);
  const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
  confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);

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