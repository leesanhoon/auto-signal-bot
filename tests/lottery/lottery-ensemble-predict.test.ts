import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  predictAI: vi.fn(),
}));

vi.mock("../../src/lottery/lottery-ai-predict.js", () => ({
  predictTopNumbersAI: state.predictAI,
}));

const ensemblePredict = await import("../../src/lottery/lottery-ensemble-predict.js");
const statsPredict = await import("../../src/lottery/lottery-stats-predict.js");
const regressionPredict = await import("../../src/lottery/lottery-regression-predict.js");

import type { LotteryDrawRecord } from "../../src/lottery/lottery-types.js";

describe("lottery/lottery-ensemble-predict", () => {
  beforeEach(() => {
    state.predictAI.mockReset();
    // Clean up any spies from previous tests (e.g. regression spy)
    vi.restoreAllMocks();
  });

  test("predictTopNumbersEnsemble combines all three methods with correct weights", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00111",
          g2: ["00111"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00111",
          g2: ["00111"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00111",
          g2: ["00111"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    // Mock AI to return "111" with 0.8 confidence
    state.predictAI.mockResolvedValueOnce([
      {
        number: "111",
        confidence: 0.8,
        reason: "AI thinks 111 is likely",
        hundredsDigit: "1",
        tensDigit: "1",
        unitsDigit: "1",
      },
    ]);

    const result = await ensemblePredict.predictTopNumbersEnsemble(records, "mien-bac", 3, 3);

    expect(result.length).toBeGreaterThan(0);
    const pred111 = result.find((p) => p.number === "111");
    expect(pred111).toBeDefined();
    expect(pred111!.breakdown.ai).toBe(0.8);
    expect(pred111!.breakdown.stats).toBeGreaterThan(0);
    expect(pred111!.breakdown.regression).toBeGreaterThan(0);

    // Final score should be weighted average
    const weights = ensemblePredict.ENSEMBLE_WEIGHTS;
    const expectedScore =
      (0.8 * weights.ai +
        pred111!.breakdown.stats! * weights.stats +
        pred111!.breakdown.regression! * weights.regression) /
      (weights.ai + weights.stats + weights.regression);
    expect(pred111!.confidence).toBeCloseTo(expectedScore, 5);

    // Reason should contain detailed stats and regression info (not generic labels)
    expect(pred111!.reason).toContain("Thống kê:");
    expect(pred111!.reason).toContain("Hồi quy:");
    expect(pred111!.reason).toMatch(/%/); // Contains percentage values
  });

  test("predictTopNumbersEnsemble continues when AI fails", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00222",
          g1: "00222",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00222",
          g1: "00222",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00222",
          g1: "00222",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    // Mock AI to throw error
    state.predictAI.mockRejectedValueOnce(new Error("Network error"));

    const result = await ensemblePredict.predictTopNumbersEnsemble(records, "mien-bac", 3, 3);

    // Should still return predictions from stats + regression
    expect(result.length).toBeGreaterThan(0);

    // AI field should be undefined for all predictions (AI failed)
    for (const pred of result) {
      expect(pred.breakdown.ai).toBeUndefined();
      expect(pred.breakdown.stats).toBeDefined();
      expect(pred.breakdown.regression).toBeDefined();
    }
  });

  test("predictTopNumbersEnsemble renormalizes weights when method is missing for a number", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00333",
          g1: "00333",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00333",
          g1: "00333",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00333",
          g1: "00333",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    // Mock AI to return only "999" (not in stats/regression top list)
    state.predictAI.mockResolvedValueOnce([
      {
        number: "999",
        confidence: 0.9,
        reason: "AI specialty",
        hundredsDigit: "9",
        tensDigit: "9",
        unitsDigit: "9",
      },
    ]);

    const result = await ensemblePredict.predictTopNumbersEnsemble(records, "mien-bac", 3, 3);

    expect(result.length).toBeGreaterThan(0);

    // Find "333" which should only have stats + regression
    const pred333 = result.find((p) => p.number === "333");
    if (pred333) {
      expect(pred333.breakdown.ai).toBeUndefined();
      expect(pred333.breakdown.stats).toBeDefined();
      expect(pred333.breakdown.regression).toBeDefined();

      // Confidence should be renormalized (0.3/(0.3+0.3) * stats + 0.3/(0.3+0.3) * regression)
      const expectedScore =
        (pred333.breakdown.stats! * 0.5 + pred333.breakdown.regression! * 0.5);
      expect(pred333.confidence).toBeCloseTo(expectedScore, 5);
    }
  });

  test("predictTopNumbersEnsemble works even when AI fails (stats+regression provide results)", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00222",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00333",
          g1: "00444",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00555",
          g1: "00666",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    // Mock AI to throw
    state.predictAI.mockRejectedValueOnce(new Error("Network error"));

    // Should still succeed with stats + regression
    const result = await ensemblePredict.predictTopNumbersEnsemble(records, "mien-bac", 3, 3);

    expect(result.length).toBeGreaterThan(0);
    // Verify that at least some predictions have stats or regression (AI should be undefined)
    for (const pred of result) {
      expect(pred.breakdown.ai).toBeUndefined();
      // At least one of stats/regression should be present
      expect(
        pred.breakdown.stats !== undefined || pred.breakdown.regression !== undefined,
      ).toBe(true);
    }
  });

  test("predictTopNumbersEnsemble throws when records empty", async () => {
    await expect(
      ensemblePredict.predictTopNumbersEnsemble([], "mien-bac", 3, 3),
    ).rejects.toThrow("Không có dữ liệu lịch sử để dự đoán");

    expect(state.predictAI).not.toHaveBeenCalled();
  });

  test("predictTopNumbersEnsemble returns topN sorted by confidence", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00222",
          g2: ["00333"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00222",
          g2: ["00333"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00222",
          g2: ["00333"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    state.predictAI.mockResolvedValueOnce([
      {
        number: "111",
        confidence: 0.7,
        reason: "AI: 111",
        hundredsDigit: "1",
        tensDigit: "1",
        unitsDigit: "1",
      },
    ]);

    const result = await ensemblePredict.predictTopNumbersEnsemble(records, "mien-bac", 3, 10);

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(10);

    // Check sorting descending
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.confidence).toBeLessThanOrEqual(result[i - 1]!.confidence);
    }
  });

  test("predictTopNumbersEnsemble reason string does not have trailing separator for AI+Stats without Regression", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00555",
          g1: "00555",
          g2: ["00555"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00555",
          g1: "00555",
          g2: ["00555"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00555",
          g1: "00555",
          g2: ["00555"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    const aiReason = "AI observed strong signal";
    state.predictAI.mockResolvedValueOnce([
      {
        number: "555",
        confidence: 0.85,
        reason: aiReason,
        hundredsDigit: "5",
        tensDigit: "5",
        unitsDigit: "5",
      },
    ]);

    // Make regression return empty — "555" will only have AI + Stats
    vi.spyOn(regressionPredict, "predictTopNumbersRegression").mockReturnValueOnce([]);

    const result = await ensemblePredict.predictTopNumbersEnsemble(records, "mien-bac", 3, 5);

    expect(result.length).toBeGreaterThan(0);
    const pred555 = result.find((p) => p.number === "555");
    expect(pred555).toBeDefined();

    // Should have AI reason + stats, but NOT regression
    expect(pred555!.reason).toContain("AI");
    expect(pred555!.reason).toContain("Thống kê:");
    // Regression should NOT contribute — this test verifies reason without trailing separator
    expect(pred555!.breakdown.regression).toBeUndefined();
    // Most importantly: reason should NOT end with "; " or other separator (no trailing punctuation)
    expect(pred555!.reason.trim()).not.toMatch(/[;,]\s*$/);
  });

  test("predictTopNumbersEnsemble includes reason in predictions", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00444",
          g1: "00444",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00444",
          g1: "00444",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00444",
          g1: "00444",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    const aiReason = "AI observed pattern X";
    state.predictAI.mockResolvedValueOnce([
      {
        number: "444",
        confidence: 0.75,
        reason: aiReason,
        hundredsDigit: "4",
        tensDigit: "4",
        unitsDigit: "4",
      },
    ]);

    const result = await ensemblePredict.predictTopNumbersEnsemble(records, "mien-bac", 3, 5);

    expect(result.length).toBeGreaterThan(0);
    const pred = result[0]!;
    expect(pred.reason).toBeDefined();
    expect(pred.reason.length).toBeGreaterThan(0);
  });

  test("predictTopNumbersEnsemble includes detailed stats reason with specific digit/percentage", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00111",
          g2: ["00111"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00111",
          g2: ["00111"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00222",
          g1: "00222",
          g2: ["00222"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    // Spy on regression to return empty so only stats contributes
    vi.spyOn(regressionPredict, "predictTopNumbersRegression").mockReturnValueOnce([]);
    state.predictAI.mockResolvedValueOnce([]);

    const result = await ensemblePredict.predictTopNumbersEnsemble(records, "mien-bac", 3, 3);

    expect(result.length).toBeGreaterThan(0);
    for (const pred of result) {
      expect(pred.reason).toContain("Thống kê:");
      expect(pred.reason).toMatch(/\d+\.\d+%/); // Has percentage with decimal
    }
  });

  test("predictTopNumbersEnsemble includes detailed regression reason with specific digit/percentage", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00111",
          g2: ["00111"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00111",
          g1: "00111",
          g2: ["00111"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00333",
          g1: "00333",
          g2: ["00333"],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    // Spy on stats to return empty so only regression contributes
    vi.spyOn(statsPredict, "predictTopNumbersStats").mockReturnValueOnce([]);
    state.predictAI.mockResolvedValueOnce([]);

    const result = await ensemblePredict.predictTopNumbersEnsemble(records, "mien-bac", 3, 3);

    expect(result.length).toBeGreaterThan(0);
    for (const pred of result) {
      expect(pred.reason).toContain("Hồi quy:");
      expect(pred.reason).toMatch(/\d+\.\d+%/); // Has percentage with decimal
    }
  });
});