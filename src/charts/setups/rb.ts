import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "../setup-types.js";
import { detectCompression, classifyCompressionTightness } from "../indicators.js";
import { baseConfidence, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments, applyCompressionTightnessBonus } from "./shared.js";
import { COMPRESSION_PARAMS } from "./compression-params.js";

/**
 * RB — Range Break
 * Sideways market (no clear trend needed). Compression with larger range,
 * ≥6 candles, EMA21 transitioning from FLAT to sloping in breakout direction.
 */
export function detectRb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "RB";

  if (index < 1) return null;

  const ema = ctx.ma21[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // Detect compression with larger window using centralized params
  // RB uses a range that is wider than a BB block
  const { windows: windowSizes, kBlock: kBlockRb } = COMPRESSION_PARAMS.RB;
  let range: ReturnType<typeof detectCompression> = null;

  for (const w of windowSizes) {
    range = detectCompression(candles, ctx.ma21, ctx.atr14, index - 1, w, kBlockRb);
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

  // Classify compression tightness
  const tightness = classifyCompressionTightness(range, kBlockRb, atr);
  trace.push(`Nen ${tightness} (range=${range.range.toFixed(5)}, max=${(kBlockRb * atr).toFixed(5)})`)

  // Check EMA21 transitioning from FLAT to sloping in breakout direction
  // Look at slope progression: 5 candles ago was near FLAT, now sloping
  if (index >= 10) {
    const emaNow = ctx.ma21[index];
    const ema5 = ctx.ma21[index - 5];
    const ema10 = ctx.ma21[Math.max(0, index - 10)];
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
        trace.push(`EMA21 slope=${slopeNow.toFixed(2)} khong cung huong breakout ${direction}`);
        return null;
      }

      // Bối cảnh Range theo tài liệu Bob Volman BẮT BUỘC "MA21 nằm phẳng" trước khi
      // phá vỡ — đây là điều kiện định nghĩa, không phải gợi ý phụ. Nếu EMA21 đã dốc
      // sẵn TRƯỚC breakout thì đây không phải bối cảnh Range thật, phải loại.
      if (absSlopeBefore > 0.15) {
        trace.push(`EMA21 da doc tu truoc (slopeBefore=${slopeBefore.toFixed(2)}) -> khong phai boi canh Range (MA phang)`);
        return null;
      }
      trace.push(`EMA21 phang truoc breakout (slopeBefore=${slopeBefore.toFixed(2)}), chuyen sang doc (slopeNow=${slopeNow.toFixed(2)})`);

      // Tài liệu yêu cầu hộp Range phải có "ít nhất 2 lần chạm bật" ở đường biên quan
      // trọng (biên bị phá vỡ) trước khi được coi là Range hợp lệ — nến chỉ chạm gần
      // biên rồi đóng cửa lại bên trong hộp (không phải nến phá vỡ thật).
      const touchTolerance = 0.15 * atr;
      const boundaryLevel = direction === "LONG" ? range.high : range.low;
      let touchCount = 0;
      for (let i = range.startIndex; i <= range.endIndex; i++) {
        const c = candles[i];
        if (direction === "LONG") {
          if (c.high >= boundaryLevel - touchTolerance && c.close <= boundaryLevel) touchCount++;
        } else {
          if (c.low <= boundaryLevel + touchTolerance && c.close >= boundaryLevel) touchCount++;
        }
      }
      if (touchCount < 2) {
        trace.push(`Chi ${touchCount} lan cham bat bien ${direction === "LONG" ? "tren" : "duoi"} (can >=2) -> chua du xac nhan Range`);
        return null;
      }
      trace.push(`${touchCount} lan cham bat bien ${direction === "LONG" ? "tren" : "duoi"} (>=2, dat)`);

      // Entry/Stop/Target
      const entry = direction === "LONG" ? range.high : range.low;
      const stopLoss = direction === "LONG" ? range.low : range.high;

      const rangeHeight = range.high - range.low;
      const takeProfit = computeTakeProfit(direction, entry, stopLoss);

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
        geometry: { boxes: [range], markers: [] },
      };
    }
  }

  trace.push(`Khong du du lieu de kiem tra EMA21 transition (index<10)`);
  return null;
}
