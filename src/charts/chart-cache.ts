import type { ChartTimeframe } from "./chart-types.js";

const TIMEFRAME_INTERVAL_MS: Record<ChartTimeframe, number> = {
  M15: 15 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
};

function getTimeframeIntervalMs(timeframe: ChartTimeframe): number {
  return TIMEFRAME_INTERVAL_MS[timeframe];
}

function getLastClosedBoundaryMs(timeframe: ChartTimeframe, nowMs: number): number {
  const intervalMs = getTimeframeIntervalMs(timeframe);
  return Math.floor(nowMs / intervalMs) * intervalMs;
}

function formatBoundaryKey(timeframe: ChartTimeframe, boundaryMs: number): string {
  const boundary = new Date(boundaryMs);
  const y = boundary.getUTCFullYear();
  const m = String(boundary.getUTCMonth() + 1).padStart(2, "0");
  const d = String(boundary.getUTCDate()).padStart(2, "0");
  const hh = String(boundary.getUTCHours()).padStart(2, "0");

  if (timeframe === "M15") {
    const mm = String(boundary.getUTCMinutes()).padStart(2, "0");
    return `${y}-${m}-${d}T${hh}:${mm}`;
  }

  return `${y}-${m}-${d}T${hh}`;
}

export function getLastClosedCandleKey(timeframe: ChartTimeframe, now: Date = new Date()): string {
  return formatBoundaryKey(timeframe, getLastClosedBoundaryMs(timeframe, now.getTime()));
}

/**
 * Helper tính key cho "last closed H4 candle" dạng YYYY-MM-DDTHH.
 * Mốc này là candle H4 đã đóng gần nhất, không phải candle đang chạy trên chart.
 * Khớp lịch cron trong .github/workflows/analyze.yml: 5 0,4,8,12,16,20 * * 1-5 (UTC).
 */
export function getLastClosedH4CandleKey(now: Date = new Date()): string {
  return getLastClosedCandleKey("H4", now);
}

/**
 * Backward-compatible alias kept for existing callers.
 * Semantics: returns the last closed H4 candle key, not the live candle key.
 */
export function getCurrentH4CandleCloseKey(now: Date = new Date()): string {
  return getLastClosedH4CandleKey(now);
}

/**
 * Kiểm tra xem thời điểm hiện tại có nằm trong cửa sổ windowMs sau khi nến của timeframe đã đóng cửa hay không.
 * Dùng để quyết định có nên chạy capture+AI (chỉ chạy trong cửa sổ ngắn sau nến đóng).
 */
export function isWithinTimeframeCandleCloseWindow(timeframe: ChartTimeframe, now: Date, windowMs: number): boolean {
  const candleCloseTime = new Date(getLastClosedBoundaryMs(timeframe, now.getTime()));
  const diff = now.getTime() - candleCloseTime.getTime();
  return diff >= 0 && diff < windowMs;
}

/**
 * Backward-compatible H4-only wrapper.
 */
export function isWithinCandleCloseWindow(now: Date, windowMs: number): boolean {
  return isWithinTimeframeCandleCloseWindow("H4", now, windowMs);
}
