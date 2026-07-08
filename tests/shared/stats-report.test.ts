import { describe, expect, test } from "vitest";
import { buildStatsReport } from "../../src/shared/stats-report.js";
import { buildStatsMessage } from "../../src/shared/stats.js";

describe("shared/stats-report", () => {
  test("builds a dashboard report from open positions, performance and usage data", () => {
    const report = buildStatsReport({
      openPositions: 4,
      closedPositions: [
        {
          id: 1,
          pair: "EUR/USD",
          direction: "LONG",
          setup: null,
          entry: "1.1000",
          stopLoss: "1.0960",
          takeProfit1: "1.1080",
          takeProfit2: "1.1120",
          status: "closed",
          closedAt: "2026-06-30T10:00:00.000Z",
          tp1ClosedPercent: 50,
          trailingStopLoss: "1.1000",
          riskRewardRatio: 2.5,
          tp1RiskRewardRatio: 2,
          tp2RiskRewardRatio: 3,
          lastManagementAction: "TP2_CLOSE",
          closeReason: "take_profit_2",
          realizedRiskRewardRatio: 2.5,
          realizedExitPrice: "1.1120",
        },
      ],
      aiUsageRecords: [
        {
          recordedAt: "2026-07-01T02:00:00.000Z",
          usageDate: "2026-07-01",
          provider: "gemini",
          model: "gemini-3.5-flash",
          source: "chart",
          inputTokens: 120,
          outputTokens: 30,
          estimatedCostUsd: 0.001,
          metadata: {},
        },
        {
          recordedAt: "2026-07-01T03:00:00.000Z",
          usageDate: "2026-07-01",
          provider: "claude",
          model: "claude-sonnet-4-6",
          source: "betting",
          inputTokens: 200,
          outputTokens: 50,
          estimatedCostUsd: 0.01,
          metadata: {},
        },
      ],
      now: new Date("2026-07-01T08:30:00.000Z"),
      performanceWindowDays: 7,
    });

    expect(report.openPositions).toBe(4);
    expect(report.performanceWindowLabel).toBe("7 ngày");
    expect(report.recentPerformance?.trades).toBe(1);
    expect(report.aiUsageToday?.requests).toBe(2);
    expect(buildStatsMessage(report)).toContain("AI usage hôm nay");
    expect(report.aiUsageToday?.byProvider).toEqual([
      expect.objectContaining({ provider: "claude", requests: 1 }),
      expect.objectContaining({ provider: "gemini", requests: 1 }),
    ]);
    expect(report.updatedAtLabel).toMatch(/1\/7\/26/);
  });
});
