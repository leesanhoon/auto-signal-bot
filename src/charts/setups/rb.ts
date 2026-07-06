import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "../setup-types.js";
import { detectCompression } from "../indicators.js";
import { baseConfidence, computeBodyRatio, applyStandardConfidenceAdjustments } from "./shared.js";

/**
 * RB — Range Break
 * Sideways market (no clear trend needed). Compression with larger range,
 * ≥6 candles, EMA20 transitioning from FLAT to sloping in breakout direction.
 */
export function detectRb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "RB";

  if (index < 1) return null;

  const ema = ctx.ema20[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // Detect compression with larger window (6-10) and larger kBlock
  // RB uses a range that is wider than a BB block
  const windowSizes = [10, 8, 6];
  const kBlockRb = 2.0; // Larger threshold for range vs block
  let range: ReturnType<typeof detectCompression> = null;

  for (const w of windowSizes) {
    range = detectCompression(candles, ctx.ema20, ctx.atr14, index, w, kBlockRb);
    if (range !== null) {
      trace.push(`Range detected w=${w}, range=${range.range.toFixed(5)}, distanceToEma=${range.distanceToEma.toFixed(2)}`);
      break;
    }
  }

  if (range === null) {
    trace.push(`Khong phat hien Range voi Kblock=${kBlockRb}`);
    return null;
  }

  // Range must have at least 6 candles (already satisfied by windowSizes)
  const candleCount = range.endIndex - range.startIndex + 1;
  if (candleCount < 6) {
    trace.push(`Range chi co ${candleCount} nen (<6)`);
    return null;
  }

  // Check EMA20 transitioning from FLAT to sloping in breakout direction
  // Look at slope progression: 5 candles ago was near FLAT, now sloping
  if (index >= 10) {
    const emaNow = ctx.ema20[index];
    const ema5 = ctx.ema20[index - 5];
    const ema10 = ctx.ema20[Math.max(0, index - 10)];
    const atrNow = ctx.atr14[index];
    const atr5 = ctx.atr14[index - 5];

    if (emaNow !== null && ema5 !== null && ema10 !== null && atrNow !== null && atr5 !== null && atrNow !== 0) {
      const slopeNow = (emaNow - ema5) / atrNow;
      const slopeBefore = (ema5 - ema10) / (atr5 || 1);

      const absSlopeBefore = Math.abs(slopeBefore);
      const absSlopeNow = Math.abs(slopeNow);

      // Breakout direction: which side of range did close break?
      const breaksUp = candles[index].close > range.high;
      const breaksDown = candles[index].close < range.low;

      if (!breaksUp && !breaksDown) {
        trace.push(`Gia chua pha range boundary (close=${candles[index].close.toFixed(5)})`);
        return null;
      }

      const direction = breaksUp ? "LONG" : "SHORT";
      const slopeAligned = direction === "LONG" ? slopeNow > 0 : slopeNow < 0;

      if (!slopeAligned) {
        trace.push(`EMA20 slope=${slopeNow.toFixed(2)} khong cung huong breakout ${direction}`);
        return null;
      }

      if (absSlopeBefore > 0.15 && absSlopeNow > 0.15) {
        trace.push(`EMA20 da doc tu truoc (slopeBefore=${slopeBefore.toFixed(2)}), khong phai FLAT->doc`);
        // Still allow but note it
      } else if (absSlopeBefore <= 0.15 && absSlopeNow > 0.15) {
        trace.push(`EMA20 chuyen tu FLAT (slopeBefore=${slopeBefore.toFixed(2)}) sang doc (slopeNow=${slopeNow.toFixed(2)})`);
      } else {
        trace.push(`EMA20 slope chua du manh: before=${slopeBefore.toFixed(2)}, now=${slopeNow.toFixed(2)}`);
        // Still proceed but mark it
      }

      // Entry/Stop/Target
      const entry = direction === "LONG" ? range.high : range.low;
      const stopLoss = direction === "LONG" ? range.low : range.high;

      // TP based on range height (Volman standard)
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

      // Bonus for clear FLAT→trend transition (RB-specific rule)
      if (absSlopeBefore <= 0.15 && absSlopeNow > 0.3) {
        confidence += 15;
        trace.push(`Bonus confidence: FLAT->trend ro ret`);
      }

      const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
      // Reuse slopeNow (already calculated above) instead of recalculating
      confidence = applyStandardConfidenceAdjustments(confidence, slopeNow, bodyRatio, trace);

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
  }

  trace.push(`Khong du du lieu de kiem tra EMA20 transition (index<10)`);
  return null;
}