import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind, ChartMarker } from "../setup-types.js";
import { detectCompression, classifyCompressionTightness } from "../indicators.js";
import { baseConfidence, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments, applyCompressionTightnessBonus, applyPriorConsolidationPenalty } from "./shared.js";
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
      trace.push(`Hop range: dinh=${range.high.toFixed(5)}, day=${range.low.toFixed(5)}`);
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
  const rangeAtr = ctx.atr14[range.endIndex]!;
  const tightness = classifyCompressionTightness(range, kBlockRb, rangeAtr);
  trace.push(`Nen ${tightness} (range=${range.range.toFixed(5)}, max=${(kBlockRb * rangeAtr).toFixed(5)})`)

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

      // Bối cảnh Range theo tài liệu Bob Volman BẮT BUỘC "MA21 nằm phẳng" trước khi
      // phá vỡ — đây là điều kiện định nghĩa, không phải gợi ý phụ. Nếu EMA21 đã dốc
      // sẵn TRƯỚC breakout thì đây không phải bối cảnh Range thật, phải loại.
      if (absSlopeBefore > 0.15) {
        trace.push(`EMA21 da doc tu truoc (slopeBefore=${slopeBefore.toFixed(2)}) -> khong phai boi canh Range (MA phang)`);
        return null;
      }
      trace.push(`EMA21 phang truoc breakout (slopeBefore=${slopeBefore.toFixed(2)}), chuyen sang doc (slopeNow=${slopeNow.toFixed(2)})`);

      // Dem doc lap so lan cham bat o CA 2 bien (tren/duoi) cua range, roi suy ra
      // direction tu canh nao da duoc cham bat >=2 lan — thay vi cho gia da dong cua
      // vuot bien (qua tre). Day la thay doi chinh de RB ban signal som hon.
      const touchTolerance = 0.15 * atr;
      let upperTouchCount = 0;
      let lowerTouchCount = 0;
      const upperTouchMarkers: ChartMarker[] = [];
      const lowerTouchMarkers: ChartMarker[] = [];
      for (let i = range.startIndex; i <= range.endIndex; i++) {
        const c = candles[i];
        if (c.high >= range.high - touchTolerance && c.close <= range.high) {
          upperTouchCount++;
          upperTouchMarkers.push({ index: i, price: c.high, label: `Touch #${upperTouchCount}` });
        }
        if (c.low <= range.low + touchTolerance && c.close >= range.low) {
          lowerTouchCount++;
          lowerTouchMarkers.push({ index: i, price: c.low, label: `Touch #${lowerTouchCount}` });
        }
      }

      const upperReady = upperTouchCount >= 2;
      const lowerReady = lowerTouchCount >= 2;

      if (!upperReady && !lowerReady) {
        trace.push(`Chua bien nao du 2 lan cham bat (tren=${upperTouchCount}, duoi=${lowerTouchCount}) -> chua ready`);
        return null;
      }

      let direction: "LONG" | "SHORT";
      let touchCount: number;
      let touchMarkers: ChartMarker[];

      if (upperReady && lowerReady) {
        // Ca 2 bien deu du >=2 lan cham bat (binh thuong voi 1 range/box that) — dung
        // slopeNow (EMA21 dang nghieng huong nao) de phan xu huong du kien, thay vi bo
        // qua signal. Day la dung dinh nghia goc cua RB: "EMA21 chuyen tu phang sang doc
        // theo huong breakout".
        if (slopeNow > 0) {
          direction = "LONG";
          touchCount = upperTouchCount;
          touchMarkers = upperTouchMarkers;
          trace.push(`Ca 2 bien deu co >=2 lan cham bat -> dung EMA21 slopeNow=${slopeNow.toFixed(2)} (>0) de chon huong LONG`);
        } else if (slopeNow < 0) {
          direction = "SHORT";
          touchCount = lowerTouchCount;
          touchMarkers = lowerTouchMarkers;
          trace.push(`Ca 2 bien deu co >=2 lan cham bat -> dung EMA21 slopeNow=${slopeNow.toFixed(2)} (<0) de chon huong SHORT`);
        } else {
          trace.push(`Ca 2 bien deu co >=2 lan cham bat va slopeNow=0 -> khong ro huong, bo qua`);
          return null;
        }
      } else {
        direction = upperReady ? "LONG" : "SHORT";
        touchCount = upperReady ? upperTouchCount : lowerTouchCount;
        touchMarkers = upperReady ? upperTouchMarkers : lowerTouchMarkers;
        trace.push(`Direction du kien ${direction} tu ${touchCount} lan cham bat bien ${direction === "LONG" ? "tren" : "duoi"} (>=2, dat)`);
      }

      const slopeAligned = direction === "LONG" ? slopeNow > 0 : slopeNow < 0;
      if (!slopeAligned) {
        trace.push(`EMA21 slope=${slopeNow.toFixed(2)} khong cung huong du kien ${direction}`);
        return null;
      }

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
          markers: touchMarkers,
          patternLabel: { index, price: entry, text: kind },
        },
      };
    }
  }

  trace.push(`Khong du du lieu de kiem tra EMA21 transition (index<10)`);
  return null;
}
