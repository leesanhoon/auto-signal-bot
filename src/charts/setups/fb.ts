import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "../setup-types.js";
import { classifyTrend } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, applyStandardConfidenceAdjustments } from "./shared.js";

/**
 * FB — First Break
 * New trend with EMA20 recently switched from FLAT/opposite.
 * First price touch of EMA20 since trend formed → signal bar closes in trend direction.
 */
export function detectFb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "FB";

  if (index < 1) return null;

  const trend = classifyTrend(candles, ctx.ema20, ctx.atr14, index);
  if (trend === "FLAT") {
    trace.push(`Trend=FLAT -> khong ap dung FB`);
    return null;
  }
  trace.push(`Trend=${trend}`);

  const ema = ctx.ema20[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // 1. Trend must have formed recently (within last 10 candles)
  // Scan back to find when EMA20 slope first became strong in current direction.
  const trendLookback = 10;
  let trendStartIndex = -1;
  for (let i = index; i >= Math.max(0, index - trendLookback); i--) {
    if (i < 5) break;
    const emaI = ctx.ema20[i];
    const emaPrevI = ctx.ema20[i - 5];
    const atrI = ctx.atr14[i];
    if (emaI === null || emaPrevI === null || atrI === null || atrI === 0) continue;

    const slopeI = (emaI - emaPrevI) / atrI;
    if (trend === "UPTREND" && slopeI > 0.15) {
      trendStartIndex = i;
      break;
    }
    if (trend === "DOWNTREND" && slopeI < -0.15) {
      trendStartIndex = i;
      break;
    }
  }

  if (trendStartIndex < 0) {
    trace.push(`Khong tim thay diem bat dau trend trong ${trendLookback} nen`);
    return null;
  }

  // Verify the transition: before trendStartIndex, slope should have been FLAT or opposite
  if (trendStartIndex >= 5) {
    const emaBefore = ctx.ema20[trendStartIndex - 1];
    const emaBeforePrev = ctx.ema20[Math.max(0, trendStartIndex - 6)];
    const atrBefore = ctx.atr14[trendStartIndex];
    if (emaBefore !== null && emaBeforePrev !== null && atrBefore !== null && atrBefore !== 0) {
      const prevSlope = (emaBefore - emaBeforePrev) / atrBefore;
      const oppDirection = trend === "UPTREND" ? prevSlope < -0.05 : prevSlope > 0.05;
      if (!oppDirection && Math.abs(prevSlope) <= 0.15) {
        trace.push(`Trend chuyen tu FLAT tai ~index ${trendStartIndex}`);
      } else if (oppDirection) {
        trace.push(`Trend dao chieu tai ~index ${trendStartIndex}`);
      } else {
        trace.push(`Trend duy tri tu truoc, khong phai trend moi -> bo qua`);
        return null;
      }
    }
  }
  trace.push(`Trend bat dau tu index ${trendStartIndex}`);

  // 2. Count touches of EMA20 since trendStartIndex up to index-1
  let touchCount = 0;
  for (let i = trendStartIndex; i < index; i++) {
    const e = ctx.ema20[i];
    const a = ctx.atr14[i];
    if (e === null || a === null || a === 0) continue;
    const dist = Math.abs(candles[i].close - e) / a;
    // A touch is defined as price being very close to EMA20 (within 0.3 ATR)
    if (dist <= 0.3) {
      touchCount++;
    }
  }

  // 3. Current candle (signal bar) must be a touch
  const currentDistance = Math.abs(candles[index].close - ema) / atr;
  if (currentDistance > 0.3) {
    trace.push(`Gia cach EMA20 ${currentDistance.toFixed(2)} ATR (>0.3) -> khong phai cham EMA`);
    return null;
  }
  trace.push(`Cham EMA20, distance=${currentDistance.toFixed(2)} ATR`);

  touchCount++; // include current candle
  trace.push(`touchCount=${touchCount} (tu trendStartIndex ${trendStartIndex})`);

  if (touchCount > 1) {
    trace.push(`touchCount=${touchCount} > 1 -> khong con la FB`);
    return null;
  }

  // 4. Signal bar must close in trend direction with strong body
  const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);

  const closesInTrend = trend === "UPTREND"
    ? candles[index].close > candles[index].open
    : candles[index].close < candles[index].open;

  if (!closesInTrend) {
    trace.push(`Signal bar dong cua nguoc trend -> khong phai FB`);
    return null;
  }

  if (bodyRatio < 0.5) {
    trace.push(`Signal bar bodyRatio=${bodyRatio.toFixed(2)} < 0.5 -> yeu`);
    return null;
  }
  trace.push(`Signal bar bodyRatio=${bodyRatio.toFixed(2)} >= 0.5, dong cua xuoi trend`);

  // Entry/Stop/Target
  const direction = trend === "UPTREND" ? "LONG" : "SHORT";
  const signalHigh = candles[index].high;
  const signalLow = candles[index].low;
  const stopBuffer = 0.1 * atr;

  const entry = direction === "LONG" ? signalHigh : signalLow;
  const stopLoss = direction === "LONG"
    ? signalLow - stopBuffer
    : signalHigh + stopBuffer;
  const risk = Math.abs(entry - stopLoss);
  const takeProfit1 = direction === "LONG"
    ? entry + 1.5 * risk
    : entry - 1.5 * risk;

  // TP2: hướng về swing extreme trước khi trend hình thành; fallback 2.5R.
  const defaultTp2 = direction === "LONG" ? entry + 2.5 * risk : entry - 2.5 * risk;
  let tp2 = defaultTp2;
  if (direction === "LONG") {
    let swingHigh = -Infinity;
    for (let i = Math.max(0, trendStartIndex - 15); i < trendStartIndex; i++) {
      if (candles[i].high > swingHigh) swingHigh = candles[i].high;
    }
    if (swingHigh > entry) {
      const candidate = entry + (swingHigh - entry) * 0.5;
      if (candidate > takeProfit1) tp2 = candidate;
    }
  } else {
    let swingLow = Infinity;
    for (let i = Math.max(0, trendStartIndex - 15); i < trendStartIndex; i++) {
      if (candles[i].low < swingLow) swingLow = candles[i].low;
    }
    if (swingLow < entry) {
      const candidate = entry - (entry - swingLow) * 0.5;
      if (candidate < takeProfit1) tp2 = candidate;
    }
  }

  trace.push(`Entry ${direction} tai ${entry.toFixed(5)}, Stop=${stopLoss.toFixed(5)}`);

  // Confidence
  let confidence = baseConfidence;
  const slope = computeSlope(ctx.ema20, ctx.atr14, index);
  confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);

  return {
    setup: kind,
    pair: ctx.pair,
    timeframe: ctx.timeframe,
    direction,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2: tp2,
    confidence,
    triggerIndex: index,
    ruleTrace: trace,
  };
}