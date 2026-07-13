import { describe, expect, test } from "vitest";
import {
  buildClosedPositionSnapshot,
  summarizeClosedPositionsPerformance,
  type ClosedPositionRecord,
} from "../../src/charts/performance-tracking-volman.js";

const base: ClosedPositionRecord = {
  id: 1,
  pair: "EUR/USD",
  direction: "LONG",
  setup: "RB",
  entry: "1.1000",
  stopLoss: "1.0960",
  takeProfit1: "1.1080",
  takeProfit2: null,
  status: "closed",
  closedAt: "2026-07-01T00:00:00.000Z",
  riskRewardRatio: 2,
  lastManagementAction: "TAKE_PROFIT_CLOSE",
};

describe("charts/performance-tracking-volman", () => {
  test("records the single TP close as take_profit at 2R", () => {
    expect(buildClosedPositionSnapshot(base, "TAKE_PROFIT_CLOSE")).toEqual({
      closeReason: "take_profit",
      realizedExitPrice: "1.1080",
      realizedRiskRewardRatio: 2,
      outcome: "win",
    });
  });

  test("records stop loss at -1R", () => {
    expect(buildClosedPositionSnapshot(base, "STOP")).toEqual({
      closeReason: "stop_loss",
      realizedExitPrice: "1.0960",
      realizedRiskRewardRatio: -1,
      outcome: "loss",
    });
  });

  test("records manual close from the supplied exit price", () => {
    expect(
      buildClosedPositionSnapshot(base, "MANUAL_CLOSE", {
        stopLoss: "1.1020",
      }),
    ).toMatchObject({
      closeReason: "manual_close",
      realizedExitPrice: "1.1020",
      realizedRiskRewardRatio: 0.5,
      outcome: "win",
    });
  });

  test("summarizes new and legacy take-profit history", () => {
    const report = summarizeClosedPositionsPerformance(
      [
        { ...base, closeReason: "take_profit", realizedRiskRewardRatio: 2 },
        {
          ...base,
          id: 2,
          closeReason: "take_profit_2",
          realizedRiskRewardRatio: 3,
        },
        {
          ...base,
          id: 3,
          closeReason: "stop_loss",
          realizedRiskRewardRatio: -1,
        },
      ],
      {
        periodLabel: "all",
        startAt: "2026-07-01T00:00:00.000Z",
        endAt: "2026-07-31T00:00:00.000Z",
      },
    );

    expect(report.portfolio).toMatchObject({
      trades: 3,
      wins: 2,
      losses: 1,
      totalRealizedRiskReward: 4,
    });
  });
});
