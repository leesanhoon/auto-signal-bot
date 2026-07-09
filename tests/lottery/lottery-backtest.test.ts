import { describe, expect, test } from "vitest";
import { compareBacktestSummaries, runBacktest } from "../../src/lottery/lottery-backtest.js";
import { predictTopNumbersRegression } from "../../src/lottery/lottery-regression-predict.js";
import { predictTopNumbersStats } from "../../src/lottery/lottery-stats-predict.js";
import type { CompactPrizes, LotteryDrawRecord } from "../../src/lottery/lottery-types.js";

function makePrizes(primaryNumber: string, fillerSeed: number): CompactPrizes {
  const normalizedSeed = fillerSeed % 1000;
  const fillerA = ((normalizedSeed + 101) % 1000).toString().padStart(3, "0");
  const fillerB = ((normalizedSeed + 202) % 1000).toString().padStart(3, "0");
  const fillerC = ((normalizedSeed + 303) % 1000).toString().padStart(3, "0");

  return {
    db: `10${primaryNumber}`,
    g1: `20${fillerA}`,
    g2: [`30${fillerB}`],
    g3: [`40${fillerC}`],
    g4: [],
    g5: [],
    g6: [],
    g7: [],
    g8: [],
  };
}

function buildFixtureRecords(): LotteryDrawRecord[] {
  const records: LotteryDrawRecord[] = [];
  for (let day = 1; day <= 15; day += 1) {
    const date = `2026-01-${day.toString().padStart(2, "0")}`;
    records.push({
      date,
      weekday: 3,
      region: "mien-bac",
      province: "Ha Noi",
      prizes: makePrizes("111", day),
    });
  }

  records.push({
    date: "2026-01-16",
    weekday: 3,
    region: "mien-bac",
    province: "Ha Noi",
    prizes: makePrizes("999", 16),
  });
  records.push({
    date: "2026-01-17",
    weekday: 3,
    region: "mien-bac",
    province: "Ha Noi",
    prizes: makePrizes("999", 17),
  });
  records.push({
    date: "2026-01-18",
    weekday: 3,
    region: "mien-bac",
    province: "Ha Noi",
    prizes: makePrizes("999", 18),
  });

  return records;
}

describe("lottery/lottery-backtest", () => {
  test("evaluates walk-forward periods after the minimum training threshold", async () => {
    const records = buildFixtureRecords();

    const summary = await runBacktest(records, "mien-bac", 3, "stats", 3, 10);

    expect(summary.method).toBe("stats");
    expect(summary.periodsEvaluated).toBe(8);
    expect(summary.totalPredictions).toBe(24);
    expect(summary.totalHits).toBeGreaterThan(0);
    expect(summary.hitRate).toBeGreaterThan(0);
  });

  test("supports the ensemble method", async () => {
    const records = buildFixtureRecords();

    const summary = await runBacktest(records, "mien-bac", 3, "ensemble", 3, 10);

    expect(summary.method).toBe("ensemble");
    expect(summary.periodsEvaluated).toBe(8);
    expect(summary.totalPredictions).toBe(24);
    expect(summary.hitRate).toBeGreaterThanOrEqual(0);
  });

  test("returns a non-deterministic random baseline summary", async () => {
    const records = buildFixtureRecords();

    const summary = await runBacktest(records, "mien-bac", 3, "random-baseline", 3, 10);

    expect(summary.method).toBe("random-baseline");
    expect(summary.periodsEvaluated).toBe(8);
    expect(summary.totalPredictions).toBe(24);
    expect(summary.hitRate).toBeGreaterThanOrEqual(0);
  });

  test("does not leak future-only patterns into earlier predictions", async () => {
    const records = buildFixtureRecords();
    const summary = await runBacktest(records, "mien-bac", 3, "regression", 3, 10);
    const firstEvaluatedPeriod = summary.periods[0];
    const trainingSlice = records.filter((record) => record.date < "2026-01-11");
    const trainingOnlyPredictions = predictTopNumbersRegression(trainingSlice, 3).map((item) => item.number);
    const fullDatasetPredictions = predictTopNumbersRegression(records, 3).map((item) => item.number);

    expect(firstEvaluatedPeriod).toBeDefined();
    expect(firstEvaluatedPeriod!.date).toBe("2026-01-11");
    expect(firstEvaluatedPeriod!.predictedNumbers).toEqual(trainingOnlyPredictions);
    expect(firstEvaluatedPeriod!.predictedNumbers).not.toEqual(fullDatasetPredictions);
  });

  test("compareBacktestSummaries returns a readable markdown table", async () => {
    const records = buildFixtureRecords();
    const statsSummary = await runBacktest(records, "mien-bac", 3, "stats", 3, 10);
    const regressionSummary = await runBacktest(records, "mien-bac", 3, "regression", 3, 10);

    const table = compareBacktestSummaries([statsSummary, regressionSummary]);

    expect(table).toContain("Method");
    expect(table).toContain("stats");
    expect(table).toContain("regression");
    expect(table).toContain("Hit Rate");
  });
});
