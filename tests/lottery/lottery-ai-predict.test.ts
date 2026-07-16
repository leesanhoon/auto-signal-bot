import { describe, expect, test } from "vitest";
import { predictTopNumbersStats } from "../../src/lottery/service/lottery-stats-predict.js";
import { predictTopNumbersRegression } from "../../src/lottery/service/lottery-regression-predict.js";
import type { LotteryDrawRecord } from "../../src/lottery/lottery-types.js";

describe("lottery predictor helpers", () => {
  test("stats predictor returns deterministic top numbers", () => {
    const records: LotteryDrawRecord[] = [
      { date: "2026-07-01", weekday: 3, region: "mien-bac", province: "Hà Nội", prizes: { db: "00123", g1: "00456", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] } },
      { date: "2026-07-08", weekday: 3, region: "mien-bac", province: "Hà Nội", prizes: { db: "00123", g1: "00456", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] } },
      { date: "2026-07-15", weekday: 3, region: "mien-bac", province: "Hà Nội", prizes: { db: "00123", g1: "00456", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] } },
    ];

    const result = predictTopNumbersStats(records, 3);

    expect(result).toHaveLength(3);
    expect(result[0].number).toMatch(/^\d{3}$/);
    expect(result[0].confidence).toBeGreaterThanOrEqual(result[1].confidence);
  });

  test("regression predictor returns deterministic top numbers", () => {
    const records: LotteryDrawRecord[] = [
      { date: "2026-07-01", weekday: 3, region: "mien-bac", province: "Hà Nội", prizes: { db: "00123", g1: "00456", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] } },
      { date: "2026-07-08", weekday: 3, region: "mien-bac", province: "Hà Nội", prizes: { db: "00124", g1: "00457", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] } },
      { date: "2026-07-15", weekday: 3, region: "mien-bac", province: "Hà Nội", prizes: { db: "00125", g1: "00458", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] } },
    ];

    const result = predictTopNumbersRegression(records, 3);

    expect(result).toHaveLength(3);
    expect(result[0].number).toMatch(/^\d{3}$/);
    expect(result[0].confidence).toBeGreaterThanOrEqual(result[1].confidence);
  });
});
