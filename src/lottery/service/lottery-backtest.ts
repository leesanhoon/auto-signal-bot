import { predictTopNumbersEnsemble } from "./lottery-ensemble-predict.js";
import { extractNums, extractNums2 } from "./lottery-format.js";
import { predictTopNumbersRegression } from "./lottery-regression-predict.js";
import { predictTopNumbersStats } from "./lottery-stats-predict.js";
import type { LotteryDrawRecord, LotteryRegion } from "../model/lottery-types.js";

export type BacktestMethod = "stats" | "regression" | "ensemble" | "random-baseline";

export type BacktestPeriodResult = {
  date: string;
  weekday: number;
  region: LotteryRegion;
  predictedNumbers: string[];
  actualNumbers: string[];
  hits: string[];
  actualNumbers2: string[];
  hits2: string[];
};

export type BacktestSummary = {
  method: BacktestMethod;
  region: LotteryRegion;
  periodsEvaluated: number;
  totalPredictions: number;
  totalHits: number;
  hitRate: number;
  totalHits2: number;
  hitRate2: number;
  periods: BacktestPeriodResult[];
};

function groupRecordsByDate(records: LotteryDrawRecord[]): Map<string, LotteryDrawRecord[]> {
  const grouped = new Map<string, LotteryDrawRecord[]>();
  for (const record of records) {
    const existing = grouped.get(record.date);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(record.date, [record]);
    }
  }
  return grouped;
}

function summarize(
  method: BacktestMethod,
  region: LotteryRegion,
  topN: number,
  periods: BacktestPeriodResult[],
): BacktestSummary {
  const totalHits = periods.reduce((sum, period) => sum + period.hits.length, 0);
  const totalHits2 = periods.reduce((sum, period) => sum + period.hits2.length, 0);
  const periodsEvaluated = periods.length;
  const totalPredictions = periodsEvaluated * topN;

  return {
    method,
    region,
    periodsEvaluated,
    totalPredictions,
    totalHits,
    hitRate: totalPredictions > 0 ? totalHits / totalPredictions : 0,
    totalHits2,
    hitRate2: totalPredictions > 0 ? totalHits2 / totalPredictions : 0,
    periods,
  };
}

function randomNumberPool(): string[] {
  return Array.from({ length: 1000 }, (_, index) => index.toString().padStart(3, "0"));
}

/**
 * Random baseline không deterministic vì dùng `Math.random()`.
 * Mục đích là làm mốc so sánh độ lớn hit-rate, không phải snapshot test chính xác từng số.
 */
function pickRandomNumbers(topN: number): string[] {
  const pool = randomNumberPool();
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[randomIndex]] = [pool[randomIndex]!, pool[index]!];
  }
  return pool.slice(0, Math.min(topN, pool.length));
}

async function predictNumbers(
  method: BacktestMethod,
  trainingRecords: LotteryDrawRecord[],
  region: LotteryRegion,
  weekday: number,
  topN: number,
): Promise<string[]> {
  if (method === "stats") {
    return predictTopNumbersStats(trainingRecords, topN).map((item) => item.number);
  }
  if (method === "regression") {
    return predictTopNumbersRegression(trainingRecords, topN).map((item) => item.number);
  }
  if (method === "ensemble") {
    return (await predictTopNumbersEnsemble(trainingRecords, region, weekday, topN)).map((item) => item.number);
  }
  return pickRandomNumbers(topN);
}

export async function runBacktest(
  records: LotteryDrawRecord[],
  region: LotteryRegion,
  weekday: number,
  method: BacktestMethod,
  topN: number,
  minTrainingPeriods: number,
): Promise<BacktestSummary> {
  const filtered = records
    .filter((record) => record.region === region && record.weekday === weekday)
    .sort((left, right) => left.date.localeCompare(right.date));

  const periodsByDate = groupRecordsByDate(filtered);
  const periods = Array.from(periodsByDate.keys()).sort((left, right) => left.localeCompare(right));
  const evaluatedPeriods: BacktestPeriodResult[] = [];

  for (let index = minTrainingPeriods; index < periods.length; index += 1) {
    const targetDate = periods[index]!;
    const trainingRecords = filtered.filter((record) => record.date < targetDate);
    if (trainingRecords.length === 0) {
      continue;
    }

    const predictedNumbers = await predictNumbers(method, trainingRecords, region, weekday, topN);
    const actualRecords = periodsByDate.get(targetDate) ?? [];
    const actualNumbers = Array.from(
      new Set(actualRecords.flatMap((record) => extractNums(record.prizes))),
    ).sort((left, right) => left.localeCompare(right));
    const actualSet = new Set(actualNumbers);
    const hits = predictedNumbers.filter((number) => actualSet.has(number));
    const actualNumbers2 = Array.from(
      new Set(actualRecords.flatMap((record) => extractNums2(record.prizes))),
    ).sort((left, right) => left.localeCompare(right));
    const actualSet2 = new Set(actualNumbers2);
    const hits2 = predictedNumbers.filter((number) => actualSet2.has(number.slice(-2)));

    evaluatedPeriods.push({
      date: targetDate,
      weekday,
      region,
      predictedNumbers,
      actualNumbers,
      hits,
      actualNumbers2,
      hits2,
    });
  }

  return summarize(method, region, topN, evaluatedPeriods);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function compareBacktestSummaries(summaries: BacktestSummary[]): string {
  const headers = ["Method", "Region", "Periods", "Predictions", "Hits", "Hit Rate", "Hits2", "Hit Rate 2"];
  const rows = summaries.map((summary) => [
    summary.method,
    summary.region,
    String(summary.periodsEvaluated),
    String(summary.totalPredictions),
    String(summary.totalHits),
    percent(summary.hitRate),
    String(summary.totalHits2),
    percent(summary.hitRate2),
  ]);

  const widths = headers.map((header, columnIndex) => {
    return rows.reduce(
      (max, row) => Math.max(max, row[columnIndex]!.length),
      header.length,
    );
  });

  const formatRow = (columns: string[]) =>
    `| ${columns.map((column, index) => column.padEnd(widths[index]!)).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;

  return [formatRow(headers), separator, ...rows.map(formatRow)].join("\n");
}
