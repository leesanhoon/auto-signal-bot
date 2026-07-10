import { describe, expect, test, it, beforeEach, vi } from "vitest";
import {
  buildOpenPositionInsertRow,
  deriveManagementPatch,
  validateTradeSetupForOpen,
  calculateRiskRewardPlan,
  getConfiguredMinRiskRewardRatio,
  getConfiguredMinRiskRewardRatioForPattern,
  getConfiguredTp1ClosePercent,
} from "../../src/charts/position-engine-volman.js";
import type { PositionDecisionOutcome } from "../../src/charts/position-engine-volman.js";

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
      takeProfit1: "1.1120",
      takeProfit2: "1.1160",
      reasons: ["EMA touch"],
    });

    expect(row).toMatchObject({
      pair: "EUR/USD",
      trade_stage: "open",
      tp1_close_percent: 50,
      tp1_closed_percent: 0,
      last_management_action: "NONE",
      min_risk_reward_ratio: 3,
    });
    expect(Number(row?.risk_reward_ratio)).toBeCloseTo(3.5, 2);
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

    it("should return default 3 when env not set", () => {
      const ratio = getConfiguredMinRiskRewardRatio();
      expect(ratio).toBe(3);
    });

    it("should parse configured ratio from env", () => {
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO", "2.5");
      const ratio = getConfiguredMinRiskRewardRatio();
      expect(ratio).toBe(2.5);
    });

    it("should return default when env value is invalid", () => {
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO", "invalid");
      const ratio = getConfiguredMinRiskRewardRatio();
      expect(ratio).toBe(3);
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

  describe("getConfiguredMinRiskRewardRatioForPattern", () => {
    beforeEach(() => {
      delete process.env.POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN;
      delete process.env.POSITION_MIN_RISK_REWARD_RATIO;
    });

    it("should return pattern-specific ratio when set", () => {
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN", "ARB:2.0,RB:1.2,SB:2.0");
      expect(getConfiguredMinRiskRewardRatioForPattern("ARB")).toBe(2.0);
      expect(getConfiguredMinRiskRewardRatioForPattern("RB")).toBe(1.2);
      expect(getConfiguredMinRiskRewardRatioForPattern("SB")).toBe(2.0);
    });

    it("should fallback to global ratio for unmapped pattern", () => {
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN", "ARB:2.0,RB:1.2");
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO", "1.8");
      expect(getConfiguredMinRiskRewardRatioForPattern("BB")).toBe(1.8);
    });

    it("should ignore invalid pattern values", () => {
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN", "ARB:2.0,INVALID:abc,RB:1.2");
      expect(getConfiguredMinRiskRewardRatioForPattern("ARB")).toBe(2.0);
      expect(getConfiguredMinRiskRewardRatioForPattern("RB")).toBe(1.2);
      expect(getConfiguredMinRiskRewardRatioForPattern("INVALID")).toBe(3); // falls back to default global
    });

    it("should handle case-insensitive pattern matching", () => {
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN", "arb:2.0,Rb:1.2");
      expect(getConfiguredMinRiskRewardRatioForPattern("ARB")).toBe(2.0);
      expect(getConfiguredMinRiskRewardRatioForPattern("rb")).toBe(1.2);
      expect(getConfiguredMinRiskRewardRatioForPattern("RB")).toBe(1.2);
    });

    it("should return global default for null/undefined pattern", () => {
      vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN", "ARB:2.0");
      expect(getConfiguredMinRiskRewardRatioForPattern(null)).toBe(3);
      expect(getConfiguredMinRiskRewardRatioForPattern(undefined)).toBe(3);
    });
  });

  test("validateTradeSetupForOpen uses pattern-specific threshold", () => {
    vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN", "ARB:2.5");
    vi.stubEnv("POSITION_MIN_RISK_REWARD_RATIO", "1.5");

    // ARB with expected R:R 1.8 should fail (below 2.5 threshold)
    // entry: 1.1000, stopLoss: 1.0900, TP1: 1.1080, TP2: 1.1100
    // Risk: 0.01, TP1Reward: 0.008 (R:R 0.8), TP2Reward: 0.01 (R:R 1.0)
    // expectedRR = 50% * 0.8 + 50% * 1.0 = 0.9
    const arbSetup = {
      direction: "LONG" as const,
      setup: "ARB",
      entry: "1.1000",
      stopLoss: "1.0900",
      takeProfit1: "1.1080",
      takeProfit2: "1.1100",
    };
    const arbResult = validateTradeSetupForOpen(arbSetup);
    expect(arbResult.accepted).toBe(false);
    expect(arbResult.reason).toContain("R:R");

    // RB with expected R:R 1.8 should pass (uses global 1.5 threshold)
    // entry: 1.1000, stopLoss: 1.0900, TP1: 1.1180, TP2: 1.1260
    // Risk: 0.01, TP1Reward: 0.018 (R:R 1.8), TP2Reward: 0.026 (R:R 2.6)
    // expectedRR = 50% * 1.8 + 50% * 2.6 = 2.2
    const rbSetup = {
      direction: "LONG" as const,
      setup: "RB",
      entry: "1.1000",
      stopLoss: "1.0900",
      takeProfit1: "1.1180",
      takeProfit2: "1.1260",
    };
    const rbResult = validateTradeSetupForOpen(rbSetup);
    expect(rbResult.accepted).toBe(true);
    expect(rbResult.plan).not.toBeNull();
  });

});
