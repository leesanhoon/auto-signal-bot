import { extractNums } from "./lottery-format.js";
import type { LotteryDrawRecord, LotteryRegion } from "./lottery-types.js";

export type PredictionScoringOptions = {
  decay?: number;
  overdueBonus?: number;
  useWeightedExpectedGap?: boolean;
  stationSpreadWeight?: number;
};

/**
 * Tốc độ suy giảm trọng số theo kỳ, riêng theo miền.
 * Baseline này giữ nguyên cho production, nhưng backtest có thể quét lại từng miền.
 */
export const DECAY_BY_REGION: Record<LotteryRegion, number> = {
  "mien-bac": 0.98,
  "mien-trung": 0.9,
  "mien-nam": 0.9,
};

/** Hệ số cộng điểm cho số đang "quá hạn" so với gap kỳ vọng. */
export const OVERDUE_BONUS_BY_REGION: Record<LotteryRegion, number> = {
  "mien-bac": 0.2,
  "mien-trung": 0,
  "mien-nam": 0.2,
};

/** Bonus for numbers appearing across multiple stations in the same draw. */
export const STATION_SPREAD_WEIGHT_BY_REGION: Record<LotteryRegion, number> = {
  "mien-bac": 0,
  "mien-trung": 0.15,
  "mien-nam": 0,
};

export type NumberPrediction = {
  number: string;
  /** Xác suất thống kê thô: số lần xuất hiện / tổng số kỳ. */
  freq: number;
  /** Tần suất có trọng số suy giảm theo thời gian (EWMA). */
  weightedFreq: number;
  /** Số kỳ liên tiếp gần nhất chưa xuất hiện. */
  gap: number;
  /** gap / gap kỳ vọng thống kê. */
  overdueRatio: number;
  /** Tỷ lệ lan tỏa giữa nhiều đài trong cùng kỳ, chuẩn hóa về [0,1]. */
  stationSpread: number;
  score: number;
};

function getScoringOptions(region: LotteryRegion, options?: PredictionScoringOptions): Required<PredictionScoringOptions> {
  return {
    decay: options?.decay ?? DECAY_BY_REGION[region],
    overdueBonus: options?.overdueBonus ?? OVERDUE_BONUS_BY_REGION[region],
    useWeightedExpectedGap: options?.useWeightedExpectedGap ?? false,
    stationSpreadWeight: options?.stationSpreadWeight ?? STATION_SPREAD_WEIGHT_BY_REGION[region],
  };
}

/**
 * Dự đoán top N số 3 chữ số dễ xuất hiện nhất, dựa trên lịch sử 1 miền, đúng 1 thứ trong tuần.
 * Kết hợp 3 tín hiệu:
 * - weightedFreq: số đang "nóng" gần đây
 * - overdueRatio: số đã lâu chưa ra so với kỳ vọng thống kê
 * - stationSpread: số xuất hiện trên nhiều đài trong cùng kỳ
 */
export function predictTopNumbers(
  records: LotteryDrawRecord[],
  region: LotteryRegion,
  topN = 10,
  options?: PredictionScoringOptions,
): NumberPrediction[] {
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const periodIndex = new Map(dates.map((date, i) => [date, i]));
  const periodCount = dates.length;
  if (periodCount === 0) return [];

  const scoring = getScoringOptions(region, options);
  const occurrences = new Map<string, Set<number>>();
  const provincesByDate = new Map<string, Map<string, Set<string>>>();
  const recordsCountByDate = new Map<string, number>();

  for (const record of records) {
    const periodIdx = periodIndex.get(record.date)!;
    const dateMap = provincesByDate.get(record.date) ?? new Map<string, Set<string>>();
    recordsCountByDate.set(record.date, (recordsCountByDate.get(record.date) ?? 0) + 1);

    for (const num of extractNums(record.prizes)) {
      const periods = occurrences.get(num) ?? new Set<number>();
      periods.add(periodIdx);
      occurrences.set(num, periods);

      const provinces = dateMap.get(num) ?? new Set<string>();
      provinces.add(record.province);
      dateMap.set(num, provinces);
    }

    provincesByDate.set(record.date, dateMap);
  }

  const weightByPeriod = dates.map((_, i) => scoring.decay ** (periodCount - 1 - i));
  const totalWeight = weightByPeriod.reduce((sum, w) => sum + w, 0);

  const predictions: NumberPrediction[] = [];
  for (const [number, periods] of occurrences) {
    const freq = periods.size / periodCount;

    let weightedSum = 0;
    let lastSeen = -1;
    let spreadSum = 0;
    let spreadSamples = 0;

    for (const periodIdx of periods) {
      weightedSum += weightByPeriod[periodIdx];
      if (periodIdx > lastSeen) lastSeen = periodIdx;

      const date = dates[periodIdx];
      const provinces = provincesByDate.get(date)?.get(number);
      const dateRecordCount = recordsCountByDate.get(date) ?? 0;
      if (!provinces || dateRecordCount === 0) continue;
      spreadSum += provinces.size / dateRecordCount;
      spreadSamples++;
    }

    const weightedFreq = weightedSum / totalWeight;
    const gap = periodCount - 1 - lastSeen;
    const expectedGap = freq > 0 ? 1 / freq : periodCount;
    const weightedExpectedGap = weightedFreq > 0 ? 1 / weightedFreq : periodCount;
    const gapBasis = scoring.useWeightedExpectedGap ? weightedExpectedGap : expectedGap;
    const overdueRatio = gapBasis > 0 ? gap / gapBasis : 0;
    const stationSpread = spreadSamples > 0 ? spreadSum / spreadSamples : 0;

    const overdueFactor = 1 + scoring.overdueBonus * Math.max(0, overdueRatio - 1);
    const spreadFactor = 1 + scoring.stationSpreadWeight * stationSpread;
    const score = weightedFreq * overdueFactor * spreadFactor;

    predictions.push({ number, freq, weightedFreq, gap, overdueRatio, stationSpread, score });
  }

  predictions.sort((a, b) => b.score - a.score);
  return predictions.slice(0, topN);
}
