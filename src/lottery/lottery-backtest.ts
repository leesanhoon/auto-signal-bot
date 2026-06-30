import { extractNums } from "./lottery-format.js";
import { predictTopNumbers, type PredictionScoringOptions } from "./lottery-predict.js";
import type { LotteryDrawRecord, LotteryRegion } from "./lottery-types.js";

export type BacktestReport = {
  periodsTested: number;
  hitRate: number;
  baselineHitRate: number;
  edge: number;
  hits: number;
  baselineHits: number;
};

export type BacktestOptions = {
  topN?: number;
  minTrainPeriods?: number;
  scoring?: PredictionScoringOptions;
};

/** Xác suất hypergeometric ≥1 trúng khi chọn `drawn` số đã ra trong tổng `universe`, so với `picked` số đoán ngẫu nhiên. */
function hypergeometricAtLeastOneHit(universe: number, drawn: number, picked: number): number {
  if (drawn <= 0 || picked <= 0 || universe <= 0) return 0;
  let probZeroHits = 1;
  for (let i = 0; i < picked; i++) {
    const numerator = universe - drawn - i;
    const denominator = universe - i;
    if (numerator <= 0) return 1;
    probZeroHits *= numerator / denominator;
  }
  return 1 - probZeroHits;
}

/**
 * Walk-forward validation: với mỗi kỳ i (từ minTrainPeriods), dùng kỳ 0..i-1 để dự đoán, so với
 * số thật xuất hiện ở kỳ i. So sánh hitRate thật với baseline ngẫu nhiên (hypergeometric) để biết
 * model có thực sự nhúc nhích hơn random hay không.
 */
export function runBacktest(
  records: LotteryDrawRecord[],
  region: LotteryRegion,
  topN = 3,
  minTrainPeriods = 20,
  options?: BacktestOptions,
): BacktestReport {
  const dates = [...new Set(records.map((r) => r.date))].sort();
  if (dates.length <= minTrainPeriods) {
    return { periodsTested: 0, hitRate: 0, baselineHitRate: 0, edge: 0, hits: 0, baselineHits: 0 };
  }

  const recordsByDate = new Map<string, LotteryDrawRecord[]>();
  for (const record of records) {
    const list = recordsByDate.get(record.date) ?? [];
    list.push(record);
    recordsByDate.set(record.date, list);
  }

  let hits = 0;
  let baselineHits = 0;
  let periodsTested = 0;

  for (let i = minTrainPeriods; i < dates.length; i++) {
    const trainDates = new Set(dates.slice(0, i));
    const trainRecords = records.filter((r) => trainDates.has(r.date));
    const predictions = predictTopNumbers(trainRecords, region, topN, options?.scoring);
    if (predictions.length === 0) continue;

    const actualRecords = recordsByDate.get(dates[i]) ?? [];
    const actualNumbers = new Set<string>();
    for (const record of actualRecords) {
      for (const num of extractNums(record.prizes)) actualNumbers.add(num);
    }
    if (actualNumbers.size === 0) continue;

    const predictedSet = new Set(predictions.map((p) => p.number));
    const hit = [...predictedSet].some((n) => actualNumbers.has(n));
    if (hit) hits++;

    baselineHits += hypergeometricAtLeastOneHit(1000, actualNumbers.size, predictedSet.size);
    periodsTested++;
  }

  if (periodsTested === 0) {
    return { periodsTested: 0, hitRate: 0, baselineHitRate: 0, edge: 0, hits: 0, baselineHits: 0 };
  }

  const hitRate = hits / periodsTested;
  const baselineHitRate = baselineHits / periodsTested;
  return { periodsTested, hitRate, baselineHitRate, edge: hitRate - baselineHitRate, hits, baselineHits };
}
