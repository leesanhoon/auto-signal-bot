import type { Candle } from "../client/ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "../model/setup-types.js";
import { detectCompression, classifyCompressionTightness } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments, applyCompressionTightnessBonus, applyPriorConsolidationPenalty } from "./shared.js";
import { COMPRESSION_PARAMS } from "./compression-params.js";

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
    ctx.ma21,
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

function breaksInDirection(
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
  if (!breaksInner) return false;

  const breaksOuter = direction === "LONG"
    ? candles[index].close > rangeOuter.high
    : candles[index].close < rangeOuter.low;
  if (breaksOuter) {
    trace.push(`Breakout ${direction} pha ca RangeInner va RangeOuter`);
    return true;
  }

  if (checkShiftedFallback(candles, ctx, index, matchedInnerWindow, kBlockInner, direction, rangeOuter)) {
    trace.push(`RangeInner pha index ${index - 1}, RangeOuter pha index ${index} -> chap nhan (${direction})`);
    return true;
  }

  return false;
}

/**
 * IRB — Inside Range Break
 * RangeOuter (W=10-15) chứa RangeInner (W=4-6) nằm GẦN CHÍNH GIỮA RangeOuter (theo
 * tài liệu Bob Volman: "đoạn nén tích lũy nằm chính giữa vùng phạm vi" — hộp nhỏ
 * trong hộp lớn, không phải sát biên). Hướng breakout được xác định bằng chính hành
 * vi giá (đóng cửa vượt cả RangeInner lẫn RangeOuter cùng phía), KHÔNG suy ra từ vị
 * trí của RangeInner như bản cũ.
 * Target = biên vùng phạm vi lớn (RangeOuter), đúng "Chốt lời kỳ vọng: Tiệm cận
 * đường biên trên/dưới của vùng phạm vi lớn".
 */
export function detectIrb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "IRB";

  if (index < 1) return null;

  const ema = ctx.ma21[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // 1. Detect RangeOuter using centralized params
  const { windows: outerWindows, kBlock: kBlockOuter } = COMPRESSION_PARAMS.IRB_OUTER;
  let rangeOuter: ReturnType<typeof detectCompression> = null;

  for (const w of outerWindows) {
    rangeOuter = detectCompression(candles, ctx.ma21, ctx.atr14, index - 1, w, kBlockOuter);
    if (rangeOuter !== null) {
      trace.push(`RangeOuter detected w=${w}, range=${rangeOuter.range.toFixed(5)}, high=${rangeOuter.high.toFixed(5)}, low=${rangeOuter.low.toFixed(5)}`);
      break;
    }
  }

  if (rangeOuter === null) {
    trace.push(`Khong phat hien RangeOuter`);
    return null;
  }

  // 2. Detect RangeInner using centralized params
  const { windows: innerWindows, kBlock: kBlockInner } = COMPRESSION_PARAMS.IRB_INNER;
  let rangeInner: ReturnType<typeof detectCompression> = null;
  let matchedInnerWindow: number = innerWindows[0];

  for (const w of innerWindows) {
    rangeInner = detectCompression(candles, ctx.ma21, ctx.atr14, index - 1, w, kBlockInner);
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

  // 3. RangeInner phải nằm GẦN CHÍNH GIỮA RangeOuter — không sát biên nào (đúng tài
  // liệu: "hộp nhỏ trong hộp lớn", tách biệt với RB/BB vốn nén sát biên/EMA).
  const outerHeight = rangeOuter.high - rangeOuter.low;
  const outerCenter = (rangeOuter.high + rangeOuter.low) / 2;
  const innerCenter = (rangeInner.high + rangeInner.low) / 2;
  const centerOffset = Math.abs(innerCenter - outerCenter);
  const maxCenterOffset = 0.25 * outerHeight;

  if (centerOffset > maxCenterOffset) {
    trace.push(`RangeInner khong nam giua RangeOuter (centerOffset=${centerOffset.toFixed(5)} > ${maxCenterOffset.toFixed(5)})`);
    return null;
  }
  trace.push(`RangeInner nam giua RangeOuter (centerOffset=${centerOffset.toFixed(5)} <= ${maxCenterOffset.toFixed(5)})`);

  // 4. Xác định hướng breakout từ hành vi giá thật (thử LONG truoc, roi SHORT) —
  // khong suy dien tu vi tri RangeInner nhu ban cu.
  let direction: "LONG" | "SHORT" | null = null;
  if (breaksInDirection(candles, ctx, index, "LONG", rangeInner, rangeOuter, matchedInnerWindow, kBlockInner, trace)) {
    direction = "LONG";
  } else if (breaksInDirection(candles, ctx, index, "SHORT", rangeInner, rangeOuter, matchedInnerWindow, kBlockInner, trace)) {
    direction = "SHORT";
  }

  if (direction === null) {
    trace.push(`Gia chua pha dong thoi RangeInner va RangeOuter o huong nao (close=${candles[index].close.toFixed(5)})`);
    return null;
  }

  // Entry at RangeInner breakout
  const entry = direction === "LONG" ? rangeInner.high : rangeInner.low;
  const stopLoss = direction === "LONG" ? rangeInner.low : rangeInner.high;

  const takeProfit = computeTakeProfit(direction, entry, stopLoss);

  trace.push(`Entry ${direction} tai ${entry.toFixed(5)}, Stop=${stopLoss.toFixed(5)}`);

  // Classify compression tightness for both ranges
  // Both ranges currently share endIndex = index - 1, so these two reads resolve to the
  // same array slot today; kept separate in case that relationship ever changes.
  const tightnessInner = classifyCompressionTightness(rangeInner, kBlockInner, ctx.atr14[rangeInner.endIndex]!);
  const tightnessOuter = classifyCompressionTightness(rangeOuter, kBlockOuter, ctx.atr14[rangeOuter.endIndex]!);
  trace.push(`RangeInner ${tightnessInner}, RangeOuter ${tightnessOuter}`);

  // Confidence
  let confidence = baseConfidence;
  const slope = computeSlope(ctx.ma21, ctx.atr14, index);
  const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
  confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);
  // Apply bonus for inner range tightness (inner is what breaks out, so it's more critical)
  confidence = applyCompressionTightnessBonus(confidence, tightnessInner, trace);
  confidence = applyPriorConsolidationPenalty(candles, entry, atr, rangeOuter.startIndex - 1, confidence, trace);

  confidence = Math.max(0, Math.min(100, confidence));

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
      boxes: [rangeInner, rangeOuter],
      markers: [],
      patternLabel: { index, price: entry, text: kind },
    },
  };
}
