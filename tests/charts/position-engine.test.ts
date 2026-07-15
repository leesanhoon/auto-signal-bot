import { describe, expect, test } from "vitest";
import {
  buildOpenPositionInsertRow,
  calculateRiskRewardPlan,
  deriveManagementPatch,
  validateTradeSetupForOpen,
} from "../../src/charts/service/position-engine-volman.js";

const setup = {
  pair: "EUR/USD",
  direction: "LONG" as const,
  setup: "RB",
  entry: "1.1000",
  stopLoss: "1.0960",
  takeProfit1: "1.1080",
  reasons: ["EMA touch"],
  detectionSource: "deterministic" as const,
  primaryTimeframe: "H1" as const,
};

describe("charts/position-engine", () => {
  test("calculates risk-reward from the single take profit", () => {
    const plan = calculateRiskRewardPlan(setup, { minRiskReward: 1.5 });

    expect(plan).toMatchObject({
      entry: 1.1,
      stopLoss: 1.096,
      takeProfit1: 1.108,
      riskReward: 2,
      expectedRiskReward: 2,
      minRiskReward: 1.5,
    });
    expect(plan?.risk).toBeCloseTo(0.004);
    expect(plan?.reward).toBeCloseTo(0.008);
    expect(plan).not.toHaveProperty("takeProfit2");
    expect(plan).not.toHaveProperty("partialClosePercent");
  });

  test("builds an open row without partial or trailing management fields", () => {
    const row = buildOpenPositionInsertRow(setup, { minRiskReward: 1.5 });

    expect(row).toMatchObject({
      pair: "EUR/USD",
      trade_stage: "open",
      take_profit_1: "1.1080",
      take_profit_2: null,
      risk_reward_ratio: 2,
      last_management_action: "NONE",
    });
    expect(row).not.toHaveProperty("tp1_close_percent");
    expect(row).not.toHaveProperty("tp1_closed_percent");
    expect(row).not.toHaveProperty("trailing_stop_loss");
  });

  test("rejects a setup below the configured minimum R:R", () => {
    const validation = validateTradeSetupForOpen(setup, { minRiskReward: 3 });
    expect(validation.accepted).toBe(false);
    expect(validation.reason).toContain("thap hon");
  });

  test("closes the position when the only TP is reached", () => {
    const outcome = deriveManagementPatch({
      decision: "CLOSE",
      confidence: 99,
      comment: "TP reached",
      managementAction: "TAKE_PROFIT_CLOSE",
    });

    expect(outcome.closePosition).toBe(true);
    expect(outcome.patch).toMatchObject({
      tradeStage: "closed",
      lastManagementAction: "TAKE_PROFIT_CLOSE",
      lastManagementComment: "TP reached",
    });
  });

  test("keeps HOLD decisions free of management writes", () => {
    expect(
      deriveManagementPatch({
        decision: "HOLD",
        confidence: 50,
        comment: "hold",
        managementAction: "NONE",
      }),
    ).toEqual({ patch: null, closePosition: false });
  });

  test("derives a non-closing patch for a breakeven notify decision", () => {
    const decision = {
      decision: "HOLD" as const,
      confidence: 90,
      comment: "Đã đạt 1R — dời SL về entry 1.1000.",
      managementAction: "BREAKEVEN_NOTIFY" as const,
    };

    const { patch, closePosition } = deriveManagementPatch(decision);

    expect(closePosition).toBe(false);
    expect(patch).toMatchObject({
      lastManagementAction: "BREAKEVEN_NOTIFY",
      lastManagementComment: decision.comment,
    });
    expect(patch?.tradeStage).toBeUndefined();
  });

  test("a plain HOLD with managementAction NONE still produces no patch", () => {
    const { patch, closePosition } = deriveManagementPatch({
      decision: "HOLD",
      confidence: 50,
      comment: "no change",
      managementAction: "NONE",
    });

    expect(patch).toBeNull();
    expect(closePosition).toBe(false);
  });

});
