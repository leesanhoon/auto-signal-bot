import type { Candle } from "../ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind, SetupChartGeometry } from "../setup-types.js";
import { classifyTrend, isFalseBreak } from "../indicators.js";
import { baseConfidence, computeSlope, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments, isHarmonicPullback } from "./shared.js";

/**
 * SB — Second Break
 * Trend market with W-pattern (double bottom for LONG, double top for SHORT).
 * First break attempt failed, price formed 2 lows/highs near MA21.
 * Entry: Price breaks out from W on the second attempt (close penetrates W boundary).
 * Stop Loss: Below the second (lower) bottom ± 0.1 ATR.
 */
export function detectSb(
  candles: Candle[],
  index: number,
  ctx: DetectionContext,
): DetectedSignal | null {
  const trace: string[] = [];
  const kind: SetupKind = "SB";

  if (index < 15) return null; // Need enough history to find pattern

  const trend = classifyTrend(candles, ctx.ma21, ctx.atr14, index);
  if (trend === "FLAT") {
    trace.push(`Trend=FLAT -> khong ap dung SB`);
    return null;
  }
  trace.push(`Trend=${trend}`);

  const ema = ctx.ma21[index];
  const atr = ctx.atr14[index];
  if (ema === null || atr === null || atr === 0) return null;

  // Detect W-pattern: 2 bottoms (for LONG) or 2 tops (for SHORT) near MA21
  const lookback = 15;
  const startLookback = Math.max(0, index - lookback);

  // For LONG: find 2 lows
  // For SHORT: find 2 highs
  const direction = trend === "UPTREND" ? "LONG" : "SHORT";

  if (direction === "LONG") {
    // Find 2 lows in the lookback window, both near MA21
    let firstLowIndex = -1;
    let firstLow = Infinity;
    let secondLowIndex = -1;
    let secondLow = Infinity;

    for (let i = startLookback; i < index; i++) {
      const low = candles[i].low;
      const distToEma = Math.abs(low - ema) / atr;

      // Must be near MA21 (within 0.5 ATR)
      if (distToEma > 0.5) continue;

      if (firstLowIndex === -1) {
        firstLowIndex = i;
        firstLow = low;
      } else if (i - firstLowIndex >= 3) {
        // Second low must be at least 3 candles after first
        if (secondLowIndex === -1) {
          secondLowIndex = i;
          secondLow = low;
        } else if (low < secondLow) {
          // Keep updating to lower second low
          secondLowIndex = i;
          secondLow = low;
        }
      }
    }

    if (firstLowIndex < 0 || secondLowIndex < 0) {
      trace.push(`Khong phat hien 2 day trong pattern W`);
      return null;
    }

    // W-pattern: low2 should be roughly similar to low1 (within 0.3 ATR difference)
    if (Math.abs(secondLow - firstLow) > 0.3 * atr) {
      trace.push(`2 day cua W khong dung (chenh lech > 0.3 ATR)`);
      return null;
    }

    trace.push(`Pattern W: low1=${firstLow.toFixed(5)} @ index ${firstLowIndex}, low2=${secondLow.toFixed(5)} @ index ${secondLowIndex}`);

    // Tai lieu: "Gia keo nguoc ve MA21 bang song hai hoa" truoc khi tao day 1 cua W —
    // giong DDB/FB, doan song dan toi day 1 phai la 1 song don, khong nam ngang.
    // QUAN TRONG: pullbackStart phai la diem swing-high GAN NHAT truoc day 1 (do dai
    // song thuc te), KHONG phai cua so co dinh 10 nen — 1 cua so co dinh qua dai gan
    // nhu khong bao gio don dieu trong du lieu thuc (da xac nhan: 0/369 pass truoc khi
    // sua), lam SB khong bao gio bat tin hieu. DDB/FB deu xac dinh diem bat dau song
    // theo cau truc gia thuc, o day dung swing-high gan nhat lam tuong duong.
    let swingHighIndex = firstLowIndex - 1;
    for (let i = firstLowIndex - 1; i >= Math.max(0, firstLowIndex - 10); i--) {
      if (candles[i].high > candles[swingHighIndex].high) swingHighIndex = i;
    }
    const pullbackStart = swingHighIndex;
    if (!isHarmonicPullback(candles, pullbackStart, firstLowIndex, atr)) {
      trace.push(`Song dan toi day 1 khong phai song hai hoa -> bo qua`);
      return null;
    }
    trace.push(`Song dan toi day 1 la song hai hoa`);

    // Day 1 phai la mot cu pha vo that bai (gia da tung dam xuong duoi roi dong cua
    // quay lai) - day la dieu kien dinh nghia cot loi cua SB theo tai lieu Bob Volman
    // ("cu pha vo dau tien da that bai"). KHONG duoc chi log ma phai gate cung, neu
    // khong SB se khop voi bat ky pattern 2-day thong thuong nao (qua pho bien, mat
    // tinh chon loc "second break").
    const levelHigh = Math.max(firstLow, secondLow) + 0.1 * atr;
    const levelLow = Math.min(firstLow, secondLow) - 0.1 * atr;
    if (!isFalseBreak(candles, firstLowIndex, levelHigh, levelLow, "LONG", 5)) {
      trace.push(`Day 1 khong bi false break -> khong phai SB that, bo qua`);
      return null;
    }
    trace.push(`Day 1 bi false break (xac nhan pattern W)`);

    // Tin hieu phat khi pattern W da san sang NHUNG gia CHUA pha vo (entry = wHigh la
    // muc gia can xac nhan trong tuong lai, kieu Alert/Buy-Stop). Neu close cua chinh
    // nen hien tai da vuot qua wHigh roi thi tin hieu da qua han - KHONG duoc dat entry
    // vao mot muc gia da bi vuot qua (se tao loi look-ahead: fill gia ao trong backtest,
    // khong the mua that trong live).
    const wHigh = Math.max(firstLow, secondLow);
    if (candles[index].close >= wHigh) {
      trace.push(`Gia da vuot qua wHigh tai nen hien tai (close=${candles[index].close.toFixed(5)}, wHigh=${wHigh.toFixed(5)}) -> tin hieu qua han, bo qua`);
      return null;
    }
    trace.push(`Pattern W san sang, cho gia pha len tren ${wHigh.toFixed(5)} de xac nhan (Alert)`);

    // Entry/Stop/Target
    const entry = wHigh;
    const stopLoss = secondLow - 0.1 * atr;
    const takeProfit = computeTakeProfit("LONG", entry, stopLoss);

    trace.push(`Entry LONG tai ${entry.toFixed(5)}, Stop=${stopLoss.toFixed(5)}`);

    // Confidence
    let confidence = baseConfidence;
    const slope = computeSlope(ctx.ma21, ctx.atr14, index);
    const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
    confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);

    const geometry: SetupChartGeometry = {
      boxes: [],
      markers: [],
      highlightCandles: [
        { index: firstLowIndex, label: "Bottom 1" },
        { index: secondLowIndex, label: "Bottom 2" },
      ],
      lines: [
        {
          points: [
            { index: pullbackStart, price: candles[pullbackStart].close },
            { index: firstLowIndex, price: firstLow },
          ],
          label: "Pullback",
          style: "pullback",
        },
        {
          points: [
            { index: firstLowIndex, price: firstLow },
            { index: secondLowIndex, price: secondLow },
          ],
          label: "W-pattern",
          style: "pattern",
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
      direction: "LONG",
      entry,
      stopLoss,
      takeProfit,
      confidence,
      triggerIndex: index,
      ruleTrace: trace,
      geometry,
    };
  } else {
    // SHORT: find 2 highs
    let firstHighIndex = -1;
    let firstHigh = -Infinity;
    let secondHighIndex = -1;
    let secondHigh = -Infinity;

    for (let i = startLookback; i < index; i++) {
      const high = candles[i].high;
      const distToEma = Math.abs(high - ema) / atr;

      // Must be near MA21 (within 0.5 ATR)
      if (distToEma > 0.5) continue;

      if (firstHighIndex === -1) {
        firstHighIndex = i;
        firstHigh = high;
      } else if (i - firstHighIndex >= 3) {
        // Second high must be at least 3 candles after first
        if (secondHighIndex === -1) {
          secondHighIndex = i;
          secondHigh = high;
        } else if (high > secondHigh) {
          // Keep updating to higher second high
          secondHighIndex = i;
          secondHigh = high;
        }
      }
    }

    if (firstHighIndex < 0 || secondHighIndex < 0) {
      trace.push(`Khong phat hien 2 dinh trong pattern W`);
      return null;
    }

    // W-pattern: high2 should be roughly similar to high1 (within 0.3 ATR difference)
    if (Math.abs(secondHigh - firstHigh) > 0.3 * atr) {
      trace.push(`2 dinh cua W khong dung (chenh lech > 0.3 ATR)`);
      return null;
    }

    trace.push(`Pattern W: high1=${firstHigh.toFixed(5)} @ index ${firstHighIndex}, high2=${secondHigh.toFixed(5)} @ index ${secondHighIndex}`);

    // Song dan toi dinh 1 phai la song hai hoa (xem giai thich o nhanh LONG) - dung
    // swing-low gan nhat truoc dinh 1 lam diem bat dau song (khong phai cua so co dinh).
    let swingLowIndex = firstHighIndex - 1;
    for (let i = firstHighIndex - 1; i >= Math.max(0, firstHighIndex - 10); i--) {
      if (candles[i].low < candles[swingLowIndex].low) swingLowIndex = i;
    }
    const pullbackStartShort = swingLowIndex;
    if (!isHarmonicPullback(candles, pullbackStartShort, firstHighIndex, atr)) {
      trace.push(`Song dan toi dinh 1 khong phai song hai hoa -> bo qua`);
      return null;
    }
    trace.push(`Song dan toi dinh 1 la song hai hoa`);

    // Dinh 1 phai la mot cu pha vo that bai (xem giai thich o nhanh LONG) - gate cung.
    const levelHigh = Math.max(firstHigh, secondHigh) + 0.1 * atr;
    const levelLow = Math.min(firstHigh, secondHigh) - 0.1 * atr;
    if (!isFalseBreak(candles, firstHighIndex, levelHigh, levelLow, "SHORT", 5)) {
      trace.push(`Dinh 1 khong bi false break -> khong phai SB that, bo qua`);
      return null;
    }
    trace.push(`Dinh 1 bi false break (xac nhan pattern W)`);

    // Tin hieu phat khi pattern W san sang nhung gia CHUA pha vo (entry = wLow la muc
    // gia can xac nhan trong tuong lai). Neu close hien tai da vuot qua roi thi qua han.
    const wLow = Math.min(firstHigh, secondHigh);
    if (candles[index].close <= wLow) {
      trace.push(`Gia da vuot qua wLow tai nen hien tai (close=${candles[index].close.toFixed(5)}, wLow=${wLow.toFixed(5)}) -> tin hieu qua han, bo qua`);
      return null;
    }
    trace.push(`Pattern W san sang, cho gia pha xuong duoi ${wLow.toFixed(5)} de xac nhan (Alert)`);

    // Entry/Stop/Target
    const entry = wLow;
    const stopLoss = secondHigh + 0.1 * atr;
    const takeProfit = computeTakeProfit("SHORT", entry, stopLoss);

    trace.push(`Entry SHORT tai ${entry.toFixed(5)}, Stop=${stopLoss.toFixed(5)}`);

    // Confidence
    let confidence = baseConfidence;
    const slope = computeSlope(ctx.ma21, ctx.atr14, index);
    const bodyRatio = computeBodyRatio(candles[index].open, candles[index].high, candles[index].low, candles[index].close);
    confidence = applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace);

    const geometry: SetupChartGeometry = {
      boxes: [],
      markers: [],
      highlightCandles: [
        { index: firstHighIndex, label: "Top 1" },
        { index: secondHighIndex, label: "Top 2" },
      ],
      lines: [
        {
          points: [
            { index: pullbackStartShort, price: candles[pullbackStartShort].close },
            { index: firstHighIndex, price: firstHigh },
          ],
          label: "Pullback",
          style: "pullback",
        },
        {
          points: [
            { index: firstHighIndex, price: firstHigh },
            { index: secondHighIndex, price: secondHigh },
          ],
          label: "M-pattern",
          style: "pattern",
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
      direction: "SHORT",
      entry,
      stopLoss,
      takeProfit,
      confidence,
      triggerIndex: index,
      ruleTrace: trace,
      geometry,
    };
  }
}
