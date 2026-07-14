import type { TradeSetup } from "./chart-types-volman.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:position-engine");

export type PositionDecisionAction = "NONE" | "TAKE_PROFIT_CLOSE" | "BREAKEVEN_NOTIFY";

export type PositionDecisionOutcome = {
  decision: "HOLD" | "CLOSE" | "STOP";
  confidence: number;
  comment: string;
  managementAction: PositionDecisionAction;
};

export type RiskRewardPlan = {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  risk: number;
  reward: number;
  riskReward: number;
  expectedRiskReward: number;
  minRiskReward: number;
};

export type OpenPositionManagementPatch = {
  tradeStage?: "open" | "closed";
  lastManagementAction?: PositionDecisionAction | null;
  lastManagementComment?: string | null;
  lastManagementAt?: string | null;
};

export type OpenPositionValidation = {
  accepted: boolean;
  reason: string | null;
  plan: RiskRewardPlan | null;
};

function parsePrice(value: string | number): number {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function clampRiskReward(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 100) / 100);
}

function validateOrderTypeForDirection(
  setup: Pick<TradeSetup, "direction"> & { orderType?: TradeSetup["orderType"] },
): string | null {
  if (!setup.orderType) return null;
  if (setup.direction === "LONG" && setup.orderType.startsWith("SELL")) {
    return "Loai lenh SELL khong phu hop voi huong LONG.";
  }
  if (setup.direction === "SHORT" && setup.orderType.startsWith("BUY")) {
    return "Loai lenh BUY khong phu hop voi huong SHORT.";
  }
  return null;
}

export function getConfiguredMinRiskRewardRatio(): number {
  const raw = process.env.POSITION_MIN_RISK_REWARD_RATIO?.trim();
  if (!raw) return 3;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

export function getConfiguredMinRiskRewardRatioForPattern(
  pattern: string | null | undefined,
): number {
  const patternMap = new Map<string, number>();
  const raw = process.env.POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN?.trim();
  if (raw) {
    for (const pair of raw.split(",")) {
      const [patternText, valueText] = pair.split(":").map((value) => value.trim());
      if (patternText && valueText) {
        const value = Number(valueText);
        if (Number.isFinite(value) && value > 0) {
          patternMap.set(patternText.toUpperCase(), value);
        } else {
          logger.warn(
            `Invalid POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN entry: ${pair} (non-numeric or <= 0 value)`,
          );
        }
      } else {
        logger.warn(
          `Malformed POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN entry: ${pair} (missing ':' separator)`,
        );
      }
    }
  }

  const normalizedPattern = pattern?.trim().toUpperCase();
  if (normalizedPattern && patternMap.has(normalizedPattern)) {
    return patternMap.get(normalizedPattern)!;
  }
  return getConfiguredMinRiskRewardRatio();
}

export function calculateRiskRewardPlan(
  setup: Pick<TradeSetup, "direction" | "entry" | "stopLoss" | "takeProfit1" | "setup">,
  options: { minRiskReward?: number } = {},
): RiskRewardPlan | null {
  const entry = parsePrice(setup.entry);
  const stopLoss = parsePrice(setup.stopLoss);
  const takeProfit1 = parsePrice(setup.takeProfit1);
  if (![entry, stopLoss, takeProfit1].every(Number.isFinite)) return null;

  const risk = setup.direction === "LONG" ? entry - stopLoss : stopLoss - entry;
  const reward = setup.direction === "LONG" ? takeProfit1 - entry : entry - takeProfit1;
  if (risk <= 0 || reward <= 0) return null;

  const riskReward = clampRiskReward(reward / risk);
  return {
    entry,
    stopLoss,
    takeProfit1,
    risk,
    reward,
    riskReward,
    expectedRiskReward: riskReward,
    minRiskReward:
      options.minRiskReward ?? getConfiguredMinRiskRewardRatioForPattern(setup.setup),
  };
}

export function validateTradeSetupForOpen(
  setup: Pick<TradeSetup, "direction" | "entry" | "stopLoss" | "takeProfit1" | "setup"> & {
    orderType?: TradeSetup["orderType"];
  },
  options: { minRiskReward?: number } = {},
): OpenPositionValidation {
  const orderTypeError = validateOrderTypeForDirection(setup);
  if (orderTypeError) return { accepted: false, reason: orderTypeError, plan: null };

  const plan = calculateRiskRewardPlan(setup, options);
  if (!plan) {
    return {
      accepted: false,
      reason: "Khong the tinh duoc R:R hop le tu entry/stop/take-profit.",
      plan: null,
    };
  }
  if (plan.riskReward < plan.minRiskReward) {
    return {
      accepted: false,
      reason: `R:R ${plan.riskReward.toFixed(2)} thap hon nguong toi thieu ${plan.minRiskReward.toFixed(2)}.`,
      plan,
    };
  }
  return { accepted: true, reason: null, plan };
}

export function buildOpenPositionInsertRow(
  setup: Pick<
    TradeSetup,
    | "pair"
    | "direction"
    | "setup"
    | "entry"
    | "stopLoss"
    | "takeProfit1"
    | "reasons"
    | "detectionSource"
    | "primaryTimeframe"
  >,
  options: { minRiskReward?: number } = {},
): Record<string, unknown> | null {
  const validation = validateTradeSetupForOpen(setup, options);
  if (!validation.accepted || !validation.plan) return null;

  return {
    pair: setup.pair,
    direction: setup.direction,
    setup: setup.setup,
    entry: setup.entry,
    stop_loss: setup.stopLoss,
    take_profit_1: setup.takeProfit1,
    take_profit_2: null,
    reasons: setup.reasons,
    status: "open",
    trade_stage: "open",
    risk_reward_ratio: validation.plan.riskReward,
    min_risk_reward_ratio: validation.plan.minRiskReward,
    last_management_action: "NONE",
    last_management_comment: null,
    last_management_at: null,
    primary_timeframe: setup.primaryTimeframe ?? null,
  };
}

export function deriveManagementPatch(
  decision: PositionDecisionOutcome,
): { patch: OpenPositionManagementPatch | null; closePosition: boolean } {
  const now = new Date().toISOString();

  if (decision.managementAction === "BREAKEVEN_NOTIFY") {
    return {
      patch: {
        lastManagementAction: decision.managementAction,
        lastManagementComment: decision.comment,
        lastManagementAt: now,
      },
      closePosition: false,
    };
  }

  if (decision.decision === "HOLD") return { patch: null, closePosition: false };

  return {
    patch: {
      tradeStage: "closed",
      lastManagementAction: decision.managementAction,
      lastManagementComment: decision.comment,
      lastManagementAt: now,
    },
    closePosition: true,
  };
}
