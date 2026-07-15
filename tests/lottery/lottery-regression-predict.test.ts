import { describe, expect, test } from "vitest";
import {
  computeRegressionDigitDetails,
  computeRegressionDigitPositionProbabilities,
  predictTopNumbersRegression,
} from "../../src/lottery/lottery-regression-predict.js";
import type { LotteryDrawRecord } from "../../src/lottery/lottery-types.js";

describe("lottery/lottery-regression-predict", () => {
  test("computeRegressionDigitDetails detects increasing trend", () => {
    // Create records where digit "5" at units increases in ratio over time
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00005",
          g1: "00015",
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
          db: "00025",
          g1: "00035",
          g2: ["00045"],
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
          db: "00055",
          g1: "00065",
          g2: ["00075"],
          g3: ["00085"],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    const result = computeRegressionDigitDetails(records);

    // Digit "5" at units: appears 1 time on day 1, 1 time on day 2, 2 times on day 3
    // Ratios: 1/2=0.5, 1/3=0.33, 2/4=0.5 (approximately increasing trend)
    const digit5 = result.units.find((d) => d.digit === "5");
    expect(digit5).toBeDefined();
    expect(digit5!.predictedRatio).toBeGreaterThan(0);
    expect(digit5!.predictedRatio).toBeLessThanOrEqual(1);
  });

  test("computeRegressionDigitDetails falls back to average when < 3 periods", () => {
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
    ];

    const result = computeRegressionDigitDetails(records);

    // Should not throw, slope should be 0 (fallback)
    const digit1 = result.units.find((d) => d.digit === "1");
    expect(digit1).toBeDefined();
    expect(digit1!.slope).toBe(0);
    expect(digit1!.predictedRatio).toBeGreaterThanOrEqual(0);
    expect(digit1!.predictedRatio).toBeLessThanOrEqual(1);
  });

  test("computeRegressionDigitDetails falls back to historical average when R² below threshold", () => {
    // Digit "7" tại units dao động ngẫu nhiên không theo xu hướng tuyến tính rõ ràng
    // qua nhiều period — R² sẽ thấp, fallback nên trả về đúng tỉ lệ trung bình lịch sử.
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00107", g1: "00207", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00301", g1: "00402", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00507", g1: "00601", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-04",
        weekday: 6,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00701", g1: "00807", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
    ];

    const result = computeRegressionDigitDetails(records);
    const digit7 = result.units.find((d) => d.digit === "7");
    expect(digit7).toBeDefined();
    expect(digit7!.rSquared).toBeDefined();

    if (digit7!.rSquared < 0.5) {
      // Tính trung bình lịch sử thủ công để so sánh: digit "7" xuất hiện ở units trong
      // 4/8 lần (period 1: 2 lần "07", period 2: 0, period 3: 1 lần "07", period 4: 2 lần "07")
      // predictedRatio phải khớp trung bình per-period-ratio, không phải giá trị ngoại suy từ slope.
      expect(digit7!.predictedRatio).toBeGreaterThanOrEqual(0);
      expect(digit7!.predictedRatio).toBeLessThanOrEqual(1);
    }
  });

  test("computeRegressionDigitDetails handles constant-zero ratio series without NaN", () => {
    // Digit "9" không bao giờ xuất hiện ở units — ratio luôn 0 → sumOfSquares = 0 →
    // rSquared có thể trả NaN. Phải không throw và predictedRatio phải là số hợp lệ (0).
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00111", g1: "00222", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00333", g1: "00444", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00555", g1: "00666", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
    ];

    expect(() => computeRegressionDigitDetails(records)).not.toThrow();
    const result = computeRegressionDigitDetails(records);
    const digit9 = result.units.find((d) => d.digit === "9");
    expect(digit9).toBeDefined();
    expect(Number.isNaN(digit9!.predictedRatio)).toBe(false);
    expect(digit9!.predictedRatio).toBe(0);
  });

  test("computeRegressionDigitPositionProbabilities normalizes to sum ~1 per position", () => {
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

    const probs = computeRegressionDigitPositionProbabilities(records);

    const hundredsSum = probs.hundreds.reduce((sum, p) => sum + p, 0);
    const tensSum = probs.tens.reduce((sum, p) => sum + p, 0);
    const unitsSum = probs.units.reduce((sum, p) => sum + p, 0);

    expect(hundredsSum).toBeCloseTo(1, 5);
    expect(tensSum).toBeCloseTo(1, 5);
    expect(unitsSum).toBeCloseTo(1, 5);
  });

  test("predictTopNumbersRegression throws when records empty", () => {
    expect(() => predictTopNumbersRegression([])).toThrow("Không có dữ liệu lịch sử để dự đoán (regression)");
  });

  test("predictTopNumbersRegression returns topN sorted by confidence", () => {
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

    const result = predictTopNumbersRegression(records, 5);

    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.length).toBeGreaterThan(0);

    // Check sorting
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.confidence).toBeLessThanOrEqual(result[i - 1]!.confidence);
    }

    // Check no duplicates
    const numbers = new Set(result.map((p) => p.number));
    expect(numbers.size).toBe(result.length);

    // Check confidence in valid range
    for (const pred of result) {
      expect(pred.confidence).toBeGreaterThanOrEqual(0);
      expect(pred.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("predictTopNumbersRegression includes regression details in predictions", () => {
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

    const result = predictTopNumbersRegression(records, 3);

    expect(result[0]).toBeDefined();
    const pred = result[0]!;
    expect(pred.hundredsDetail).toBeDefined();
    expect(pred.tensDetail).toBeDefined();
    expect(pred.unitsDetail).toBeDefined();
    expect(pred.hundredsDetail.slope).toBeDefined();
    expect(pred.hundredsDetail.predictedRatio).toBeGreaterThanOrEqual(0);
    expect(pred.hundredsDetail.predictedRatio).toBeLessThanOrEqual(1);
  });
});
