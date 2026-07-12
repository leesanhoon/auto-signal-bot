import type { TradeSetup } from "./chart-types-volman.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:position-engine");

export type PositionDecisionAction =
  | "NONE"
  | "PARTIAL_TP1"
  | "MOVE_SL_TO_BE"
  | "TRAIL_SL"
  | "TP2_CLOSE";

export type PositionDecisionOutcome = {
  decision: "HOLD" | "CLOSE" | "STOP";
  confidence: number;
  comment: string;
  managementAction: PositionDecisionAction;
  partialClosePercent: number;
  newStopLoss: string | null;
  tp1Reached: boolean;
  tp2Reached: boolean;
  riskReward: number | null;
  tp1RiskReward: number | null;
  tp2RiskReward: number | null;
};

export type RiskRewardPlan = {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  risk: number;
  tp1Reward: number;
  tp2Reward: number | null;
  tp1RiskReward: number;
  tp2RiskReward: number | null;
  expectedRiskReward: number;
  partialClosePercent: number;
  minRiskReward: number;
};

export type OpenPositionManagementPatch = {
  tradeStage?: "open" | "tp1_partial" | "trailing" | "closed";
  tp1ClosedPercent?: number;
  tp1ClosedAt?: string | null;
  trailingStopLoss?: string | null;
  trailingStartedAt?: string | null;
  lastManagementAction?: PositionDecisionAction | null;
  lastManagementComment?: string | null;
  lastManagementAt?: string | null;
  stopLoss?: string;
};

export type DeriveManagementPatchOptions = {
  partialClosePercent?: number;
  existingTp1ClosedPercent?: number | null;
};

export type OpenPositionValidation = {
  accepted: boolean;
  reason: string | null;
  plan: RiskRewardPlan | null;
};

function parsePrice(value: string | number): number {
  const str = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(99, Math.round(value)));
}

function clampRiskReward(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 100) / 100);
}

function validateOrderTypeForDirection(
  setup: Pick<TradeSetup, "direction"> & {
    orderType?: TradeSetup["orderType"];
  },
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
    const pairs = raw.split(",");
    for (const pair of pairs) {
      const [pattStr, valueStr] = pair.split(":").map((s) => s.trim());
      if (pattStr && valueStr) {
        const value = Number(valueStr);
        if (Number.isFinite(value) && value > 0) {
          patternMap.set(pattStr.toUpperCase(), value);
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

  const normalizedPattern =
    pattern && typeof pattern === "string"
      ? pattern.trim().toUpperCase()
      : null;
  if (normalizedPattern && patternMap.has(normalizedPattern)) {
    return patternMap.get(normalizedPattern)!;
  }

  return getConfiguredMinRiskRewardRatio();
}

export function getConfiguredTp1ClosePercent(): number {
  const raw = process.env.POSITION_TP1_CLOSE_PERCENT?.trim();
  if (!raw) return 50;
  const parsed = Number(raw);
  return clampPercent(parsed);
}

export function calculateRiskRewardPlan(
  setup: Pick<
    TradeSetup,
    "direction" | "entry" | "stopLoss" | "takeProfit1" | "takeProfit2" | "setup"
  >,
  options: { partialClosePercent?: number; minRiskReward?: number } = {},
): RiskRewardPlan | null {
  const entry = parsePrice(setup.entry);
  const stopLoss = parsePrice(setup.stopLoss);
  const takeProfit1 = parsePrice(setup.takeProfit1);
  const takeProfit2 = setup.takeProfit2 ? parsePrice(setup.takeProfit2) : null;
  const partialClosePercent = clampPercent(
    options.partialClosePercent ?? getConfiguredTp1ClosePercent(),
  );
  const minRiskReward =
    options.minRiskReward ??
    getConfiguredMinRiskRewardRatioForPattern(setup.setup);

  const risk = setup.direction === "LONG" ? entry - stopLoss : stopLoss - entry;
  const tp1Reward =
    setup.direction === "LONG" ? takeProfit1 - entry : entry - takeProfit1;
  const tp2Reward =
    takeProfit2 === null
      ? null
      : setup.direction === "LONG"
        ? takeProfit2 - entry
        : entry - takeProfit2;

  if (
    ![entry, stopLoss, takeProfit1].every(Number.isFinite) ||
    (takeProfit2 !== null && !Number.isFinite(takeProfit2))
  ) {
    return null;
  }

  if (
    risk <= 0 ||
    tp1Reward <= 0 ||
    (takeProfit2 !== null && tp2Reward !== null && tp2Reward <= 0)
  ) {
    return null;
  }

  const tp1RiskReward = clampRiskReward(tp1Reward / risk);
  const tp2RiskReward =
    tp2Reward === null ? null : clampRiskReward(tp2Reward / risk);
  const expectedRiskReward = clampRiskReward(
    (partialClosePercent / 100) * tp1RiskReward +
      (1 - partialClosePercent / 100) * (tp2RiskReward ?? tp1RiskReward),
  );

  return {
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    risk,
    tp1Reward,
    tp2Reward,
    tp1RiskReward,
    tp2RiskReward,
    expectedRiskReward,
    partialClosePercent,
    minRiskReward,
  };
}

export function validateTradeSetupForOpen(
  setup: Pick<
    TradeSetup,
    "direction" | "entry" | "stopLoss" | "takeProfit1" | "takeProfit2" | "setup"
  > & {
    orderType?: TradeSetup["orderType"];
  },
  options: { partialClosePercent?: number; minRiskReward?: number } = {},
): OpenPositionValidation {
  const orderTypeError = validateOrderTypeForDirection(setup);
  if (orderTypeError) {
    return { accepted: false, reason: orderTypeError, plan: null };
  }

  const plan = calculateRiskRewardPlan(setup, options);
  if (!plan) {
    return {
      accepted: false,
      reason: "Khong the tinh duoc R:R hop le tu entry/stop/take-profit.",
      plan: null,
    };
  }

  if (plan.expectedRiskReward < plan.minRiskReward) {
    return {
      accepted: false,
      reason: `R:R ${plan.expectedRiskReward.toFixed(2)} thấp hơn ngưỡng tối thiểu ${plan.minRiskReward.toFixed(2)}.`,
      plan,
    };
  }

  return {
    accepted: true,
    reason: null,
    plan,
  };
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
    | "takeProfit2"
    | "reasons"
    | "detectionSource"
    | "primaryTimeframe"
  >,
  options: { partialClosePercent?: number; minRiskReward?: number } = {},
): Record<string, unknown> | null {
  const validation = validateTradeSetupForOpen(setup, options);
  if (!validation.accepted || !validation.plan) {
    return null;
  }

  return {
    pair: setup.pair,
    direction: setup.direction,
    setup: setup.setup,
    entry: setup.entry,
    stop_loss: setup.stopLoss,
    take_profit_1: setup.takeProfit1,
    take_profit_2: setup.takeProfit2,
    reasons: setup.reasons,
    status: "open",
    trade_stage: "open",
    tp1_close_percent: validation.plan.partialClosePercent,
    tp1_closed_percent: 0,
    tp1_closed_at: null,
    trailing_stop_loss: null,
    trailing_started_at: null,
    risk_reward_ratio: validation.plan.expectedRiskReward,
    tp1_risk_reward_ratio: validation.plan.tp1RiskReward,
    tp2_risk_reward_ratio: validation.plan.tp2RiskReward,
    min_risk_reward_ratio: validation.plan.minRiskReward,
    last_management_action: "NONE",
    last_management_comment: null,
    last_management_at: null,
    primary_timeframe: setup.primaryTimeframe ?? null,
  };
}

export function deriveManagementPatch(
  currentStopLoss: string,
  entry: string,
  decision: PositionDecisionOutcome,
  options: DeriveManagementPatchOptions = {},
): { patch: OpenPositionManagementPatch | null; closePosition: boolean } {
  const now = new Date().toISOString();
  const partialClosePercent = clampPercent(
    options.partialClosePercent ??
      decision.partialClosePercent ??
      getConfiguredTp1ClosePercent(),
  );
  const existingTp1ClosedPercent = Math.max(
    0,
    Math.min(100, Math.round(Number(options.existingTp1ClosedPercent ?? 0))),
  );
  const breakevenStopLoss = decision.newStopLoss?.trim() || entry;

  if (
    decision.managementAction === "TP2_CLOSE" ||
    decision.tp2Reached ||
    decision.decision === "STOP"
  ) {
    return {
      patch: {
        tradeStage: "closed",
        tp1ClosedPercent: existingTp1ClosedPercent,
        tp1ClosedAt: existingTp1ClosedPercent > 0 ? now : null,
        trailingStopLoss: decision.newStopLoss ?? currentStopLoss,
        trailingStartedAt: now,
        lastManagementAction:
          decision.managementAction === "NONE"
            ? "TP2_CLOSE"
            : decision.managementAction,
        lastManagementComment: decision.comment,
        lastManagementAt: now,
        stopLoss: decision.newStopLoss ?? currentStopLoss,
      },
      closePosition: true,
    };
  }

  if (decision.managementAction === "PARTIAL_TP1" || decision.tp1Reached) {
    return {
      patch: {
        tradeStage: "tp1_partial",
        tp1ClosedPercent: Math.max(
          existingTp1ClosedPercent,
          partialClosePercent,
        ),
        tp1ClosedAt: now,
        trailingStopLoss: breakevenStopLoss,
        trailingStartedAt: now,
        lastManagementAction: "PARTIAL_TP1",
        lastManagementComment: decision.comment,
        lastManagementAt: now,
        stopLoss: breakevenStopLoss,
      },
      closePosition: false,
    };
  }

  if (
    decision.managementAction === "MOVE_SL_TO_BE" ||
    decision.managementAction === "TRAIL_SL"
  ) {
    return {
      patch: {
        tradeStage: "trailing",
        trailingStopLoss: decision.newStopLoss ?? breakevenStopLoss,
        trailingStartedAt: now,
        lastManagementAction: decision.managementAction,
        lastManagementComment: decision.comment,
        lastManagementAt: now,
        stopLoss: decision.newStopLoss ?? breakevenStopLoss,
      },
      closePosition: false,
    };
  }

  if (decision.decision === "CLOSE") {
    return {
      patch: {
        tradeStage: "closed",
        lastManagementAction: "NONE",
        lastManagementComment: decision.comment,
        lastManagementAt: now,
      },
      closePosition: true,
    };
  }

  return {
    patch: null,
    closePosition: false,
  };
}
