import type { Candle } from "./ohlc-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrendState = "UPTREND" | "DOWNTREND" | "FLAT";

export type CompressionWindow = {
  startIndex: number;
  endIndex: number;
  high: number;
  low: number;
  range: number;
  /** |mean(Close của cửa sổ) - EMA20[endIndex]| / ATR14[endIndex] */
  distanceToEma: number;
};

// ---------------------------------------------------------------------------
// 1. EMA — Exponential Moving Average
// ---------------------------------------------------------------------------

/**
 * Tính EMA chuẩn (SMA seed cho period đầu tiên).
 * Trả về mảng cùng độ dài `candles`; các index chưa đủ dữ liệu trả `null`.
 */
export function calculateEma(
  candles: Candle[],
  period: number,
): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0 || period <= 0) return result;

  const k = 2 / (period + 1);

  // SMA seed
  let sum = 0;
  for (let i = 0; i < period && i < candles.length; i++) {
    sum += candles[i].close;
  }
  if (candles.length >= period) {
    result[period - 1] = sum / period;
  } else {
    return result; // không đủ dữ liệu
  }

  // EMA cho các index sau
  for (let i = period; i < candles.length; i++) {
    result[i] = candles[i].close * k + result[i - 1]! * (1 - k);
  }

  return result;
}

// ---------------------------------------------------------------------------
// 2. ATR — Average True Range
// ---------------------------------------------------------------------------

/**
 * Tính ATR(14) dùng EMA chuẩn trên True Range.
 * Lựa chọn: dùng EMA chuẩn (không Wilder smoothing) cho đơn giản.
 * Trả về mảng cùng độ dài `candles`; các index chưa đủ dữ liệu trả `null`.
 */
export function calculateAtr(
  candles: Candle[],
  period = 14,
): (number | null)[] {
  const tr: number[] = new Array(candles.length);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      tr[i] = c.high - c.low;
    } else {
      const prevClose = candles[i - 1].close;
      tr[i] = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose),
      );
    }
  }

  // ATR = EMA(TrueRange, period)
  return calculateEma(
    tr.map((v) => ({ time: 0, open: 0, high: 0, low: 0, close: v, volume: 0 })),
    period,
  );
}

// ---------------------------------------------------------------------------
// 3. Trend Slope Classifier
// ---------------------------------------------------------------------------

/**
 * Phân loại trend tại index dựa trên slope của EMA20 chuẩn hóa theo ATR.
 *
 * slope = (EMA20[i] - EMA20[i-5]) / ATR14[i]
 * - UPTREND: slope > 0.15 và đa số (≥6/10) nến gần nhất có Close > EMA20
 * - DOWNTREND: slope < -0.15 và đa số (≥6/10) nến gần nhất có Close < EMA20
 * - FLAT: còn lại, hoặc thiếu dữ liệu
 */
export function classifyTrend(
  candles: Candle[],
  ema20: (number | null)[],
  atr14: (number | null)[],
  index: number,
): TrendState {
  if (index < 5 || index >= candles.length) return "FLAT";

  const ema = ema20[index];
  const emaPrev = ema20[index - 5];
  const atr = atr14[index];

  if (ema === null || emaPrev === null || atr === null || atr === 0)
    return "FLAT";

  const slope = (ema - emaPrev) / atr;

  // Count recent candles: how many have close > EMA20
  let aboveCount = 0;
  let belowCount = 0;
  const lookback = Math.min(10, index + 1);
  for (let i = index - lookback + 1; i <= index; i++) {
    const e = ema20[i];
    if (e === null) continue;
    if (candles[i].close > e) aboveCount++;
    else if (candles[i].close < e) belowCount++;
  }

  if (slope > 0.15 && aboveCount >= 6) return "UPTREND";
  if (slope < -0.15 && belowCount >= 6) return "DOWNTREND";
  return "FLAT";
}

// ---------------------------------------------------------------------------
// 4. Doji Detector
// ---------------------------------------------------------------------------

/**
 * Kiểm tra nến có phải Doji không (theo context.md §1.3).
 * body ≤ Zdoji · ATR  VÀ  body/range ≤ 0.25
 */
export function isDoji(
  candle: Candle,
  atr: number,
  zDoji = 0.15,
): boolean {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;

  if (range === 0) return false; // tránh chia 0
  if (body > zDoji * atr) return false;
  if (body / range > 0.25) return false;

  return true;
}

// ---------------------------------------------------------------------------
// 5. Compression/Block Detector
// ---------------------------------------------------------------------------

/**
 * Phát hiện compression (block/range) trên cửa sổ trượt.
 *
 * QUAN TRỌNG: `endIndex` phải là nến CUỐI CÙNG của block/range đã đóng, KHÔNG
 * bao gồm nến breakout đang được kiểm tra. Nếu bạn đang kiểm tra breakout tại
 * `index`, hãy truyền `endIndex = index - 1`; nếu không, `close > block.high`
 * sẽ gần như luôn sai vì `block.high` đã bao gồm chính nến breakout.
 *
 * range = Max(High) - Min(Low) trong cửa sổ
 * Trả CompressionWindow nếu range ≤ kBlock * ATR14[endIndex],
 * ngược lại trả null.
 */
export function detectCompression(
  candles: Candle[],
  ema20: (number | null)[],
  atr14: (number | null)[],
  endIndex: number,
  windowSize: number,
  kBlock = 1.2,
): CompressionWindow | null {
  // endIndex must be the last closed candle; the breakout candle itself stays outside the window.
  const startIndex = endIndex - windowSize + 1;

  if (
    startIndex < 0 ||
    endIndex >= candles.length ||
    windowSize < 1
  ) {
    return null;
  }

  const ema = ema20[endIndex];
  const atr = atr14[endIndex];
  if (ema === null || atr === null || atr === 0) return null;

  // Compute range
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let sumClose = 0;

  for (let i = startIndex; i <= endIndex; i++) {
    const c = candles[i];
    if (c.high > maxHigh) maxHigh = c.high;
    if (c.low < minLow) minLow = c.low;
    sumClose += c.close;
  }

  const range = maxHigh - minLow;

  if (range > kBlock * atr) return null;

  const meanClose = sumClose / windowSize;
  const distanceToEma = Math.abs(meanClose - ema) / atr;

  return { startIndex, endIndex, high: maxHigh, low: minLow, range, distanceToEma };
}

// ---------------------------------------------------------------------------
// 6. False-break Filter
// ---------------------------------------------------------------------------

/**
 * Kiểm tra xem breakout tại `breakoutIndex` có bị false không.
 * False = có nến trong `lookahead` nến sau đó đóng cửa quay lại
 * trong khoảng `[levelLow, levelHigh]`.
 */
export function isFalseBreak(
  candles: Candle[],
  breakoutIndex: number,
  levelHigh: number,
  levelLow: number,
  direction: "LONG" | "SHORT",
  lookahead = 2,
): boolean {
  const end = Math.min(breakoutIndex + lookahead, candles.length - 1);

  for (let i = breakoutIndex + 1; i <= end; i++) {
    const close = candles[i].close;
    if (close >= levelLow && close <= levelHigh) {
      return true; // quay lại trong range
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Kiểm tra xem candle time có nằm trong khung giờ giao dịch London/NY overlap
 * (13:00-21:00 UTC) và ATR không quá thấp (không dưới 30% ATR trung bình 20 ngày).
 */
export function isTradableWindow(
  candleTime: number, // epoch ms
  atr14Now: number,
  atr14Avg20d: number,
): boolean {
  const date = new Date(candleTime);
  const hour = date.getUTCHours();
  // London/NY overlap: 13:00–21:00 UTC
  if (hour < 13 || hour >= 21) return false;
  // Volatility floor: ATR hiện tại ≥ 30% ATR trung bình 20 ngày
  if (atr14Now < 0.3 * atr14Avg20d) return false;
  return true;
}

/**
 * Tính trung bình ATR trên N nến gần nhất (dùng cho volatility floor).
 * Nếu không đủ dữ liệu, trả giá trị thấp nhất có (không null).
 */
export function averageAtr(
  atr14: (number | null)[],
  index: number,
  lookback: number,
): number | null {
  if (index < 0 || index >= atr14.length) return null;
  let sum = 0;
  let count = 0;
  const start = Math.max(0, index - lookback + 1);
  for (let i = start; i <= index; i++) {
    const v = atr14[i];
    if (v !== null) {
      sum += v;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}
