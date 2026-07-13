import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind, SetupChartGeometry } from "../setup-types.js";
import { classifyTrend } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments, isHarmonicPullback } from "./shared.js";

/**
 * FB — First Break
 * New trend with EMA21 recently switched from FLAT/opposite.
 * First price touch of EMA21 since trend formed → signal bar closes in trend direction.
 */
export function detectFb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "FB";

  if (index < 1) return null;

  const trend = classifyTrend(candles, ctx.ma21, ctx.atr14, index);
  if (trend === "FLAT") {
    trace.push(`Trend=FLAT -> khong ap dung FB`);
    return null;
  }
  trace.push(`Trend=${trend}`);

  const ema = ctx.ma21[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // 1. Trend must have formed recently (within last 10 candles)
  // Di NGUOC tu index-1 (KHONG phai index — tai index, classifyTrend() da chac chan
  // slope>0.15 roi, neu bat dau quet tu do se luon "tim thay" trend ngay lap tuc va
  // dung lai, khien trendStartIndex==index moi lan, tao cua so rong/am cho
  // isHarmonicPullback ben duoi va lam FB khong bao gio bat tin hieu — da xac nhan
  // bang thuc nghiem: 0/2 pass truoc khi sua). Thay vao do, DI NGUOC MIEN LA slope
  // van con manh, dung lai o diem dau tien KHONG con thoa dieu kien nua — do moi la
  // diem bat dau thuc su cua trend.
  const trendLookback = 10;
  let trendStartIndex = index;
  for (let i = index - 1; i >= Math.max(5, index - trendLookback); i--) {
    const emaI = ctx.ma21[i];
    const emaPrevI = ctx.ma21[i - 5];
    const atrI = ctx.atr14[i];
    if (emaI === null || emaPrevI === null || atrI === null || atrI === 0) break;

    const slopeI = (emaI - emaPrevI) / atrI;
    const stillTrending = trend === "UPTREND" ? slopeI > 0.15 : slopeI < -0.15;
    if (!stillTrending) break;
    trendStartIndex = i;
  }

  if (trendStartIndex >= index) {
    trace.push(`Khong tim thay diem bat dau trend trong ${trendLookback} nen`);
    return null;
  }

  // Verify the transition: before trendStartIndex, slope should have been FLAT or opposite
  if (trendStartIndex >= 5) {
    const emaBefore = ctx.ma21[trendStartIndex - 1];
    const emaBeforePrev = ctx.ma21[Math.max(0, trendStartIndex - 6)];
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

  // 2. Count touches of EMA21 since trendStartIndex up to index-1
  let touchCount = 0;
  for (let i = trendStartIndex; i < index; i++) {
    const e = ctx.ma21[i];
    const a = ctx.atr14[i];
    if (e === null || a === null || a === 0) continue;
    const dist = Math.abs(candles[i].close - e) / a;
    // A touch is defined as price being very close to EMA21 (within 0.3 ATR)
    if (dist <= 0.3) {
      touchCount++;
    }
  }

  // 3. Current candle (signal bar) must be a touch
  const currentDistance = Math.abs(candles[index].close - ema) / atr;
  if (currentDistance > 0.3) {
    trace.push(`Gia cach EMA21 ${currentDistance.toFixed(2)} ATR (>0.3) -> khong phai cham EMA`);
    return null;
  }
  trace.push(`Cham EMA21, distance=${currentDistance.toFixed(2)} ATR`);

  touchCount++; // include current candle
  trace.push(`touchCount=${touchCount} (tu trendStartIndex ${trendStartIndex})`);

  if (touchCount > 1) {
    trace.push(`touchCount=${touchCount} > 1 -> khong con la FB`);
    return null;
  }

  // Verify pullback is harmonic (single wave, not horizontal)
  const isHarmonic = isHarmonicPullback(candles, trendStartIndex, index - 1, atr);
  if (!isHarmonic) {
    trace.push(`Pullback khong phai song hieu hoa (ngang hoac danh gia 2 lan)`);
    return null;
  }
  trace.push(`Pullback la song hieu hoa`);

  // 4. Nen hien tai la nen CHAM MA (pullback vua cham EMA21) — day chinh la nen
  // dung de dat stop order theo Buoc 4 tai lieu, KHONG phai nen da xac nhan phuc hoi. Truoc day
  // code con bat buoc CHINH nen nay phai dong cua thuan trend + than nen manh
  // (bodyRatio>=0.5) — thuc te 1 nen vua cham day/dinh pullback (con dang di NGUOC
  // trend) hiem khi dong cua thuan trend NGAY trong cung nen do; da xac nhan bang
  // thuc nghiem dieu kien nay chan 100% tin hieu (0/10 pass tren du lieu that). Vi
  // FB dung stop order tai bien nen tin hieu, nen KHONG can bat buoc lai xac
  // nhan hoi phuc tren chinh nen phat hien nay, chi can dung bodyRatio lam yeu to
  // confidence (xem applyStandardConfidenceAdjustments ben duoi).
  const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
  trace.push(`Cham EMA21, dat stop order tai bien nen tin hieu, bodyRatio hien tai=${bodyRatio.toFixed(2)}`);

  // Entry/Stop/Target
  const direction = trend === "UPTREND" ? "LONG" : "SHORT";
  const signalHigh = candles[index].high;
  const signalLow = candles[index].low;
  const stopBuffer = 0.1 * atr;

  const entry = direction === "LONG" ? signalHigh : signalLow;
  const stopLoss = direction === "LONG"
    ? signalLow - stopBuffer
    : signalHigh + stopBuffer;
  const takeProfit = computeTakeProfit(direction, entry, stopLoss);

  trace.push(`Entry ${direction} tai ${entry.toFixed(5)}, Stop=${stopLoss.toFixed(5)}`);

  // Confidence
  let confidence = baseConfidence;
  const slope = computeSlope(ctx.ma21, ctx.atr14, index);
  confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);

  const geometry: SetupChartGeometry = {
    boxes: [],
    markers: [],
    lines: [
      {
        points: [
          { index: trendStartIndex, price: candles[trendStartIndex].close },
          { index, price: candles[index].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
    patternLabel: {
      index,
      price: entry,
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
