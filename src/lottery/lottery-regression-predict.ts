import { extractNums } from "./lottery-format.js";
import type { LotteryDrawRecord } from "./lottery-types.js";
import { linearRegression, linearRegressionLine, rSquared } from "simple-statistics";

export type DigitPositionProbabilities = {
  hundreds: number[];
  tens: number[];
  units: number[];
};

export type RegressionDigitDetail = {
  digit: string;
  slope: number;
  predictedRatio: number;
  rSquared: number;
};

export type RegressionNumberPrediction = {
  number: string;
  confidence: number;
  hundredsDetail: RegressionDigitDetail;
  tensDetail: RegressionDigitDetail;
  unitsDetail: RegressionDigitDetail;
};

export function computeRegressionDigitDetails(
  records: LotteryDrawRecord[],
): {
  hundreds: RegressionDigitDetail[];
  tens: RegressionDigitDetail[];
  units: RegressionDigitDetail[];
} {
  // Sort records by date and group by unique dates
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));

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

  if (totalPeriods < 3) {
    // Fallback: calculate average ratio for each digit
    return getFallbackDetails(periods, periodMap, totalPeriods);
  }

  const positions: Array<"hundreds" | "tens" | "units"> = ["hundreds", "tens", "units"];
  const positionIndex: Record<string, number> = { hundreds: 0, tens: 1, units: 2 };

  const result: {
    hundreds: RegressionDigitDetail[];
    tens: RegressionDigitDetail[];
    units: RegressionDigitDetail[];
  } = {
    hundreds: [],
    tens: [],
    units: [],
  };

  for (const pos of positions) {
    const idx = positionIndex[pos];
    const digitRatios = new Map<string, number[]>(); // digit -> [ratio per period]

    // Initialize for digits 0-9
    for (let d = 0; d < 10; d++) {
      digitRatios.set(String(d), []);
    }

    // Calculate ratio for each digit in each period
    for (let periodIdx = 0; periodIdx < periods.length; periodIdx++) {
      const period = periods[periodIdx]!;
      const recordsInPeriod = periodMap.get(period)!;

      const digitCounts = new Map<string, number>();
      let totalInPeriod = 0;

      for (let d = 0; d < 10; d++) {
        digitCounts.set(String(d), 0);
      }

      for (const record of recordsInPeriod) {
        for (const num of extractNums(record.prizes)) {
          if (num.length < 3) continue;
          const digit = num[idx]!;
          digitCounts.set(digit, (digitCounts.get(digit) || 0) + 1);
          totalInPeriod++;
        }
      }

      // Store ratio for each digit
      for (let d = 0; d < 10; d++) {
        const digit = String(d);
        const count = digitCounts.get(digit) || 0;
        const ratio = totalInPeriod > 0 ? count / totalInPeriod : 0;
        digitRatios.get(digit)!.push(ratio);
      }
    }

    // Perform linear regression for each digit
    const details: RegressionDigitDetail[] = [];

    for (let d = 0; d < 10; d++) {
      const digit = String(d);
      const ratios = digitRatios.get(digit)!;

      // Build points: [periodIndex, ratio]
      const points: Array<[number, number]> = ratios.map((ratio, idx) => [idx, ratio]);

      // Linear regression: y = m*x + b
      const { m: slope, b: intercept } = linearRegression(points);
      const regressionLine = linearRegressionLine({ m: slope, b: intercept });

      // R² đo mức độ regression giải thích được biến thiên thực tế. Với dữ liệu gần-uniform
      // (tỉ lệ mỗi digit dao động quanh 0.1), slope phần lớn chỉ là nhiễu — không gate sẽ
      // ngoại suy từ 1 xu hướng không có thật. Ngưỡng 0.5: chỉ tin slope khi regression giải
      // thích được từ 50% phương sai trở lên.
      const r2 = rSquared(points, regressionLine);
      const trustsSlope = Number.isFinite(r2) && r2 >= 0.5;

      let predictedRatio: number;
      if (trustsSlope) {
        const nextPeriodIndex = totalPeriods;
        predictedRatio = Math.max(0, Math.min(1, slope * nextPeriodIndex + intercept));
      } else {
        // Fallback: trung bình lịch sử của digit này (không ngoại suy khi regression yếu).
        predictedRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
      }

      details.push({
        digit,
        slope,
        predictedRatio,
        rSquared: Number.isFinite(r2) ? r2 : 0,
      });
    }

    result[pos] = details;
  }

  return result;
}

function getFallbackDetails(
  periods: string[],
  periodMap: Map<string, LotteryDrawRecord[]>,
  totalPeriods: number,
): {
  hundreds: RegressionDigitDetail[];
  tens: RegressionDigitDetail[];
  units: RegressionDigitDetail[];
} {
  const positions: Array<"hundreds" | "tens" | "units"> = ["hundreds", "tens", "units"];
  const positionIndex: Record<string, number> = { hundreds: 0, tens: 1, units: 2 };

  const result: {
    hundreds: RegressionDigitDetail[];
    tens: RegressionDigitDetail[];
    units: RegressionDigitDetail[];
  } = {
    hundreds: [],
    tens: [],
    units: [],
  };

  for (const pos of positions) {
    const idx = positionIndex[pos];
    const digitCounts = new Map<string, number>();
    let totalCount = 0;

    // Initialize
    for (let d = 0; d < 10; d++) {
      digitCounts.set(String(d), 0);
    }

    // Count across all periods
    for (const period of periods) {
      const recordsInPeriod = periodMap.get(period)!;
      for (const record of recordsInPeriod) {
        for (const num of extractNums(record.prizes)) {
          if (num.length < 3) continue;
          const digit = num[idx]!;
          digitCounts.set(digit, (digitCounts.get(digit) || 0) + 1);
          totalCount++;
        }
      }
    }

    const details: RegressionDigitDetail[] = [];
    for (let d = 0; d < 10; d++) {
      const digit = String(d);
      const count = digitCounts.get(digit) || 0;
      const avgRatio = totalCount > 0 ? count / totalCount : 0;

      details.push({
        digit,
        slope: 0,
        predictedRatio: avgRatio,
        rSquared: 1,
      });
    }

    result[pos] = details;
  }

  return result;
}

export function computeRegressionDigitPositionProbabilities(
  records: LotteryDrawRecord[],
): DigitPositionProbabilities {
  const detail = computeRegressionDigitDetails(records);

  const normalize = (details: RegressionDigitDetail[]): number[] => {
    const ratios = details.map((d) => d.predictedRatio);
    const totalRatio = ratios.reduce((sum, r) => sum + r, 0);

    if (totalRatio === 0) {
      return new Array(10).fill(0.1);
    }

    return ratios.map((r) => r / totalRatio);
  };

  return {
    hundreds: normalize(detail.hundreds),
    tens: normalize(detail.tens),
    units: normalize(detail.units),
  };
}

export function predictTopNumbersRegression(
  records: LotteryDrawRecord[],
  topN: number = 10,
): RegressionNumberPrediction[] {
  if (records.length === 0) {
    throw new Error("Không có dữ liệu lịch sử để dự đoán (regression)");
  }

  const detail = computeRegressionDigitDetails(records);

  // Get top 5 digits per position based on predicted ratio
  const getTopDigits = (details: RegressionDigitDetail[]): RegressionDigitDetail[] => {
    return [...details].sort((a, b) => b.predictedRatio - a.predictedRatio).slice(0, 5);
  };

  const topHundreds = getTopDigits(detail.hundreds);
  const topTens = getTopDigits(detail.tens);
  const topUnits = getTopDigits(detail.units);

  // Generate all combinations
  const predictions = new Map<string, RegressionNumberPrediction>();

  for (const h of topHundreds) {
    for (const t of topTens) {
      for (const u of topUnits) {
        const number = h.digit + t.digit + u.digit;

        const confidence = h.predictedRatio * 0.25 + t.predictedRatio * 0.35 + u.predictedRatio * 0.4;

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
