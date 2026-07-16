import { describe, expect, test } from "vitest";
import {
  computeDigitGapAndOverdue,
  computeStatDigitPositionProbabilities,
  predictTopNumbersStats,
  EXPECTED_GAP,
} from "../../src/lottery/service/lottery-stats-predict.js";
import type { LotteryDrawRecord } from "../../src/lottery/lottery-types.js";

describe("lottery/lottery-stats-predict", () => {
  test("computeDigitGapAndOverdue calculates gap correctly for digits that appeared recently", () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00001",
          g1: "00002",
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
          db: "00003",
          g1: "00004",
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
          db: "00001",
          g1: "00005",
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

    const result = computeDigitGapAndOverdue(records);

    // Digit "1" in units appeared on 2026-07-01 and 2026-07-03 (latest)
    // Gap from 2026-07-03 (index 2) is 0
    const unitDigit1 = result.units.find((d) => d.digit === "1");
    expect(unitDigit1).toBeDefined();
    expect(unitDigit1!.gap).toBe(0);
    expect(unitDigit1!.freq).toBe(2);

    // Digit "2" in units appeared on 2026-07-01 only, not on latest date
    // Total unique dates = 3, last appearance index = 0, gap = 3 - 1 - 0 = 2
    const unitDigit2 = result.units.find((d) => d.digit === "2");
    expect(unitDigit2).toBeDefined();
    expect(unitDigit2!.gap).toBe(2);

    // Digit "9" never appeared, gap = total periods = 3
    const unitDigit9 = result.units.find((d) => d.digit === "9");
    expect(unitDigit9).toBeDefined();
    expect(unitDigit9!.gap).toBe(3);
  });

  test("computeStatDigitPositionProbabilities normalizes to sum ~1 per position", () => {
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
    ];

    const probs = computeStatDigitPositionProbabilities(records);

    const hundredsSum = probs.hundreds.reduce((sum, p) => sum + p, 0);
    const tensSum = probs.tens.reduce((sum, p) => sum + p, 0);
    const unitsSum = probs.units.reduce((sum, p) => sum + p, 0);

    expect(hundredsSum).toBeCloseTo(1, 5);
    expect(tensSum).toBeCloseTo(1, 5);
    expect(unitsSum).toBeCloseTo(1, 5);
  });

  test("predictTopNumbersStats throws when records empty", () => {
    expect(() => predictTopNumbersStats([])).toThrow("Không có dữ liệu lịch sử để dự đoán (stats)");
  });

  test("predictTopNumbersStats returns topN sorted by confidence descending", () => {
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
    ];

    const result = predictTopNumbersStats(records, 3);

    expect(result.length).toBeLessThanOrEqual(3);
    expect(result[0]).toBeDefined();
    expect(result[0]!.number).toBe("111");
    expect(result[0]!.confidence).toBeGreaterThanOrEqual(0);
    expect(result[0]!.confidence).toBeLessThanOrEqual(1);

    // Check sorting
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.confidence).toBeLessThanOrEqual(result[i - 1]!.confidence);
    }

    // Check no duplicates
    const numbers = new Set(result.map((p) => p.number));
    expect(numbers.size).toBe(result.length);
  });

  test("predictTopNumbersStats includes digit details in predictions", () => {
    const records: LotteryDrawRecord[] = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: {
          db: "00123",
          g1: "00456",
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

    const result = predictTopNumbersStats(records, 5);

    expect(result.length).toBeGreaterThan(0);
    const pred = result[0]!;
    expect(pred.hundredsDetail).toBeDefined();
    expect(pred.tensDetail).toBeDefined();
    expect(pred.unitsDetail).toBeDefined();
    expect(pred.hundredsDetail.gap).toBeGreaterThanOrEqual(0);
    expect(pred.hundredsDetail.overdueRatio).toBeGreaterThanOrEqual(0);
  });
});
