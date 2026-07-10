import { describe, expect, test } from "vitest";
import {
  buildClosedPositionSnapshot,
  summarizeClosedPositionsPerformance,
} from "../../src/charts/performance-tracking-volman.js";

describe("charts/performance-tracking-volman", () => {
  test("builds realized risk-reward for a partial TP then breakeven stop", () => {
    const snapshot = buildClosedPositionSnapshot(
      {
        id: 1,
        pair: "EUR/USD",
        direction: "LONG",
        setup: "RB",
        entry: "1.1000",
        stopLoss: "1.1000",
        takeProfit1: "1.1080",
        takeProfit2: "1.1120",
        status: "closed",
        closedAt: "2026-07-01T00:00:00.000Z",
        tp1ClosedPercent: 50,
        trailingStopLoss: "1.1000",
        riskRewardRatio: 2.5,
        tp1RiskRewardRatio: 2,
        tp2RiskRewardRatio: 3,
        lastManagementAction: "NONE",
      },
      "STOP",
      { stopLoss: "1.1000" },
    );

    expect(snapshot).toMatchObject({
      closeReason: "stop_loss",
      realizedExitPrice: "1.1000",
      realizedRiskRewardRatio: 1,
      outcome: "win",
    });
  });

  test("builds realized risk-reward for a manual close without TP2", () => {
    const snapshot = buildClosedPositionSnapshot(
      {
        id: 2,
        pair: "GBP/USD",
        direction: "SHORT",
        setup: "ARB",
        entry: "1.2500",
        stopLoss: "1.2540",
        takeProfit1: "1.2420",
        takeProfit2: "1.2380",
        status: "closed",
        closedAt: "2026-07-01T00:00:00.000Z",
        tp1ClosedPercent: 50,
        trailingStopLoss: "1.2500",
        riskRewardRatio: 3,
        tp1RiskRewardRatio: 2,
        tp2RiskRewardRatio: 3,
        lastManagementAction: "NONE",
      },
      "MANUAL_CLOSE",
      { stopLoss: "1.2500" },
    );

    expect(snapshot).toMatchObject({
      closeReason: "manual_close",
      realizedExitPrice: "1.2500",
      realizedRiskRewardRatio: 1,
      outcome: "win",
    });
  });

  test("summarizes portfolio and per-pair performance with drawdown", () => {
    const report = summarizeClosedPositionsPerformance(
      [
        {
          id: 1,
          pair: "EUR/USD",
          direction: "LONG",
          setup: "RB",
          entry: "1.1000",
          stopLoss: "1.1000",
          takeProfit1: "1.1080",
          takeProfit2: "1.1120",
          status: "closed",
          closedAt: "2026-07-01T00:00:00.000Z",
          tp1ClosedPercent: 50,
          trailingStopLoss: "1.1000",
          riskRewardRatio: 2.5,
          tp1RiskRewardRatio: 2,
          tp2RiskRewardRatio: 3,
          lastManagementAction: "NONE",
          closeReason: "stop_loss",
          realizedRiskRewardRatio: 1,
          realizedExitPrice: "1.1000",
        },
        {
          id: 2,
          pair: "GBP/USD",
          direction: "SHORT",
          setup: "ARB",
          entry: "1.2500",
          stopLoss: "1.2540",
          takeProfit1: "1.2420",
          takeProfit2: "1.2380",
          status: "closed",
          closedAt: "2026-07-02T00:00:00.000Z",
          tp1ClosedPercent: 0,
          trailingStopLoss: null,
          riskRewardRatio: 3,
          tp1RiskRewardRatio: 2,
          tp2RiskRewardRatio: 3,
          lastManagementAction: "TP2_CLOSE",
          closeReason: "take_profit_2",
          realizedRiskRewardRatio: 3,
          realizedExitPrice: "1.2380",
        },
        {
          id: 3,
          pair: "EUR/USD",
          direction: "LONG",
          setup: "RB",
          entry: "1.1000",
          stopLoss: "1.0960",
          takeProfit1: "1.1080",
          takeProfit2: "1.1120",
          status: "closed",
          closedAt: "2026-07-03T00:00:00.000Z",
          tp1ClosedPercent: 0,
          trailingStopLoss: null,
          riskRewardRatio: 2.5,
          tp1RiskRewardRatio: 2,
          tp2RiskRewardRatio: 3,
          lastManagementAction: "NONE",
          closeReason: "stop_loss",
          realizedRiskRewardRatio: -1,
          realizedExitPrice: "1.0960",
        },
      ],
      {
        periodLabel: "tuan",
        startAt: "01/07/2026",
        endAt: "07/07/2026",
      },
    );

    expect(report.portfolio).toMatchObject({
      trades: 3,
      wins: 2,
      losses: 1,
      breakevens: 0,
      winRate: 66.67,
      totalRealizedRiskReward: 3,
      averageRealizedRiskReward: 1,
      maxDrawdown: 1,
    });
    expect(report.byPair).toEqual([
      expect.objectContaining({
        label: "GBP/USD",
        trades: 1,
        totalRealizedRiskReward: 3,
      }),
      expect.objectContaining({
        label: "EUR/USD",
        trades: 2,
        totalRealizedRiskReward: 0,
      }),
    ]);
    expect(report.byPattern).toEqual([
      expect.objectContaining({
        label: "ARB",
        trades: 1,
        totalRealizedRiskReward: 3,
      }),
      expect.objectContaining({
        label: "RB",
        trades: 2,
        totalRealizedRiskReward: 0,
      }),
    ]);
  });

  test("summarizes performance by pattern with Unknown fallback for null/empty setup", () => {
    const report = summarizeClosedPositionsPerformance(
      [
        {
          id: 1,
          pair: "EUR/USD",
          direction: "LONG",
          setup: "RB",
          entry: "1.1000",
          stopLoss: "1.0980",
          takeProfit1: "1.1040",
          takeProfit2: null,
          status: "closed",
          closedAt: "2026-07-01T00:00:00.000Z",
          tp1ClosedPercent: 0,
          trailingStopLoss: null,
          riskRewardRatio: 2,
          tp1RiskRewardRatio: 1,
          tp2RiskRewardRatio: null,
          lastManagementAction: "NONE",
          closeReason: "stop_loss",
          realizedRiskRewardRatio: 1.5,
          realizedExitPrice: "1.1020",
        },
        {
          id: 2,
          pair: "GBP/USD",
          direction: "SHORT",
          setup: null,
          entry: "1.2500",
          stopLoss: "1.2520",
          takeProfit1: "1.2480",
          takeProfit2: null,
          status: "closed",
          closedAt: "2026-07-02T00:00:00.000Z",
          tp1ClosedPercent: 0,
          trailingStopLoss: null,
          riskRewardRatio: 2,
          tp1RiskRewardRatio: 1,
          tp2RiskRewardRatio: null,
          lastManagementAction: "NONE",
          closeReason: "stop_loss",
          realizedRiskRewardRatio: 0.5,
          realizedExitPrice: "1.2510",
        },
        {
          id: 3,
          pair: "EUR/USD",
          direction: "LONG",
          setup: "  ",
          entry: "1.1000",
          stopLoss: "1.0950",
          takeProfit1: "1.1060",
          takeProfit2: null,
          status: "closed",
          closedAt: "2026-07-03T00:00:00.000Z",
          tp1ClosedPercent: 0,
          trailingStopLoss: null,
          riskRewardRatio: 2.5,
          tp1RiskRewardRatio: 1.5,
          tp2RiskRewardRatio: null,
          lastManagementAction: "NONE",
          closeReason: "stop_loss",
          realizedRiskRewardRatio: -1,
          realizedExitPrice: "1.0950",
        },
      ],
      {
        periodLabel: "test",
        startAt: "01/07/2026",
        endAt: "03/07/2026",
      },
    );

    expect(report.byPattern).toHaveLength(2);
    expect(report.byPattern[0]).toMatchObject({
      label: "RB",
      trades: 1,
      wins: 1,
      losses: 0,
      totalRealizedRiskReward: 1.5,
    });
    expect(report.byPattern[1]).toMatchObject({
      label: "Unknown",
      trades: 2,
      wins: 1,
      losses: 1,
      totalRealizedRiskReward: -0.5,
    });
  });
});
