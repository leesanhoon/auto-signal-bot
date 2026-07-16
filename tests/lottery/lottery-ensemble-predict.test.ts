import { beforeEach, beforeAll, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  predictStats: vi.fn(),
  predictRegression: vi.fn(),
}));

vi.mock("../../src/lottery/service/lottery-stats-predict.js", () => ({
  predictTopNumbersStats: state.predictStats,
}));
vi.mock("../../src/lottery/service/lottery-regression-predict.js", () => ({
  predictTopNumbersRegression: state.predictRegression,
}));

let ensemble: typeof import("../../src/lottery/service/lottery-ensemble-predict.js");

beforeAll(async () => {
  ensemble = await import("../../src/lottery/service/lottery-ensemble-predict.js");
});

import type { LotteryDrawRecord } from "../../src/lottery/lottery-types.js";

describe("lottery/lottery-ensemble-predict", () => {
  beforeEach(() => {
    state.predictStats.mockReset();
    state.predictRegression.mockReset();
  });

  test("combines stats and regression with algorithm-only weights", async () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00111", g1: "00111", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-08",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00111", g1: "00111", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
    ];

    state.predictStats.mockReturnValue([
      { number: "111", confidence: 0.8, hundredsDetail: { digit: "1", freq: 2, weightedFreq: 0.5, gap: 0, overdueRatio: 0 }, tensDetail: { digit: "1", freq: 2, weightedFreq: 0.5, gap: 0, overdueRatio: 0 }, unitsDetail: { digit: "1", freq: 2, weightedFreq: 0.5, gap: 0, overdueRatio: 0 } },
      { number: "222", confidence: 0.2, hundredsDetail: { digit: "2", freq: 1, weightedFreq: 0.25, gap: 1, overdueRatio: 0.1 }, tensDetail: { digit: "2", freq: 1, weightedFreq: 0.25, gap: 1, overdueRatio: 0.1 }, unitsDetail: { digit: "2", freq: 1, weightedFreq: 0.25, gap: 1, overdueRatio: 0.1 } },
    ]);
    state.predictRegression.mockReturnValue([
      { number: "111", confidence: 0.4, hundredsDetail: { digit: "1", slope: 0.1, predictedRatio: 0.4, rSquared: 1 }, tensDetail: { digit: "1", slope: 0.1, predictedRatio: 0.4, rSquared: 1 }, unitsDetail: { digit: "1", slope: 0.1, predictedRatio: 0.4, rSquared: 1 } },
      { number: "333", confidence: 0.7, hundredsDetail: { digit: "3", slope: 0.2, predictedRatio: 0.7, rSquared: 1 }, tensDetail: { digit: "3", slope: 0.2, predictedRatio: 0.7, rSquared: 1 }, unitsDetail: { digit: "3", slope: 0.2, predictedRatio: 0.7, rSquared: 1 } },
    ]);

    const result = await ensemble.predictTopNumbersEnsemble(records, "mien-bac", 3, 3);
    const pred111 = result.find((item) => item.number === "111");

    expect(pred111).toBeDefined();
    expect(pred111!.breakdown.stats).toBe(0.8);
    expect(pred111!.breakdown.regression).toBe(0.4);
    expect(pred111!.confidence).toBeCloseTo(0.62, 5);
    expect(pred111!.reason).toContain("Thống kê tần suất");
    expect(pred111!.reason).toContain("Xu hướng hồi quy tuyến tính");
    expect(ensemble.ENSEMBLE_METHOD_VERSION).toBe("ensemble-algorithm-v1");
  });

  test("falls back to the available predictor when the other fails", async () => {
    state.predictStats.mockImplementation(() => {
      throw new Error("stats down");
    });
    state.predictRegression.mockReturnValue([
      { number: "123", confidence: 0.9, hundredsDetail: { digit: "1", slope: 0, predictedRatio: 0.9, rSquared: 1 }, tensDetail: { digit: "2", slope: 0, predictedRatio: 0.9, rSquared: 1 }, unitsDetail: { digit: "3", slope: 0, predictedRatio: 0.9, rSquared: 1 } },
    ]);

    const result = await ensemble.predictTopNumbersEnsemble(
      [
        {
          date: "2026-07-01",
          weekday: 3,
          region: "mien-bac",
          province: "Hà Nội",
          prizes: { db: "00123", g1: "00456", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
        },
      ],
      "mien-bac",
      3,
      1,
    );

    expect(result).toHaveLength(1);
    expect(result[0].number).toBe("123");
    expect(result[0].breakdown.stats).toBeUndefined();
    expect(result[0].breakdown.regression).toBe(0.9);
  });

  test("throws when both deterministic predictors fail", async () => {
    state.predictStats.mockImplementation(() => {
      throw new Error("stats down");
    });
    state.predictRegression.mockImplementation(() => {
      throw new Error("regression down");
    });

    await expect(
      ensemble.predictTopNumbersEnsemble(
        [
          {
            date: "2026-07-01",
            weekday: 3,
            region: "mien-bac",
            province: "Hà Nội",
            prizes: { db: "00123", g1: "00456", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
          },
        ],
        "mien-bac",
        3,
        1,
      ),
    ).rejects.toThrow("Ensemble: cả 2 phương pháp đều không tạo được dự đoán");
  });
});
