import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind, ChartMarker } from "../setup-types.js";
import { detectCompression, classifyCompressionTightness } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments, applyCompressionTightnessBonus, applyPriorConsolidationPenalty } from "./shared.js";
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

  // Count edge tests independently for both sides — determine direction from
  // WHICH edge has been tested (>=2 lan) truoc khi breakout xay ra, thay vi cho
  // gia da dong cua vuot bien (qua tre). Day la thay doi chinh de ARB ban signal
  // som hon, tuong tu cach BB da lam (xem bb.ts:104-118).
  const testLookback = Math.max(0, range.startIndex - 15);
  const levelHigh = range.high;
  const levelLow = range.low;

  let upperEdgeCount = 0;
  let lowerEdgeCount = 0;
  const upperMarkers: ChartMarker[] = [];
  const lowerMarkers: ChartMarker[] = [];

  for (let i = testLookback; i < index; i++) {
    const candle = candles[i];
    // Upper edge test: gia probe len tren levelHigh roi dong cua lai trong range.
    if (candle.high > levelHigh && candle.close >= levelLow && candle.close <= levelHigh) {
      upperEdgeCount++;
      upperMarkers.push({ index: i, price: candle.high, label: `Edge test #${upperEdgeCount}` });
      trace.push(`Upper edge test #${upperEdgeCount} at index ${i}: high=${candle.high.toFixed(5)}, close=${candle.close.toFixed(5)}`);
    }
    // Lower edge test: gia probe xuong duoi levelLow roi dong cua lai trong range.
    if (candle.low < levelLow && candle.close >= levelLow && candle.close <= levelHigh) {
      lowerEdgeCount++;
      lowerMarkers.push({ index: i, price: candle.low, label: `Edge test #${lowerEdgeCount}` });
      trace.push(`Lower edge test #${lowerEdgeCount} at index ${i}: low=${candle.low.toFixed(5)}, close=${candle.close.toFixed(5)}`);
    }
  }

  const upperReady = upperEdgeCount >= 2;
  const lowerReady = lowerEdgeCount >= 2;

  if (upperReady && lowerReady) {
    trace.push(`Ca 2 canh deu co >=2 edge test (upper=${upperEdgeCount}, lower=${lowerEdgeCount}) -> khong ro huong, bo qua`);
    return null;
  }
  if (!upperReady && !lowerReady) {
    trace.push(`Chua canh nao du edge test (upper=${upperEdgeCount}, lower=${lowerEdgeCount}) -> chua ready`);
    return null;
  }

  const direction = upperReady ? "LONG" : "SHORT";
  const edgeTestCount = upperReady ? upperEdgeCount : lowerEdgeCount;
  const edgeTestMarkers = upperReady ? upperMarkers : lowerMarkers;
  trace.push(`Direction du kien ${direction} tu edge-test side (count=${edgeTestCount})`);

  // Invalidation: 3rd failure = range da het hieu luc o canh nay
  if (edgeTestCount >= 3) {
    trace.push(`edgeTestCount=${edgeTestCount} >= 3 -> range da het hieu luc`);
    return null;
  }

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
  confidence = applyPriorConsolidationPenalty(candles, entry, atr, range.startIndex - 1, confidence, trace);

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
