import type { Candle } from "../client/ohlc-provider.js";
import { getConfiguredTpRMultiple } from "../model/volman-config-env.js";

/**
 * Base confidence (0-100) cho mọi setup.
 */
export const baseConfidence = 50;

export function computeTakeProfit(
  direction: "LONG" | "SHORT",
  entry: number,
  stopLoss: number,
): number {
  const risk = Math.abs(entry - stopLoss);
  const r = getConfiguredTpRMultiple();
  return direction === "LONG" ? entry + r * risk : entry - r * risk;
}

/**
 * Tính độ dốc EMA21 chuẩn hóa theo ATR: (EMA[i] - EMA[i-5]) / ATR14[i]
 */
export function computeSlope(
  ma21: (number | null)[],
  atr14: (number | null)[],
  index: number,
): number | null {
  if (index < 5) return null;
  const ema = ma21[index];
  const emaPrev = ma21[index - 5];
  const atr = atr14[index];
  if (ema === null || emaPrev === null || atr === null || atr === 0) return null;
  return (ema - emaPrev) / atr;
}

/**
 * Tính bodyRatio = |Close - Open| / (High - Low) của nến.
 * Trả 0 nếu range = 0 (tránh chia 0).
 */
export function computeBodyRatio(
  open: number, high: number, low: number, close: number,
): number {
  const range = high - low;
  if (range === 0) return 0;
  return Math.abs(close - open) / range;
}

/**
 * Áp dụng bonus/penalty confidence chuẩn (context.md §3).
 * - +15 nếu |slope| > 0.3 (trend rõ)
 * - -15 nếu bodyRatio < 0.3 (breakout yếu)
 * - -10 nếu volume breakout thấp
 */
export function applyStandardConfidenceAdjustments(
  confidence: number,
  slope: number | null,
  bodyRatio: number,
  ruleTrace: string[],
): number {
  if (slope !== null && Math.abs(slope) > 0.3) {
    confidence += 15;
    ruleTrace.push("Bonus confidence: trend ro (|slope|>0.3)");
  }
  if (bodyRatio < 0.3) {
    confidence -= 15;
    ruleTrace.push(`Penalty: nen pha vo yeu (bodyRatio=${bodyRatio.toFixed(2)} < 0.3)`);
  }
  return Math.max(0, Math.min(100, confidence));
}

/**
 * Áp dụng bonus confidence cho tight compression.
 * Tight compression = phá vỡ đáng tin cậy hơn.
 */
export function applyCompressionTightnessBonus(
  confidence: number,
  tightness: "TIGHT" | "LOOSE",
  ruleTrace: string[],
): number {
  if (tightness === "TIGHT") {
    confidence += 5;
    ruleTrace.push("Bonus confidence: nen chặt, phá vỡ đáng tin cậy (+5)");
  }
  return Math.max(0, Math.min(100, confidence));
}

/**
 * Phạt confidence nếu tìm thấy vùng giá đã bị "dằn co" (test ≥2 lần) gần mức entry,
 * trong lịch sử NGAY TRƯỚC vùng nén của setup — vùng này đóng vai trò kháng cự/hỗ trợ
 * cũ, cản trở đà đi của giá sau khi vào lệnh (tài liệu Bob Volman — Bốn Cách Tăng
 * Winrate, "Lỗi 4"). Chỉ nhìn "gần" (30 nến ngay trước), không lục lọi quá xa.
 */
export function applyPriorConsolidationPenalty(
  candles: Candle[],
  entry: number,
  atr: number,
  lookbackEndIndex: number,
  confidence: number,
  ruleTrace: string[],
): number {
  if (lookbackEndIndex < 2 || atr <= 0) return confidence;

  const LOOKBACK_CANDLES = 30;
  const TOLERANCE_ATR = 0.3;
  const startIndex = Math.max(0, lookbackEndIndex - LOOKBACK_CANDLES);
  const tolerance = TOLERANCE_ATR * atr;

  let touchCount = 0;
  for (let i = startIndex; i <= lookbackEndIndex; i++) {
    const c = candles[i];
    if (!c) continue;
    if (Math.abs(c.high - entry) <= tolerance || Math.abs(c.low - entry) <= tolerance) {
      touchCount++;
    }
  }

  if (touchCount >= 2) {
    ruleTrace.push(
      `Penalty: vung dan co gan entry (${touchCount} lan cham trong ${lookbackEndIndex - startIndex + 1} nen truoc do) -> can tro da gia (-10)`,
    );
    return Math.max(0, Math.min(100, confidence - 10));
  }

  return confidence;
}

/**
 * Kiểm tra xem 1 đoạn candles có phải "pullback hài hòa" không.
 * Định nghĩa: sóng kéo ngược nằm CHÉO (không nằm ngang), gồm các nến thân nhỏ đều,
 * di chuyển đơn lẻ (không có 2 lần đảo chiều).
 *
 * Tiêu chí:
 * (a) Body ratio đều: max(bodyRatio) - min(bodyRatio) ≤ 0.4
 * (b) Di chuyển đơn điệu (hoặc gần đơn điệu): tối đa 1 nến đi ngược hướng pullback
 * (c) Không nằm ngang: range > 0.3 * ATR
 */
export function isHarmonicPullback(
  candles: Array<{ open: number; high: number; low: number; close: number }>,
  startIndex: number,
  endIndex: number,
  atr: number,
): boolean {
  if (startIndex < 0 || endIndex >= candles.length || startIndex >= endIndex) {
    return false;
  }

  const windowCandles = candles.slice(startIndex, endIndex + 1);

  // (a) Body ratio uniformity
  const bodyRatios = windowCandles.map((c) => computeBodyRatio(c.open, c.high, c.low, c.close));
  const minBodyRatio = Math.min(...bodyRatios);
  const maxBodyRatio = Math.max(...bodyRatios);
  if (maxBodyRatio - minBodyRatio > 0.4) {
    return false;
  }

  // (b) Single wave: determine pullback direction from first to last close
  const firstClose = windowCandles[0].close;
  const lastClose = windowCandles[windowCandles.length - 1].close;
  const pullbackDown = lastClose < firstClose;
  const pullbackUp = lastClose > firstClose;

  if (!pullbackDown && !pullbackUp) {
    // No net pullback — flat or same close
    return false;
  }

  // Count candles going against pullback direction (allow max 1)
  let counterMovementCount = 0;
  for (let i = 1; i < windowCandles.length; i++) {
    const prevClose = windowCandles[i - 1].close;
    const currClose = windowCandles[i].close;
    if (pullbackDown && currClose > prevClose) counterMovementCount++;
    if (pullbackUp && currClose < prevClose) counterMovementCount++;
  }
  if (counterMovementCount > 1) {
    return false;
  }

  // (c) Not completely horizontal
  const high = Math.max(...windowCandles.map((c) => c.high));
  const low = Math.min(...windowCandles.map((c) => c.low));
  const range = high - low;
  if (range <= 0.3 * atr) {
    return false;
  }

  return true;
}
