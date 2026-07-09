import type { ChartTimeframe } from "../chart-types.js";
import type { Candle } from "../ohlc-provider.js";
import { fetchOhlcHistory } from "../ohlc-provider.js";
import { findSwingPoints } from "./smc-structure.js";
import { detectTimeframeBias } from "./smc-confluence.js";
import type { SmcDirection, SmcSwingPoint } from "./smc-types.js";

export type HtfContext = {
  timeframe: ChartTimeframe;
  bias: SmcDirection | null;
  swings: SmcSwingPoint[];
  candlesLength: number;
};

/**
 * Map timeframe entry (LTF) sang timeframe HTF tương ứng dùng làm bias/dealing-range.
 * M15 -> H4, H4 -> D1, D1 -> null (không có khung cao hơn cấu hình sẵn).
 */
export function getHtfTimeframeFor(entryTimeframe: ChartTimeframe): ChartTimeframe | null {
  if (entryTimeframe === "M15") return "H4";
  if (entryTimeframe === "H4") return "D1";
  return null;
}

export function computeHtfContextFromCandles(
  timeframe: ChartTimeframe,
  candles: Candle[],
): HtfContext | null {
  if (candles.length === 0) return null;
  const swings = findSwingPoints(candles, { left: 2, right: 2 });
  const bias = detectTimeframeBias(candles);
  return { timeframe, bias, swings, candlesLength: candles.length };
}

const TIMEFRAME_INTERVAL_MS: Record<ChartTimeframe, number> = {
  M15: 15 * 60 * 1000,
  M30: 30 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
};

/**
 * Với mỗi candle trong `entryCandles`, tính HtfContext chỉ từ các nến HTF
 * đã đóng hoàn toàn tính đến thời điểm candle đó — tránh look-ahead bias.
 * Yêu cầu cả 2 mảng đã sắp xếp theo `time` tăng dần (đúng theo cách
 * `fetchOhlcHistory` trả về).
 */
export function buildRollingHtfContexts(
  htfTimeframe: ChartTimeframe,
  htfCandles: Candle[],
  entryCandles: Candle[],
): (HtfContext | null)[] {
  const intervalMs = TIMEFRAME_INTERVAL_MS[htfTimeframe];
  const results: (HtfContext | null)[] = new Array(entryCandles.length).fill(null);

  let htfBoundary = 0;
  let cachedContext: HtfContext | null = null;
  let cachedBoundary = -1;

  for (let i = 0; i < entryCandles.length; i += 1) {
    const entryTime = entryCandles[i].time;
    while (
      htfBoundary < htfCandles.length &&
      htfCandles[htfBoundary].time + intervalMs <= entryTime
    ) {
      htfBoundary += 1;
    }

    if (htfBoundary !== cachedBoundary) {
      const closedSlice = htfCandles.slice(0, htfBoundary);
      cachedContext = computeHtfContextFromCandles(htfTimeframe, closedSlice);
      cachedBoundary = htfBoundary;
    }

    results[i] = cachedContext;
  }

  return results;
}

export async function buildHtfContext(
  symbol: string,
  entryTimeframe: ChartTimeframe,
  bars = 200,
): Promise<HtfContext | null> {
  const htfTimeframe = getHtfTimeframeFor(entryTimeframe);
  if (!htfTimeframe) return null;

  const candles = await fetchOhlcHistory(symbol, htfTimeframe, bars);
  if (candles instanceof Error) return null;

  return computeHtfContextFromCandles(htfTimeframe, candles);
}
