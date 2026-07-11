/**
 * Factor-based scoring cho SMC setup.
 *
 * Thay cho base score cố định theo setup (BOS=80, CHOCH=72, FVG=74), điểm được
 * cộng dồn từ các yếu tố có tính dự báo, để grade (A/B/C/D) phản ánh chất lượng
 * setup thay vì chỉ là tên setup được mã hóa lại. Dùng thống nhất cho cả
 * backtest lẫn production (không phụ thuộc dữ liệu chỉ có ở production).
 *
 * Ngưỡng grade giữ nguyên tại `gradeFromScore` (A>=80, B>=50, C>=35).
 */

import type { SmcSetupName } from "./smc-types.js";

export type PremiumDiscountAssessment = "CORRECT" | "WRONG" | "UNKNOWN";

export type SetupScoreFactors = {
  setup: SmcSetupName;
  /** Setup có vào đúng phía dealing range không (LONG@DISCOUNT / SHORT@PREMIUM). */
  premiumDiscount: PremiumDiscountAssessment;
  /** Session của nến sinh tín hiệu (từ detectSession). */
  session: string;
  /** Relative volume tại nến tín hiệu; null nếu không tính được. */
  rvol: number | null;
  hasRejectionWick: boolean;
  /** HTF bias tồn tại và cùng hướng với setup. */
  htfBiasAligned: boolean;
};

const SETUP_POINTS: Record<SmcSetupName, number> = {
  SMC_BOS_OB: 15,
  SMC_CHOCH_OB: 8,
  SMC_LIQUIDITY_SWEEP: 10,
  SMC_FVG_CONTINUATION: 8,
};

function sessionPoints(session: string): number {
  if (session === "LONDON_NY_OVERLAP") return 10;
  if (session === "LONDON" || session === "NEWYORK") return 8;
  if (session === "ASIA") return 3;
  return 0;
}

function premiumDiscountPoints(assessment: PremiumDiscountAssessment): number {
  if (assessment === "CORRECT") return 15;
  if (assessment === "UNKNOWN") return 5;
  return -10;
}

function rvolPoints(rvol: number | null): number {
  if (rvol === null || !Number.isFinite(rvol)) return 0;
  if (rvol >= 1.5) return 10;
  if (rvol >= 1.0) return 5;
  return 0;
}

export function computeSetupScore(factors: SetupScoreFactors): number {
  let score = 40;
  score += SETUP_POINTS[factors.setup] ?? 0;
  score += premiumDiscountPoints(factors.premiumDiscount);
  score += sessionPoints(factors.session);
  score += rvolPoints(factors.rvol);
  if (factors.hasRejectionWick) score += 5;
  if (factors.htfBiasAligned) score += 10;
  return Math.max(0, Math.min(100, score));
}
