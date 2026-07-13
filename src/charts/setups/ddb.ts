import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind, SetupChartGeometry } from "../setup-types.js";
import { classifyTrend, isDoji } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments, isHarmonicPullback } from "./shared.js";

/**
 * DDB — Double Doji Break
 * Trend market with harmonic pullback to EMA21 + ≥2 consecutive doji at EMA21 level.
 * Entry: Price breaks out above/below doji cluster (depending on trend direction).
 * Stop Loss: Below/above lowest/highest doji candle ± 0.1 ATR buffer.
 */
export function detectDdb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "DDB";

  if (index < 1) return null;

  const trend = classifyTrend(candles, ctx.ma21, ctx.atr14, index);
  if (trend === "FLAT") {
    trace.push(`Trend=FLAT -> khong ap dung DDB`);
    return null;
  }
  trace.push(`Trend=${trend}`);

  const ema = ctx.ma21[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // Find consecutive doji (at/near current index)
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
  trace.push(`${dojiCount} doji lien tiep tai index ${dojiStart}-${index}`);

  // Check price near EMA21: distance ≤ 0.3 ATR
  const distance = Math.abs(candles[index].close - ema) / atr;
  if (distance > 0.3) {
    trace.push(`Gia cach EMA21 ${distance.toFixed(2)} ATR (>0.3) -> khong sat EMA`);
    return null;
  }
  trace.push(`Custer doji sat EMA21, distance=${distance.toFixed(2)} ATR`);

  // Validate that pullback to doji cluster is harmonic (1 single wave, not horizontal)
  let pullbackStartIndex = dojiStart - 1;
  while (pullbackStartIndex > 0 && !isDoji(candles[pullbackStartIndex], atr)) {
    pullbackStartIndex--;
  }
  // pullbackStartIndex is now the candle before the first doji (or 0)

  const isHarmonic = isHarmonicPullback(candles, pullbackStartIndex, dojiStart - 1, atr);
  if (!isHarmonic) {
    trace.push(`Pullback toi custer doji khong phai song hieu hoa (ngang hoac danh gia 2 lan)`);
    return null;
  }
  trace.push(`Pullback la song hieu hoa`);

  // Direction & entry
  const direction = trend === "UPTREND" ? "LONG" : "SHORT";
  const dojiHigh = Math.max(...candles.slice(dojiStart, index + 1).map((c) => c.high));
  const dojiLow = Math.min(...candles.slice(dojiStart, index + 1).map((c) => c.low));
  trace.push(`Cum doji: dinh=${dojiHigh.toFixed(5)}, day=${dojiLow.toFixed(5)}`);
  const entry = direction === "LONG" ? dojiHigh : dojiLow;
  const stopBuffer = 0.1 * atr;
  const stopLoss = direction === "LONG" ? dojiLow - stopBuffer : dojiHigh + stopBuffer;
  const takeProfit = computeTakeProfit(direction, entry, stopLoss);

  trace.push(`Nen ${index} xac nhan -> entry ${direction} tai ${entry.toFixed(5)}`);

  // Confidence
  let confidence = baseConfidence;
  const slope = computeSlope(ctx.ma21, ctx.atr14, index);
  const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
  confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);

  const highlightCandles = [];
  for (let i = dojiStart; i <= index; i++) {
    highlightCandles.push({ index: i, label: "Doji" });
  }

  const geometry: SetupChartGeometry = {
    boxes: [],
    markers: [],
    highlightCandles,
    lines: [
      {
        points: [
          { index: pullbackStartIndex, price: candles[pullbackStartIndex].close },
          { index: dojiStart, price: candles[dojiStart].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
    patternLabel: {
      index,
      price: direction === "LONG" ? entry : entry,
      text: kind,
    },
  };

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
    geometry,
  };
}
