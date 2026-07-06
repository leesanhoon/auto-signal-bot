import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "../setup-types.js";
import { classifyTrend, isDoji, detectCompression } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, applyStandardConfidenceAdjustments } from "./shared.js";

/**
 * DD — Double Doji Break
 * UPTREND/DOWNTREND + pullback chạm EMA20 (≤ 0.3 ATR) + ≥2 doji liên tiếp tại vùng EMA.
 */
export function detectDd(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "DD";

  if (index < 1) return null;

  const trend = classifyTrend(candles, ctx.ema20, ctx.atr14, index);
  if (trend === "FLAT") {
    trace.push(`Trend=FLAT -> khong ap dung DD`);
    return null;
  }
  trace.push(`Trend=${trend}, EMA20 slope > 0.15`);

  // Check price near EMA20: distance ≤ 0.3 ATR
  const ema = ctx.ema20[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  const distance = Math.abs(candles[index].close - ema) / atr;
  if (distance > 0.3) {
    trace.push(`Gia cach EMA20 ${distance.toFixed(2)} ATR (>0.3) -> khong phai pullback`);
    return null;
  }
  trace.push(`Gia pullback ve EMA20, distance=${distance.toFixed(2)} ATR`);

  // Find consecutive Doji at/near index (including current candle)
  let dojiCount = 0;
  let dojiStart = index;
  for (let i = index; i >= Math.max(0, index - 5); i--) {
    if (isDoji(candles[i], atr)) {
      dojiCount++;
      dojiStart = i;
    } else {
      break;
    }
  }

  if (dojiCount < 2) {
    trace.push(`Chi co ${dojiCount} doji, can >=2`);
    return null;
  }
  trace.push(`${dojiCount} doji lien tiep tai index ${dojiStart}-${index}, sat EMA20`);

  // Direction & entry
  const direction = trend === "UPTREND" ? "LONG" : "SHORT";
  const dojiHigh = Math.max(...candles.slice(dojiStart, index + 1).map((c) => c.high));
  const dojiLow = Math.min(...candles.slice(dojiStart, index + 1).map((c) => c.low));
  const entry = direction === "LONG" ? dojiHigh : dojiLow;
  const stopBuffer = 0.1 * atr;
  const stopLoss = direction === "LONG" ? dojiLow - stopBuffer : dojiHigh + stopBuffer;
  const risk = Math.abs(entry - stopLoss);
  const takeProfit1 = direction === "LONG" ? entry + 1.5 * risk : entry - 1.5 * risk;
  const takeProfit2 = direction === "LONG" ? entry + 2.5 * risk : entry - 2.5 * risk;

  trace.push(`Nen ${index} xac nhan -> entry ${direction} tai ${entry.toFixed(5)}`);

  // Confidence
  let confidence = baseConfidence;
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