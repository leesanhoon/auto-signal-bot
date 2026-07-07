import type { ChartTimeframe } from "./chart-types.js";

const TIMEFRAME_CLOSE_MINUTES: Record<ChartTimeframe, number> = {
  M15: 15,
  H4: 240,
  D1: 1440,
};

function getCandleCloseTime(now: Date, timeframe: ChartTimeframe): Date {
  const stepMinutes = TIMEFRAME_CLOSE_MINUTES[timeframe];
  const totalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const clampedMinutes = Math.floor(totalMinutes / stepMinutes) * stepMinutes;
  const clampedHour = Math.floor(clampedMinutes / 60);
  const clampedMinute = clampedMinutes % 60;

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      clampedHour,
      clampedMinute,
      0,
      0,
    ),
  );
}

/**
 * Trả về candle close key theo timeframe, dạng YYYY-MM-DDTHH:mm UTC.
 * Key này đại diện cho nến đã đóng gần nhất của timeframe trigger.
 */
export function getCurrentCandleCloseKey(
  timeframe: ChartTimeframe,
  now: Date = new Date(),
): string {
  const candleCloseTime = getCandleCloseTime(now, timeframe);
  const y = candleCloseTime.getUTCFullYear();
  const m = String(candleCloseTime.getUTCMonth() + 1).padStart(2, "0");
  const d = String(candleCloseTime.getUTCDate()).padStart(2, "0");
  const hh = String(candleCloseTime.getUTCHours()).padStart(2, "0");
  const mm = String(candleCloseTime.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

/**
 * Kiểm tra xem thời điểm hiện tại có nằm trong cửa sổ windowMs sau khi nến của timeframe đóng cửa hay không.
 */
export function isWithinCandleCloseWindow(
  now: Date,
  timeframe: ChartTimeframe,
  windowMs: number,
): boolean {
  const candleCloseTime = getCandleCloseTime(now, timeframe);
  const diff = now.getTime() - candleCloseTime.getTime();
  return diff >= 0 && diff < windowMs;
}
