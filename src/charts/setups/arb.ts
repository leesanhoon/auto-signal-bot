import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind, ChartMarker } from "../setup-types.js";
import { detectCompression, isFalseBreak, classifyCompressionTightness } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments, applyCompressionTightnessBonus } from "./shared.js";
import { COMPRESSION_PARAMS } from "./compression-params.js";

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

  const ema = ctx.ma21[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // Detect a large range (like RB) using centralized params
  const { windows: windowSizes, kBlock: kBlockArb } = COMPRESSION_PARAMS.ARB;
  let range: ReturnType<typeof detectCompression> = null;

  for (const w of windowSizes) {
    range = detectCompression(candles, ctx.ma21, ctx.atr14, index - 1, w, kBlockArb);
    if (range !== null) {
      trace.push(`Range detected w=${w}, range=${range.range.toFixed(5)}`);
      trace.push(`Vung moi: high=${range.high.toFixed(5)}, low=${range.low.toFixed(5)}`);
      break;
    }
  }

  if (range === null) {
    trace.push(`Khong phat hien Range`);
    return null;
  }

  // Classify compression tightness
  const rangeAtr = ctx.atr14[range.endIndex]!;
  const tightness = classifyCompressionTightness(range, kBlockArb, rangeAtr);
  trace.push(`Nen ${tightness} (range=${range.range.toFixed(5)}, max=${(kBlockArb * rangeAtr).toFixed(5)})`)

  // Check breakout direction
  const breaksUp = candles[index].close > range.high;
  const breaksDown = candles[index].close < range.low;

  if (!breaksUp && !breaksDown) {
    trace.push(`Gia chua pha range (close=${candles[index].close.toFixed(5)})`);
    return null;
  }

  const direction = breaksUp ? "LONG" : "SHORT";
  trace.push(`Breakout ${direction} phat hien`);

  // ARB la setup Range (giong RB/IRB trong tai lieu, cung hang "MA21 nam phang"),
  // KHONG phai Trend — boi canh dung phai la MA phang TRUOC breakout, khong chi la
  // "slope cung huong breakout" (dieu do gan nhu luon dung tai chinh nen breakout,
  // khong xac nhan duoc boi canh Range thuc su truoc do).
  const slope = computeSlope(ctx.ma21, ctx.atr14, index);
  const slopeAligned = direction === "LONG" ? (slope !== null && slope > 0) : (slope !== null && slope < 0);
  if (!slopeAligned) {
    trace.push(`EMA21 slope=${slope !== null ? slope.toFixed(2) : "null"} khong cung huong breakout ${direction}`);
    return null;
  }
  trace.push(`EMA21 slope=${slope!.toFixed(2)} cung huong breakout ${direction}`);

  if (index >= 10) {
    const ema5 = ctx.ma21[index - 5];
    const ema10 = ctx.ma21[Math.max(0, index - 10)];
    const atr5 = ctx.atr14[index - 5];
    if (ema5 !== null && ema10 !== null && atr5 !== null && atr5 !== 0) {
      const slopeBefore = (ema5 - ema10) / atr5;
      if (Math.abs(slopeBefore) > 0.15) {
        trace.push(`EMA21 da doc tu truoc (slopeBefore=${slopeBefore.toFixed(2)}) -> khong phai boi canh Range (MA phang)`);
        return null;
      }
      trace.push(`EMA21 phang truoc breakout (slopeBefore=${slopeBefore.toFixed(2)})`);
    }
  }

  // Slope alone can pass after a sharp extension away from EMA21 that only now reverts back
  // through it (mean-reversion pullback, not a trend-aligned breakout). A genuine ARB range
  // consolidates near EMA21; if the whole range sits far away from EMA21, price already
  // detached from it before the "breakout" ever happened, so require the range to be near EMA21.
  const emaDistance = direction === "LONG"
    ? Math.max(0, range.low - ema)
    : Math.max(0, ema - range.high);
  const maxEmaDistance = 0.5 * rangeAtr;
  if (emaDistance > maxEmaDistance) {
    trace.push(`Range qua xa EMA21 (khoang cach=${emaDistance.toFixed(5)} > ${maxEmaDistance.toFixed(5)}) -> gia khong con ton trong EMA`);
    return null;
  }
  trace.push(`Range gan EMA21 (khoang cach=${emaDistance.toFixed(5)} <= ${maxEmaDistance.toFixed(5)})`);

  // Count edge tests: scan back from range start for false breaks at the same edge
  let edgeTestCount = 0;
  const edgeTestMarkers: ChartMarker[] = [];
  const testLookback = Math.max(0, range.startIndex - 15);
  const levelHigh = range.high;
  const levelLow = range.low;

  // Include failed edge tests that happened shortly before the detected range.
  for (let i = testLookback; i < index; i++) {
    // Check if candle i tried to break but failed (false break)
    const candle = candles[i];
    if (direction === "LONG") {
      // For LONG: a failed test means price probed above the upper boundary, then closed back inside.
      if (candle.high > levelHigh && candle.close >= levelLow && candle.close <= levelHigh) {
        edgeTestCount++;
        const price = candle.high;
        edgeTestMarkers.push({ index: i, price, label: `Edge test #${edgeTestCount}` });
        trace.push(`Edge test #${edgeTestCount} at index ${i}: high=${candle.high.toFixed(5)}, close=${candle.close.toFixed(5)}`);
      }
    } else {
      // For SHORT: a failed test means price probed below the lower boundary, then closed back inside.
      if (candle.low < levelLow && candle.close >= levelLow && candle.close <= levelHigh) {
        edgeTestCount++;
        const price = candle.low;
        edgeTestMarkers.push({ index: i, price, label: `Edge test #${edgeTestCount}` });
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

  const breakoutLevel = direction === "LONG" ? levelHigh : levelLow;
  const gap = Math.abs(candles[index].close - breakoutLevel);
  trace.push(`Pha vo muc moi tai gia ${breakoutLevel.toFixed(5)}, gap=${gap.toFixed(5)}`);

  // Entry/Stop/Target (same as RB)
  const entry = direction === "LONG" ? range.high : range.low;
  const stopLoss = direction === "LONG" ? range.low : range.high;
  const rangeHeight = range.high - range.low;

  const takeProfit = computeTakeProfit(direction, entry, stopLoss);

  trace.push(`Entry ${direction} tai ${entry.toFixed(5)}, rangeHeight=${rangeHeight.toFixed(5)}`);

  // Confidence
  let confidence = baseConfidence;

  // Bonus: +10 per confirmed edge test (max +20)
  const edgeBonus = Math.min(edgeTestCount * 10, 20);
  confidence += edgeBonus;
  trace.push(`Edge test bonus: +${edgeBonus} (${edgeTestCount} tests x 10)`);

  // Standard confidence adjustments (reuse slope already computed above)
  const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
  confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);
  confidence = applyCompressionTightnessBonus(confidence, tightness, trace);

  return {
    setup: kind,
    pair: ctx.pair,
    timeframe: ctx.timeframe,
    direction,
    entry,
    stopLoss,
    takeProfit,
    confidence,
    triggerIndex: index,
    ruleTrace: trace,
    geometry: {
      boxes: [range],
      markers: edgeTestMarkers,
      patternLabel: { index, price: entry, text: kind },
    },
  };
}
