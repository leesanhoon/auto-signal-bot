import { extractNums } from "./lottery-format.js";
import type { LotteryDrawRecord } from "./model/lottery-types.js";

export const EXPECTED_GAP = 10;

export type DigitPositionProbabilities = {
  hundreds: number[];
  tens: number[];
  units: number[];
};

export type StatDigitDetail = {
  digit: string;
  freq: number;
  weightedFreq: number;
  gap: number;
  overdueRatio: number;
};

export type StatNumberPrediction = {
  number: string;
  confidence: number;
  hundredsDetail: StatDigitDetail;
  tensDetail: StatDigitDetail;
  unitsDetail: StatDigitDetail;
};

export function computeDigitGapAndOverdue(
  records: LotteryDrawRecord[],
): { hundreds: StatDigitDetail[]; tens: StatDigitDetail[]; units: StatDigitDetail[] } {
  // Sort records by date ascending
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));

  // Group by unique dates to get periods
  const periods: string[] = [];
  const periodMap = new Map<string, LotteryDrawRecord[]>();

  for (const record of sorted) {
    if (!periodMap.has(record.date)) {
      periods.push(record.date);
      periodMap.set(record.date, []);
    }
    periodMap.get(record.date)!.push(record);
  }

  const totalPeriods = periods.length;

  // Calculate stats for each position
  const positions: Array<"hundreds" | "tens" | "units"> = ["hundreds", "tens", "units"];
  const positionIndex: Record<string, number> = { hundreds: 0, tens: 1, units: 2 };

  const result: { hundreds: StatDigitDetail[]; tens: StatDigitDetail[]; units: StatDigitDetail[] } = {
    hundreds: [],
    tens: [],
    units: [],
  };

  for (const pos of positions) {
    const idx = positionIndex[pos];
    const digitStats = new Map<string, { freq: number; lastPeriodIndex: number | null }>();

    // Initialize for digits 0-9
    for (let d = 0; d < 10; d++) {
      digitStats.set(String(d), { freq: 0, lastPeriodIndex: null });
    }

    // Count frequency and track last period where digit appeared
    for (let periodIdx = 0; periodIdx < periods.length; periodIdx++) {
      const period = periods[periodIdx]!;
      const recordsInPeriod = periodMap.get(period)!;

      for (const record of recordsInPeriod) {
        for (const num of extractNums(record.prizes)) {
          if (num.length < 3) continue;
          const digit = num[idx]!;
          const stat = digitStats.get(digit)!;
          stat.freq++;
          stat.lastPeriodIndex = periodIdx;
        }
      }
    }

    // Calculate weighted freq and gap
    const totalDigitCount = Array.from(digitStats.values()).reduce((sum, s) => sum + s.freq, 0);

    const details: StatDigitDetail[] = [];

    for (let d = 0; d < 10; d++) {
      const digit = String(d);
      const stat = digitStats.get(digit)!;
      const weightedFreq = totalDigitCount > 0 ? stat.freq / totalDigitCount : 0;

      // Calculate gap: number of periods since last appearance
      let gap: number;
      if (stat.lastPeriodIndex === null) {
        // Never appeared
        gap = totalPeriods;
      } else if (stat.lastPeriodIndex === totalPeriods - 1) {
        // Appeared in latest period
        gap = 0;
      } else {
        gap = totalPeriods - 1 - stat.lastPeriodIndex;
      }

      const overdueRatio = gap / EXPECTED_GAP;

      details.push({
        digit,
        freq: stat.freq,
        weightedFreq,
        gap,
        overdueRatio,
      });
    }

    result[pos] = details;
  }

  return result;
}

export function computeStatDigitPositionProbabilities(
  records: LotteryDrawRecord[],
): DigitPositionProbabilities {
  const detail = computeDigitGapAndOverdue(records);

  const normalize = (details: StatDigitDetail[]): number[] => {
    // Calculate raw scores
    const rawScores = details.map((d) => {
      const totalOverdue = details.reduce((sum, dt) => sum + dt.overdueRatio, 0);
      const normalizedOverdue = totalOverdue > 0 ? d.overdueRatio / totalOverdue : 0.1;
      return d.weightedFreq * 0.6 + normalizedOverdue * 0.4;
    });

    // Normalize to sum = 1
    const totalScore = rawScores.reduce((sum, s) => sum + s, 0);
    if (totalScore === 0) {
      return new Array(10).fill(0.1);
    }

    return rawScores.map((s) => s / totalScore);
  };

  return {
    hundreds: normalize(detail.hundreds),
    tens: normalize(detail.tens),
    units: normalize(detail.units),
  };
}

export function predictTopNumbersStats(
  records: LotteryDrawRecord[],
  topN: number = 10,
): StatNumberPrediction[] {
  if (records.length === 0) {
    throw new Error("Không có dữ liệu lịch sử để dự đoán (stats)");
  }

  const detail = computeDigitGapAndOverdue(records);

  // Get top 5 digits per position based on score
  const getTopDigits = (details: StatDigitDetail[]): StatDigitDetail[] => {
    const totalOverdue = details.reduce((sum, d) => sum + d.overdueRatio, 0);
    const scored = details.map((d) => {
      const normalizedOverdue = totalOverdue > 0 ? d.overdueRatio / totalOverdue : 0.1;
      const score = d.weightedFreq * 0.6 + normalizedOverdue * 0.4;
      return { ...d, score };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, 5);
  };

  const topHundreds = getTopDigits(detail.hundreds);
  const topTens = getTopDigits(detail.tens);
  const topUnits = getTopDigits(detail.units);

  // Calculate total overdue once before the loop — does not depend on h, t, u
  const totalOverdue = {
    hundreds: detail.hundreds.reduce((sum, d) => sum + d.overdueRatio, 0),
    tens: detail.tens.reduce((sum, d) => sum + d.overdueRatio, 0),
    units: detail.units.reduce((sum, d) => sum + d.overdueRatio, 0),
  };

  // Generate all combinations and score them
  const predictions = new Map<string, StatNumberPrediction>();

  for (const h of topHundreds) {
    for (const t of topTens) {
      for (const u of topUnits) {
        const number = h.digit + t.digit + u.digit;

        const hScore =
          h.weightedFreq * 0.6 +
          (totalOverdue.hundreds > 0 ? h.overdueRatio / totalOverdue.hundreds : 0.1) * 0.4;
        const tScore =
          t.weightedFreq * 0.6 +
          (totalOverdue.tens > 0 ? t.overdueRatio / totalOverdue.tens : 0.1) * 0.4;
        const uScore =
          u.weightedFreq * 0.6 +
          (totalOverdue.units > 0 ? u.overdueRatio / totalOverdue.units : 0.1) * 0.4;

        const confidence = hScore * 0.25 + tScore * 0.35 + uScore * 0.4;

        predictions.set(number, {
          number,
          confidence,
          hundredsDetail: h,
          tensDetail: t,
          unitsDetail: u,
        });
      }
    }
  }

  return Array.from(predictions.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topN);
}
