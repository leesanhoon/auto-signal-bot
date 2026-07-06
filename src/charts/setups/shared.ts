/**
 * Base confidence (0-100) cho mọi setup.
 */
export const baseConfidence = 50;

/**
 * Tính độ dốc EMA20 chuẩn hóa theo ATR: (EMA[i] - EMA[i-5]) / ATR14[i]
 */
export function computeSlope(
  ema20: (number | null)[],
  atr14: (number | null)[],
  index: number,
): number | null {
  if (index < 5) return null;
  const ema = ema20[index];
  const emaPrev = ema20[index - 5];
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
