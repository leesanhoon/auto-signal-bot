import type { Candle } from "./ohlc-provider.js";
import { calculateEma } from "./indicators.js";
import type { PositionDecisionOutcome } from "./position-engine-volman.js";

function formatPrice(value: number): string {
  const precision = value >= 1000 ? 2 : value >= 100 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(precision);
}

/**
 * Tra ve gia tri EMA moi nhat (phan tu cuoi khong null) tu mang nen da cho,
 * hoac null neu chua du du lieu de tinh EMA(period).
 */
export function calculateLatestEma(candles: Candle[], period: number): number | null {
  const emaSeries = calculateEma(candles, period);
  for (let i = emaSeries.length - 1; i >= 0; i--) {
    if (emaSeries[i] !== null) return emaSeries[i];
  }
  return null;
}

/**
 * So sanh gia dong nen gan nhat (lastClose) voi EMA theo huong lenh.
 * LONG: dong cua duoi EMA -> STOP (dong lenh).
 * SHORT: dong cua tren EMA -> STOP (dong lenh).
 * Chi trigger khi that su vuot qua (khong trigger khi bang EMA).
 * Tra ve null neu khong du du lieu hoac chua trigger (giu lenh, khong can quyet dinh moi).
 */
export function resolveEmaExitDecision(
  direction: "LONG" | "SHORT",
  lastClose: number | null,
  emaValue: number | null,
  period: number,
): PositionDecisionOutcome | null {
  if (lastClose === null || emaValue === null) return null;

  const triggered =
    direction === "LONG" ? lastClose < emaValue : lastClose > emaValue;
  if (!triggered) return null;

  const comment =
    direction === "LONG"
      ? `Giá đóng cửa ${formatPrice(lastClose)} đã xuống dưới EMA${period} (${formatPrice(emaValue)}), đóng lệnh theo trend.`
      : `Giá đóng cửa ${formatPrice(lastClose)} đã vượt lên trên EMA${period} (${formatPrice(emaValue)}), đóng lệnh theo trend.`;

  return {
    decision: "STOP",
    confidence: 95,
    comment,
    managementAction: "NONE",
  };
}
