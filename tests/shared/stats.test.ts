import { describe, expect, test } from "vitest";
import { buildStatsMessage } from "../../src/shared/stats.js";

describe("shared/stats", () => {
  test("formats a compact stats dashboard message", () => {
    const message = buildStatsMessage({
      openPositions: 3,
      performanceWindowLabel: "7 ngày",
      recentPerformance: {
        label: "Portfolio",
        trades: 5,
        wins: 3,
        losses: 1,
        breakevens: 1,
        winRate: 60,
        totalRealizedRiskReward: 4.2,
        averageRealizedRiskReward: 0.84,
        maxDrawdown: 1.5,
      },
      aiUsageToday: {
        requests: 4,
        inputTokens: 1200,
        outputTokens: 300,
        estimatedCostUsd: 0.1234,
        byProvider: [
          {
            provider: "gemini",
            requests: 3,
            inputTokens: 900,
            outputTokens: 250,
            estimatedCostUsd: 0.0834,
          },
          {
            provider: "claude",
            requests: 1,
            inputTokens: 300,
            outputTokens: 50,
            estimatedCostUsd: 0.04,
          },
        ],
      },
      updatedAtLabel: "01/07/2026, 08:30:00",
    });

    expect(message).toContain("Lệnh đang mở: *3*");
    expect(message).toContain("Win-rate 7 ngày: 60.00% (3W/1L/1BE)");
    expect(message).toContain("AI usage hôm nay: *4* req");
    expect(message).toContain("gemini: 3 req");
    expect(message).toContain("Cập nhật: 01/07/2026, 08:30:00");
  });

  test("empty AI usage shows consistent wording with populated state", () => {
    const message = buildStatsMessage({
      openPositions: 0,
      performanceWindowLabel: "7 ngày",
      recentPerformance: null,
      aiUsageToday: null,
      updatedAtLabel: "01/07/2026, 08:30:00",
    });

    expect(message).toContain("AI usage hôm nay: chưa có dữ liệu");
    expect(message).not.toContain("Algorithm runs");
  });
});
