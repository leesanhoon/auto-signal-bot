import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "../setup-types.js";
import { detectCompression } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, applyStandardConfidenceAdjustments } from "./shared.js";

/**
 * SB — Second Break (false-break reversal)
 * After any setup's breakout is flagged false, a new block forms within
 * the old range/block, then breaks in the OPPOSITE direction.
 *
 * @param failedSignal — the original detected signal that was flagged false
 */
export function detectSb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
  failedSignal: DetectedSignal,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "SB";

  if (index < 1) return null;

  const ema = ctx.ema20[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  const failedDirection = failedSignal.direction;
  const failedEntry = failedSignal.entry;
  const failedIndex = failedSignal.triggerIndex;

  trace.push(`Failed signal: ${failedSignal.setup} ${failedDirection} at index ${failedIndex}`);

  // The new breakout must be in the OPPOSITE direction
  const sbDirection: "LONG" | "SHORT" = failedDirection === "LONG" ? "SHORT" : "LONG";
  trace.push(`SB direction: ${sbDirection} (nguoc voi failed ${failedDirection})`);

  // Determine the old range/block boundaries from the failed signal
  // The old range spans from the failed signal's stopLoss to its entry
  const oldLow = Math.min(failedSignal.entry, failedSignal.stopLoss);
  const oldHigh = Math.max(failedSignal.entry, failedSignal.stopLoss);

  trace.push(`Old range: low=${oldLow.toFixed(5)}, high=${oldHigh.toFixed(5)}`);

  // Detect a new block within the old range/block
  const windowSizes = [4, 5, 6];
  let newBlock: ReturnType<typeof detectCompression> = null;

  for (const w of windowSizes) {
    newBlock = detectCompression(candles, ctx.ema20, ctx.atr14, index, w, 1.2);
    if (newBlock !== null) {
      // New block must be within or near the old range
      if (newBlock.high <= oldHigh + 0.5 * atr && newBlock.low >= oldLow - 0.5 * atr) {
        trace.push(`New block detected w=${w}, high=${newBlock.high.toFixed(5)}, low=${newBlock.low.toFixed(5)}`);
        break;
      }
      newBlock = null;
    }
  }

  if (newBlock === null) {
    trace.push(`Khong phat hien block moi trong pham vi old range`);
    return null;
  }

  // Must form AFTER the failed break (index > failedIndex)
  if (newBlock.endIndex <= failedIndex) {
    trace.push(`New block formed before/at failed break index`);
    return null;
  }
  trace.push(`New block formed after failed break`);

  // Current close must break the new block boundary in the opposite direction
  if (sbDirection === "LONG" && candles[index].close <= newBlock.high) {
    trace.push(`SB LONG nhung close chua pha high block moi (close=${candles[index].close.toFixed(5)})`);
    return null;
  }
  if (sbDirection === "SHORT" && candles[index].close >= newBlock.low) {
    trace.push(`SB SHORT nhung close chua pha low block moi`);
    return null;
  }
  trace.push(`Close pha block boundary: ${sbDirection}`);

  // Entry/Stop/Target
  const entry = sbDirection === "LONG" ? newBlock.high : newBlock.low;
  const stopLoss = sbDirection === "LONG" ? newBlock.low : newBlock.high;
  const risk = Math.abs(entry - stopLoss);

  const takeProfit1 = sbDirection === "LONG"
    ? entry + 1.5 * risk
    : entry - 1.5 * risk;

  // TP2: nearest swing in same direction
  let tp2: number;
  if (sbDirection === "LONG") {
    let swingHigh = -Infinity;
    for (let i = Math.max(0, index - 20); i < index; i++) {
      if (candles[i].high > swingHigh) swingHigh = candles[i].high;
    }
    tp2 = swingHigh > -Infinity
      ? entry + Math.abs(entry - swingHigh) * 0.5
      : takeProfit1 * 1.5;
  } else {
    let swingLow = Infinity;
    for (let i = Math.max(0, index - 20); i < index; i++) {
      if (candles[i].low < swingLow) swingLow = candles[i].low;
    }
    tp2 = swingLow < Infinity
      ? entry - Math.abs(entry - swingLow) * 0.5
      : takeProfit1 * 1.5;
  }

  trace.push(`Entry ${sbDirection} tai ${entry.toFixed(5)}, Stop=${stopLoss.toFixed(5)}`);

  // Confidence
  let confidence = baseConfidence;
  const slope = computeSlope(ctx.ema20, ctx.atr14, index);
  const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
  confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);

  return {
    setup: kind,
    pair: ctx.pair,
    timeframe: ctx.timeframe,
    direction: sbDirection,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2: tp2,
    confidence,
    triggerIndex: index,
    ruleTrace: trace,
  };
}