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

  describe("estimateAiUsageCost with fallback models", () => {
    test("uses fallback rate for unknown gemini model", () => {
      // Unknown model should fall back to gemini-3.5-flash
      const unknownCost = estimateAiUsageCost("gemini", "unknown-gemini-model", 1_000_000, 1_000_000);
      const fallbackCost = estimateAiUsageCost("gemini", "gemini-3.5-flash", 1_000_000, 1_000_000);
      expect(unknownCost).toBe(fallbackCost);
    });

    test("uses fallback rate for unknown claude model", () => {
      // Unknown model should fall back to claude-sonnet-4-6
      const unknownCost = estimateAiUsageCost("claude", "unknown-claude-model", 1_000_000, 1_000_000);
      const fallbackCost = estimateAiUsageCost("claude", "claude-sonnet-4-6", 1_000_000, 1_000_000);
      expect(unknownCost).toBe(fallbackCost);
    });

    test("uses fallback rate for unknown openrouter model", () => {
      // Unknown model should fall back to xiaomi/mimo-v2.5
      const unknownCost = estimateAiUsageCost("openrouter", "unknown/unknown-model", 1_000_000, 1_000_000);
      const fallbackCost = estimateAiUsageCost("openrouter", "xiaomi/mimo-v2.5", 1_000_000, 1_000_000);
      expect(unknownCost).toBe(fallbackCost);
    });

    test("normalizes model name (case insensitive)", () => {
      const cost1 = estimateAiUsageCost("openrouter", "deepseek/deepseek-v4-flash", 1_000, 500);
      const cost2 = estimateAiUsageCost("openrouter", "DEEPSEEK/DEEPSEEK-V4-FLASH", 1_000, 500);
      expect(cost1).toBe(cost2);
    });
  });

  describe("buildAiUsageAlertMessage threshold scenarios", () => {
    test("returns null when no threshold is exceeded", () => {
      const message = buildAiUsageAlertMessage(
        {
          date: "2026-07-01",
          requests: 1,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.001,
          byProvider: [],
          bySource: [],
          byModel: [],
        },
        {
          dailyTokenLimit: 10_000,
          dailyCostLimitUsd: 10,
          thresholdRatio: 0.8,
        },
      );

      expect(message).toBeNull();
    });

    test("returns alert when only token threshold is exceeded", () => {
      const message = buildAiUsageAlertMessage(
        {
          date: "2026-07-01",
          requests: 5,
          inputTokens: 8_000,
          outputTokens: 2_000,
          estimatedCostUsd: 0.1,
          byProvider: [{ key: "openrouter", requests: 5, inputTokens: 8_000, outputTokens: 2_000, estimatedCostUsd: 0.1 }],
          bySource: [],
          byModel: [],
        },
        {
          dailyTokenLimit: 10_000,
          dailyCostLimitUsd: 50,
          thresholdRatio: 0.8,
        },
      );

      expect(message).toContain("Cảnh báo");
      expect(message).toContain("token 10000/10000");
      expect(message).not.toContain("chi phí");
      expect(message).toContain("Theo provider:");
    });

    test("returns alert when only cost threshold is exceeded", () => {
      const message = buildAiUsageAlertMessage(
        {
          date: "2026-07-01",
          requests: 2,
          inputTokens: 500,
          outputTokens: 200,
          estimatedCostUsd: 8,
          byProvider: [],
          bySource: [{ key: "betting", requests: 2, inputTokens: 500, outputTokens: 200, estimatedCostUsd: 8 }],
          byModel: [],
        },
        {
          dailyTokenLimit: 100_000,
          dailyCostLimitUsd: 10,
          thresholdRatio: 0.8,
        },
      );

      expect(message).toContain("Cảnh báo");
      expect(message).toContain("chi phí");
      // Token summary is always shown, but token threshold should not be in the threshold section
      expect(message).toContain("Theo nguồn:");
    });

    test("returns alert when both thresholds are exceeded", () => {
      const message = buildAiUsageAlertMessage(
        {
          date: "2026-07-01",
          requests: 10,
          inputTokens: 9_000,
          outputTokens: 1_000,
          estimatedCostUsd: 9,
          byProvider: [],
          bySource: [],
          byModel: [],
        },
        {
          dailyTokenLimit: 10_000,
          dailyCostLimitUsd: 10,
          thresholdRatio: 0.8,
        },
      );

      expect(message).toContain("Cảnh báo");
      expect(message).toContain("token 10000/10000");
      expect(message).toContain("chi phí");
    });

    test("uses custom threshold ratio", () => {
      // With ratio 0.5, 5500 tokens out of 10000 should trigger alert (55%)
      const message = buildAiUsageAlertMessage(
        {
          date: "2026-07-01",
          requests: 1,
          inputTokens: 5_000,
          outputTokens: 500,
          estimatedCostUsd: 0.05,
          byProvider: [],
          bySource: [],
          byModel: [],
        },
        {
          dailyTokenLimit: 10_000,
          dailyCostLimitUsd: 10,
          thresholdRatio: 0.5,
        },
      );

      expect(message).toContain("Cảnh báo");
      expect(message).toContain("55.0%");
    });

    test("handles missing cost limit gracefully", () => {
      const message = buildAiUsageAlertMessage(
        {
          date: "2026-07-01",
          requests: 1,
          inputTokens: 8_000,
          outputTokens: 2_000,
          estimatedCostUsd: 0.001,
          byProvider: [],
          bySource: [],
          byModel: [],
        },
        {
          dailyTokenLimit: 10_000,
          thresholdRatio: 0.8,
        },
      );

      expect(message).toContain("Cảnh báo");
      expect(message).toContain("token");
    });

    test("handles missing token limit gracefully", () => {
      const message = buildAiUsageAlertMessage(
        {
          date: "2026-07-01",
          requests: 1,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 8,
          byProvider: [],
          bySource: [],
          byModel: [],
        },
        {
          dailyCostLimitUsd: 10,
          thresholdRatio: 0.8,
        },
      );

      expect(message).toContain("Cảnh báo");
      expect(message).toContain("chi phí");
    });

    test("includes provider breakdown when available", () => {
      const message = buildAiUsageAlertMessage(
        {
          date: "2026-07-01",
          requests: 3,
          inputTokens: 8_500,
          outputTokens: 1_500,
          estimatedCostUsd: 1.5,
          byProvider: [
            { key: "openrouter", requests: 2, inputTokens: 5_000, outputTokens: 1_000, estimatedCostUsd: 0.8 },
            { key: "claude", requests: 1, inputTokens: 3_500, outputTokens: 500, estimatedCostUsd: 0.7 },
          ],
          bySource: [],
          byModel: [],
        },
        {
          dailyTokenLimit: 10_000,
          dailyCostLimitUsd: 2,
          thresholdRatio: 0.8,
        },
      );

      expect(message).toContain("Theo provider:");
      expect(message).toContain("openrouter");
      expect(message).toContain("claude");
    });
  });
});
