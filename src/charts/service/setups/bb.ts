import type { Candle } from "../../client/ohlc-provider.js";
import type {
  DetectedSignal,
  DetectionContext,
  SetupKind,
} from "../../model/setup-types.js";
import {
  classifyTrend,
  detectCompression,
  classifyCompressionTightness,
} from "../indicators.js";
import {
  baseConfidence,
  computeSlope,
  computeBodyRatio,
  computeTakeProfit,
  applyStandardConfidenceAdjustments,
  applyCompressionTightnessBonus,
  applyPriorConsolidationPenalty,
} from "./shared.js";
import { COMPRESSION_PARAMS } from "./compression-params.js";

/**
 * BB — Block Break
 * UPTREND/DOWNTREND with |EMA21 slope| > 0.2.
 * Block (compression) forms near EMA21 → close breaks block boundary in trend direction.
 */
export function detectBb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "BB";

  if (index < 1) return null;

  const trend = classifyTrend(candles, ctx.ma21, ctx.atr14, index);
  if (trend === "FLAT") {
    trace.push(`Trend=FLAT -> khong ap dung BB`);
    return null;
  }
  trace.push(`Trend=${trend}`);

  const ema = ctx.ma21[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // Stricter slope requirement for BB: |slope| > 0.15 (giu nguyen nguong goc,
  // khong lien quan gi den viec doi thoi diem phat tin hieu pre-position)
  const slope = computeSlope(ctx.ma21, ctx.atr14, index);
  if (slope === null || Math.abs(slope) <= 0.15) {
    trace.push(
      `|slope|=${slope !== null ? Math.abs(slope).toFixed(2) : "null"} <= 0.15 -> khong du doc cho BB`,
    );
    return null;
  }
  trace.push(`EMA21 slope=${slope.toFixed(2)}`);

  // Detect compression (block) using centralized params
  const { windows: windowSizes, kBlock } = COMPRESSION_PARAMS.BB;
  let block: ReturnType<typeof detectCompression> = null;

  for (const w of windowSizes) {
    block = detectCompression(
      candles,
      ctx.ma21,
      ctx.atr14,
      index - 1,
      w,
      kBlock,
    );
    if (block !== null) {
      trace.push(
        `Block detected w=${w}, range=${block.range.toFixed(5)}, distanceToEma=${block.distanceToEma.toFixed(2)}`,
      );
      trace.push(
        `Hop nen: dinh=${block.high.toFixed(5)}, day=${block.low.toFixed(5)}`,
      );
      break;
    }
  }

  if (block === null) {
    trace.push(`Khong phat hien Block trong 4-6 nen`);
    return null;
  }

  // Block must be near EMA21
  if (block.distanceToEma > 0.35) {
    trace.push(
      `Block cach EMA21 ${block.distanceToEma.toFixed(2)} ATR (>0.35) -> khong sat EMA`,
    );
    return null;
  }
  trace.push(`Block sat EMA21, distance=${block.distanceToEma.toFixed(2)} ATR`);

  // Classify compression tightness
  const blockAtr = ctx.atr14[block.endIndex]!;
  const tightness = classifyCompressionTightness(block, kBlock, blockAtr);
  trace.push(
    `Nen ${tightness} (range=${block.range.toFixed(5)}, max=${(kBlock * blockAtr).toFixed(5)})`,
  );

  // Direction is determined by trend (BEFORE breakout happens) — signal when block is
  // ready, NOT when price has already broken out. Neu cung 1 block van con "sat EMA"
  // qua nhieu index lien tiep, detector co the tra tin hieu o nhieu index (entry/SL hoi
  // khac nhau do cua so truot) — KHONG tu dedup o day; resolveSetupConflicts() da gom
  // theo pair va chi giu 1 tin hieu/pair moi lan quet, nen khong tao lenh Binance trung
  // lap thuc te (pre-position stop entry cho block ready truoc khi breakout xay ra).
  const direction = trend === "UPTREND" ? "LONG" : "SHORT";

  trace.push(
    `Block san sang, theo trend ${direction}: STOP chap Binance truoc khi gia breakout`,
  );

  // Entry/Stop/Target
  const entry = direction === "LONG" ? block.high : block.low;
  const stopLoss = direction === "LONG" ? block.low : block.high;
  const takeProfit = computeTakeProfit(direction, entry, stopLoss);

  trace.push(
    `Entry ${direction} tai ${entry.toFixed(5)}, Stop=${stopLoss.toFixed(5)}`,
  );

  // Confidence
  let confidence = baseConfidence;
  const bodyRatio = computeBodyRatio(
    candles[index].open,
    candles[index].high,
    candles[index].low,
    candles[index].close,
  );
  confidence = applyStandardConfidenceAdjustments(
    confidence,
    slope,
    bodyRatio,
    trace,
  );
  confidence = applyCompressionTightnessBonus(confidence, tightness, trace);
  confidence = applyPriorConsolidationPenalty(candles, entry, atr, block.startIndex - 1, confidence, trace);

  return {
    setup: kind,
    pair: ctx.pair,
    timeframe: ctx.timeframe,
    direction,
    entry,
    stopLoss,
    takeProfit,
    confidence,
    triggerIndex: block.endIndex,
    ruleTrace: trace,
    geometry: {
      boxes: [block],
      markers: [],
      patternLabel: { index: block.endIndex, price: entry, text: kind },
    },
  };
}
