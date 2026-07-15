import { describe, expect, test } from "vitest";
import { runForexBacktest } from "../../src/charts/service/forex-backtest.js";

describe("charts/forex-backtest", () => {
  test("summarizes direction and entry accuracy from closed positions", () => {
    const report = runForexBacktest([
      {
        id: 1,
        pair: "EUR/USD",
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0960",
        takeProfit1: "1.1080",
        takeProfit2: "1.1120",
        status: "closed",
        closedAt: "2026-07-01T00:00:00.000Z",
        riskRewardRatio: 2.5,
        lastManagementAction: "TAKE_PROFIT_CLOSE",
        realizedRiskRewardRatio: 1,
        realizedExitPrice: "1.1000",
        closeReason: "take_profit",
      },
      {
        id: 2,
        pair: "GBP/USD",
        direction: "SHORT",
        entry: "1.2500",
        stopLoss: "1.2540",
        takeProfit1: "1.2420",
        takeProfit2: "1.2380",
        status: "closed",
        closedAt: "2026-07-02T00:00:00.000Z",
        riskRewardRatio: 3,
        lastManagementAction: "NONE",
        realizedRiskRewardRatio: -1,
        realizedExitPrice: "1.2540",
        closeReason: "stop_loss",
      },
    ]);

    expect(report.trades).toBe(2);
    expect(report.directionAccuracy).toBe(50);
    expect(report.entryHitRate).toBe(50);
    expect(report.averageRealizedRiskReward).toBe(0);
    expect(report.byPair).toHaveLength(2);
  });
});
