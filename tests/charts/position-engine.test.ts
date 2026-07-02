import { describe, expect, test } from "vitest";
import {
  buildOpenPositionInsertRow,
  deriveManagementPatch,
  validateTradeSetupForOpen,
} from "../../src/charts/position-engine.js";

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
});
