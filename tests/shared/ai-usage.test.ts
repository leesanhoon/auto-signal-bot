import { describe, expect, test } from "vitest";
import {
  aggregateAiUsageByDay,
  buildAiUsageAlertMessage,
  estimateAiUsageCost,
  extractClaudeUsage,
  extractGeminiUsage,
  extractOpenRouterUsage,
} from "../../src/shared/ai-usage.js";

describe("shared/ai-usage", () => {
  test("extracts usage from Gemini and Claude responses", () => {
    expect(
      extractGeminiUsage({
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 45,
          totalTokenCount: 170,
        },
      }),
    ).toEqual({ inputTokens: 120, outputTokens: 45 });

    expect(
      extractClaudeUsage({
        usage: {
          input_tokens: 300,
          output_tokens: 80,
        },
      }),
    ).toEqual({ inputTokens: 300, outputTokens: 80 });

    expect(
      extractOpenRouterUsage({
        usage: {
          promptTokens: 140,
          completionTokens: 30,
          cachedTokens: 90,
        },
      }),
    ).toEqual({ inputTokens: 140, outputTokens: 30, cachedTokens: 90 });
  });

  test("aggregates usage by day and keeps breakdowns", () => {
    const summary = aggregateAiUsageByDay([
      {
        recordedAt: "2026-07-01T01:00:00.000Z",
        usageDate: "2026-07-01",
        provider: "gemini",
        model: "gemini-3.5-flash",
        source: "chart",
        inputTokens: 100,
        outputTokens: 25,
        estimatedCostUsd: 0.001,
        metadata: {},
      },
      {
        recordedAt: "2026-07-01T02:00:00.000Z",
        usageDate: "2026-07-01",
        provider: "claude",
        model: "claude-sonnet-4-6",
        source: "betting",
        inputTokens: 200,
        outputTokens: 50,
        estimatedCostUsd: 0.01,
        metadata: {},
      },
      {
        recordedAt: "2026-07-02T02:00:00.000Z",
        usageDate: "2026-07-02",
        provider: "gemini",
        model: "gemini-2.5-pro",
        source: "chart",
        inputTokens: 300,
        outputTokens: 75,
        estimatedCostUsd: 0.02,
        metadata: {},
      },
    ]);

    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({
      date: "2026-07-02",
      requests: 1,
      inputTokens: 300,
      outputTokens: 75,
      estimatedCostUsd: 0.02,
      byProvider: [expect.objectContaining({ key: "gemini", requests: 1 })],
    });
    expect(summary[1]).toMatchObject({
      date: "2026-07-01",
      requests: 2,
      inputTokens: 300,
      outputTokens: 75,
      estimatedCostUsd: 0.011,
    });
  });

  test("builds an alert message when usage crosses configured thresholds", () => {
    const message = buildAiUsageAlertMessage(
      {
        date: "2026-07-01",
        requests: 6,
        inputTokens: 7_500,
        outputTokens: 2_500,
        estimatedCostUsd: 1.8,
        byProvider: [],
        bySource: [],
        byModel: [],
      },
      {
        dailyTokenLimit: 10_000,
        dailyCostLimitUsd: 2,
        thresholdRatio: 0.8,
      },
    );

    expect(message).toContain("Cảnh báo mức dùng AI");
    expect(message).toContain("token 10000/10000");
    expect(message).toContain("chi phí $1.8000/$2.0000");
  });

  test("estimates cost from token counts", () => {
    expect(estimateAiUsageCost("claude", "claude-sonnet-4-6", 1_000, 500)).toBeGreaterThan(0);
  });
});
