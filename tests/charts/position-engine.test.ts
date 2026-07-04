import { describe, expect, test, it, beforeEach, vi } from "vitest";
import {
  buildOpenPositionInsertRow,
  deriveManagementPatch,
  validateTradeSetupForOpen,
  calculateRiskRewardPlan,
  getConfiguredMinRiskRewardRatio,
  getConfiguredTp1ClosePercent,
} from "../../src/charts/position-engine.js";
import type { PositionDecisionOutcome } from "../../src/charts/position-engine.js";

describe("charts/position-engine", () => {
  test("rejects open setups below the minimum risk-reward threshold", () => {
    const result = validateTradeSetupForOpen({
      direction: "LONG",
      entry: "1.1000",
      stopLoss: "1.0985",
      takeProfit1: "1.1010",
      takeProfit2: "1.1020",
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("R:R");
  });

  test("rejects SELL order types for LONG setups and BUY order types for SHORT setups", () => {
    expect(
      validateTradeSetupForOpen({
        direction: "LONG",
        orderType: "SELL_STOP",
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
      }).accepted,
    ).toBe(false);

    expect(
      validateTradeSetupForOpen({
        direction: "SHORT",
        orderType: "BUY_LIMIT",
        entry: "1.1000",
        stopLoss: "1.1020",
        takeProfit1: "1.0960",
        takeProfit2: "1.0920",
      }).accepted,
    ).toBe(false);
  });

  test("builds open-position payload with partial TP config and risk-reward", () => {
    const row = buildOpenPositionInsertRow({
      pair: "EUR/USD",
      direction: "LONG",
      setup: "Breakout",
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1080",
      takeProfit2: "1.1120",
      reasons: ["EMA touch"],
    });

    expect(row).toMatchObject({
      pair: "EUR/USD",
      trade_stage: "open",
      tp1_close_percent: 50,
      tp1_closed_percent: 0,
      last_management_action: "NONE",
      min_risk_reward_ratio: 1.5,
    });
    expect(Number(row?.risk_reward_ratio)).toBeCloseTo(2.5, 2);
  });

  test("creates a TP1 partial close patch and moves SL to breakeven", () => {
    const outcome = deriveManagementPatch(
      "1.0960",
      "1.1000",
      {
        decision: "HOLD",
        confidence: 88,
        comment: "TP1 reached",
        managementAction: "PARTIAL_TP1",
        partialClosePercent: 50,
        newStopLoss: null,
        tp1Reached: true,
        tp2Reached: false,
        riskReward: 2.5,
        tp1RiskReward: 2,
        tp2RiskReward: 3,
      },
    );

    expect(outcome.closePosition).toBe(false);
    expect(outcome.patch).toMatchObject({
      tradeStage: "tp1_partial",
      tp1ClosedPercent: 50,
      lastManagementAction: "PARTIAL_TP1",
      stopLoss: "1.1000",
    });
  });

  test("creates a TP2 close patch that closes the position", () => {
    const outcome = deriveManagementPatch(
      "1.0960",
      "1.1000",
      {
        decision: "CLOSE",
        confidence: 91,
        comment: "TP2 reached",
        managementAction: "TP2_CLOSE",
        partialClosePercent: 100,
        newStopLoss: "1.1060",
        tp1Reached: false,
        tp2Reached: true,
        riskReward: 3,
        tp1RiskReward: 2,
        tp2RiskReward: 3,
      },
      {
        existingTp1ClosedPercent: 50,
      },
    );

    expect(outcome.closePosition).toBe(true);
    expect(outcome.patch).toMatchObject({
      tradeStage: "closed",
      tp1ClosedPercent: 50,
      lastManagementAction: "TP2_CLOSE",
      stopLoss: "1.1060",
    });
  });

  test("creates a manual close patch for CLOSE decisions that are not TP2", () => {
    const outcome = deriveManagementPatch(
      "1.0960",
      "1.1000",
      {
        decision: "CLOSE",
        confidence: 75,
        comment: "Setup invalidated",
        managementAction: "NONE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: false,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: 2,
        tp2RiskReward: 3,
      },
      {
        existingTp1ClosedPercent: 50,
      },
    );

    expect(outcome.closePosition).toBe(true);
    expect(outcome.patch).toMatchObject({
      tradeStage: "closed",
      lastManagementAction: "NONE",
    });
  });

  describe("calculateRiskRewardPlan - detailed", () => {
    it("should calculate risk/reward for LONG position", () => {
      const setup = {
        direction: "LONG" as const,
        entry: "100",
        stopLoss: "95",
        takeProfit1: "110",
        takeProfit2: "120",
      };

      const plan = calculateRiskRewardPlan(setup);

      expect(plan).toBeDefined();
      expect(plan?.entry).toBe(100);
      expect(plan?.stopLoss).toBe(95);
      expect(plan?.risk).toBe(5);
      expect(plan?.tp1Reward).toBe(10);
      expect(plan?.tp2Reward).toBe(20);
      expect(plan?.tp1RiskReward).toBe(2);
      expect(plan?.tp2RiskReward).toBe(4);
    });

    it("should calculate risk/reward for SHORT position", () => {
      const setup = {
        direction: "SHORT" as const,
        entry: "100",
        stopLoss: "105",
        takeProfit1: "90",
        takeProfit2: "80",
      };

      const plan = calculateRiskRewardPlan(setup);

      expect(plan).toBeDefined();
      expect(plan?.risk).toBe(5);
      expect(plan?.tp1Reward).toBe(10);
      expect(plan?.tp2Reward).toBe(20);
    });

    it("should handle takeProfit2 as null", () => {
      const setup = {
        direction: "LONG" as const,
        entry: "100",
        stopLoss: "95",
        takeProfit1: "110",
        takeProfit2: null,
      };

      const plan = calculateRiskRewardPlan(setup);

      expect(plan).toBeDefined();
      expect(plan?.takeProfit2).toBeNull();
      expect(plan?.tp2Reward).toBeNull();
      expect(plan?.tp2RiskReward).toBeNull();
    });

    it("should handle prices with commas", () => {
      const setup = {
        direction: "LONG" as const,
        entry: "1,234.5",
        stopLoss: "1,200",
        takeProfit1: "1,300",
        takeProfit2: "1,400",
      };

      const plan = calculateRiskRewardPlan(setup);

      expect(plan).toBeDefined();
      expect(plan?.entry).toBe(1234.5);
      expect(plan?.stopLoss).toBe(1200);
      expect(plan?.risk).toBe(34.5);
    });

    it("should return null when risk <= 0", () => {
      const setup = {
        direction: "LONG" as const,
        entry: "100",
        stopLoss: "105",
        takeProfit1: "110",
        takeProfit2: null,
      };

      const plan = calculateRiskRewardPlan(setup);

      expect(plan).toBeNull();
    });

    it("should return null when tp1Reward <= 0", () => {
      const setup = {
        direction: "LONG" as const,
        entry: "100",
        stopLoss: "95",
        takeProfit1: "100",
        takeProfit2: null,
      };

      const plan = calculateRiskRewardPlan(setup);

      expect(plan).toBeNull();
    });
  });

  describe("getConfiguredMinRiskRewardRatio", () => {
    beforeEach(() => {
      delete process.env.POSITION_MIN_RISK_REWARD_RATIO;
    });

    it("should return default 1.5 when env not set", () => {
      const ratio = getConfiguredMinRiskRewardRatio();
      expect(ratio).toBe(1.5);
    });

    it("should parse configured ratio from env", () => {
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO", "2.5");
      const ratio = getConfiguredMinRiskRewardRatio();
      expect(ratio).toBe(2.5);
    });

    it("should return default when env value is invalid", () => {
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO", "invalid");
      const ratio = getConfiguredMinRiskRewardRatio();
      expect(ratio).toBe(1.5);
    });
  });

  describe("getConfiguredTp1ClosePercent", () => {
    beforeEach(() => {
      delete process.env.POSITION_TP1_CLOSE_PERCENT;
    });

    it("should return default 50 when env not set", () => {
      const percent = getConfiguredTp1ClosePercent();
      expect(percent).toBe(50);
    });

    it("should parse configured percent from env", () => {
      vi.stubEnv("POSITION_TP1_CLOSE_PERCENT", "75");
      const percent = getConfiguredTp1ClosePercent();
      expect(percent).toBe(75);
    });

    it("should clamp percent to valid range [1, 99]", () => {
      vi.stubEnv("POSITION_TP1_CLOSE_PERCENT", "150");
      const percent = getConfiguredTp1ClosePercent();
      expect(percent).toBe(99);
    });

    it("should clamp negative percent to minimum 1", () => {
      vi.stubEnv("POSITION_TP1_CLOSE_PERCENT", "-10");
      const percent = getConfiguredTp1ClosePercent();
      expect(percent).toBe(1);
    });
  });
});
