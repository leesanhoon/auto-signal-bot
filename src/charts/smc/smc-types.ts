/**
 * Smart Money Concepts (SMC) domain types.
 *
 * Tách biệt hoàn toàn với Bob Volman: KHÔNG import từ `../setups/*`,
 * `../setup-types.js`, `../setup-resolver.js`, `../setup-sb-runner.js`.
 *
 * Các types dưới đây thuần SMC, deterministic, không có side effect.
 */

import type { Candle } from "../ohlc-provider.js";

export type SmcDirection = "LONG" | "SHORT";

export type SmcSetupName =
  | "SMC_BOS_OB"
  | "SMC_CHOCH_OB"
  | "SMC_LIQUIDITY_SWEEP"
  | "SMC_FVG_CONTINUATION";

export type SmcGrade = "A" | "B" | "C" | "D";

export type SmcEntryZone = {
  low: number;
  high: number;
};

export type SmcLiquidityTarget = {
  label: string;
  price: number;
  target: "TP1" | "TP2" | "TP3";
  riskReward?: number;
};

/** Điểm swing trên đồ thị (chỉ dùng closed candles). */
export type SmcSwingPoint = {
  index: number;
  price: number;
  kind: "HIGH" | "LOW";
};

/**
 * Sự kiện break của market structure.
 * - BOS (Break of Structure): break cùng chiều bias hiện tại (continuation).
 * - CHOCH (Change of Character): break ngược bias hiện tại (reversal).
 */
export type SmcStructureEvent = {
  kind: "BOS" | "CHOCH";
  direction: SmcDirection;
  breakIndex: number;
  level: number;
  /** Bias trước khi break xảy ra (nếu có), dùng để phân biệt BOS vs CHOCH. */
  previousBias?: SmcDirection;
};

/**
 * Liquidity sweep: wick lấy thanh khoản phía trên/below swing rồi close quay lại.
 * - direction = SHORT: quét thanh khoản phía trên (sell-side liquidity bị lấy),
 *   gợi ý potential SHORT.
 * - direction = LONG: quét thanh khoản phía dưới (buy-side liquidity bị lấy),
 *   gợi ý potential LONG.
 */
export type SmcLiquiditySweep = {
  direction: SmcDirection;
  sweepIndex: number;
  sweptLevel: number;
  reclaimClose: number;
};

/**
 * Order block: candle đối hướng gần nhất trước impulse/BOS.
 * - LONG: last bearish candle trước bullish impulse.
 * - SHORT: last bullish candle trước bearish impulse.
 */
export type SmcOrderBlock = {
  direction: SmcDirection;
  startIndex: number;
  endIndex: number;
  high: number;
  low: number;
  midpoint: number;
};

/**
 * Fair Value Gap (imbalance 3-candle).
 * - Bullish FVG: high candle[i-2] < low candle[i] (khoảng trống phía trên).
 * - Bearish FVG: low candle[i-2] > high candle[i] (khoảng trống phía dưới).
 */
export type SmcFairValueGap = {
  direction: SmcDirection;
  index: number;
  high: number;
  low: number;
  midpoint: number;
};

export type SmcSignal = {
  setup: SmcSetupName;
  pair: string;
  timeframe: import("../chart-types-common.js").ChartTimeframe;
  direction: SmcDirection;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3?: number;
  entryZone?: SmcEntryZone;
  liquidityTargets?: SmcLiquidityTarget[];
  confidence: number;
  grade: SmcGrade;
  score: number;
  triggerIndex: number;
  structureEvent?: SmcStructureEvent;
  liquiditySweep?: SmcLiquiditySweep;
  orderBlock?: SmcOrderBlock;
  premiumDiscountZone?: import("./smc-liquidity-context.js").DealingRangeZone;
  priorPeriodLevels?: import("./smc-liquidity-context.js").PriorPeriodLevels;
  rvol?: number;
  hasRejectionWick?: boolean;
  confluence?: { agreementCount: number; agreeingTimeframes: string[] };
  fairValueGap?: SmcFairValueGap;
  ruleTrace: string[];
  market?: string;
  session?: string;
  sessionLabel?: string;
  capitalManagement?: string[];
  noSetupReason?: string;
};

/** Options cho swing detection. */
export type FindSwingPointsOptions = {
  /** Số candle trái (lookback). Default 2. */
  left?: number;
  /** Số candle phải (lookforward). Default 2. */
  right?: number;
};

/** Alias cho candle array cho SMC modules (không thêm field, chỉ rõ ràng). */
export type SmcCandle = Candle;
