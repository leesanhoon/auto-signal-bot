import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "../setup-types.js";
import { classifyTrend, detectCompression } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, applyStandardConfidenceAdjustments } from "./shared.js";

/**
 * BB — Block Break
 * UPTREND/DOWNTREND with |EMA20 slope| > 0.2.
 * Block (compression) forms near EMA20 → close breaks block boundary in trend direction.
 */
export function detectBb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "BB";

  if (index < 1) return null;

  const trend = classifyTrend(candles, ctx.ema20, ctx.atr14, index);
  if (trend === "FLAT") {
    trace.push(`Trend=FLAT -> khong ap dung BB`);
    return null;
  }
  trace.push(`Trend=${trend}`);

  const ema = ctx.ema20[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // Stricter slope requirement for BB: |slope| > 0.15 (giu nguyen nguong goc,
  // khong lien quan gi den viec doi thoi diem phat tin hieu pre-position)
  const slope = computeSlope(ctx.ema20, ctx.atr14, index);
  if (slope === null || Math.abs(slope) <= 0.15) {
    trace.push(`|slope|=${slope !== null ? Math.abs(slope).toFixed(2) : 'null'} <= 0.15 -> khong du doc cho BB`);
    return null;
  }
  trace.push(`EMA20 slope=${slope.toFixed(2)}`);

  // Detect compression (block) — window 4-6, default kBlock=1.2 (giu nguyen da-window
  // goc, khong lien quan gi den viec doi thoi diem phat tin hieu pre-position)
  const windowSizes = [4, 5, 6];
  let block: ReturnType<typeof detectCompression> = null;

  for (const w of windowSizes) {
    block = detectCompression(candles, ctx.ema20, ctx.atr14, index - 1, w, 1.2);
    if (block !== null) {
      trace.push(`Block detected w=${w}, range=${block.range.toFixed(5)}, distanceToEma=${block.distanceToEma.toFixed(2)}`);
      break;
    }
  }

  if (block === null) {
    trace.push(`Khong phat hien Block trong 4-6 nen`);
    return null;
  }

  // Block must be near EMA20
  if (block.distanceToEma > 0.35) {
    trace.push(`Block cach EMA20 ${block.distanceToEma.toFixed(2)} ATR (>0.35) -> khong sat EMA`);
    return null;
  }
  trace.push(`Block sat EMA20, distance=${block.distanceToEma.toFixed(2)} ATR`);

  // Direction is determined by trend (BEFORE breakout happens) — signal when block is
  // ready, NOT when price has already broken out. Neu cung 1 block van con "sat EMA"
  // qua nhieu index lien tiep, detector co the tra tin hieu o nhieu index (entry/SL hoi
  // khac nhau do cua so truot) — KHONG tu dedup o day; resolveSetupConflicts() da gom
  // theo pair va chi giu 1 tin hieu/pair moi lan quet, nen khong tao lenh Binance trung
  // lap thuc te. (Xem reviews/review-06-pre-position-stop-entry.md — option b.)
  const direction = trend === "UPTREND" ? "LONG" : "SHORT";

  trace.push(`Block san sang, theo trend ${direction}: STOP chap Binance truoc khi gia breakout`);

  // Entry/Stop/Target
  const entry = direction === "LONG" ? block.high : block.low;
  const stopLoss = direction === "LONG" ? block.low : block.high;
  const risk = Math.abs(entry - stopLoss);
  const takeProfit1 = direction === "LONG"
    ? entry + 1.5 * risk
    : entry - 1.5 * risk;
  const takeProfit2 = direction === "LONG"
    ? entry + 2.5 * risk
    : entry - 2.5 * risk;

  trace.push(`Entry ${direction} tai ${entry.toFixed(5)}, Stop=${stopLoss.toFixed(5)}`);

  // Confidence
  let confidence = baseConfidence;
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
    triggerIndex: block.endIndex,
    ruleTrace: trace,
  };
}
