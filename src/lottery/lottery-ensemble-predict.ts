import type { LotteryDrawRecord, LotteryRegion } from "./model/lottery-types.js";
import type { StatNumberPrediction } from "./lottery-stats-predict.js";
import { predictTopNumbersStats } from "./lottery-stats-predict.js";
import type { RegressionNumberPrediction } from "./lottery-regression-predict.js";
import { predictTopNumbersRegression } from "./lottery-regression-predict.js";
import { createLogger } from "../shared/infra/logger.js";

const logger = createLogger("lottery-ensemble");

const INTERNAL_CANDIDATE_POOL_SIZE = 15;

export const ENSEMBLE_METHOD_VERSION = "ensemble-algorithm-v1";

export const ENSEMBLE_WEIGHTS = {
  stats: 0.55,
  regression: 0.45,
} as const;

export type MethodBreakdown = {
  stats?: number;
  regression?: number;
};

export type EnsembleNumberPrediction = {
  number: string;
  confidence: number;
  reason: string;
  breakdown: MethodBreakdown;
};

export async function predictTopNumbersEnsemble(
  records: LotteryDrawRecord[],
  region: LotteryRegion,
  weekday: number,
  topN: number = 10,
): Promise<EnsembleNumberPrediction[]> {
  if (records.length === 0) {
    throw new Error("Không có dữ liệu lịch sử để dự đoán");
  }

  // Use larger internal pool to capture more candidates from each sub-predictor
  const poolSize = Math.max(topN * 5, INTERNAL_CANDIDATE_POOL_SIZE);

  // Use deterministic predictors only
  let statsResults: StatNumberPrediction[] | null = null;
  let regressionResults: RegressionNumberPrediction[] | null = null;

  try {
    statsResults = predictTopNumbersStats(records, poolSize);
  } catch (error) {
    logger.warn(
      `Stats predictor failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    regressionResults = predictTopNumbersRegression(records, poolSize);
  } catch (error) {
    logger.warn(
      `Regression predictor failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!statsResults && !regressionResults) {
    throw new Error("Ensemble: cả 2 phương pháp đều không tạo được dự đoán");
  }

  const candidateMap = new Map<
    string,
    {
      breakdown: MethodBreakdown;
      reasons: string[];
    }
  >();

  if (statsResults) {
    for (const pred of statsResults) {
      const existing = candidateMap.get(pred.number) || { breakdown: {}, reasons: [] };
      existing.breakdown.stats = pred.confidence;
      existing.reasons.push("Thống kê tần suất");
      candidateMap.set(pred.number, existing);
    }
  }

  if (regressionResults) {
    for (const pred of regressionResults) {
      const existing = candidateMap.get(pred.number) || { breakdown: {}, reasons: [] };
      existing.breakdown.regression = pred.confidence;
      existing.reasons.push("Xu hướng hồi quy tuyến tính");
      candidateMap.set(pred.number, existing);
    }
  }

  if (candidateMap.size === 0) {
    throw new Error("Ensemble: không có candidate number nào từ các phương pháp");
  }

  const predictions: EnsembleNumberPrediction[] = [];

  for (const [number, { breakdown, reasons }] of Array.from(candidateMap.entries())) {
    const activeWeights = {
      stats: breakdown.stats !== undefined ? ENSEMBLE_WEIGHTS.stats : 0,
      regression: breakdown.regression !== undefined ? ENSEMBLE_WEIGHTS.regression : 0,
    };

    const totalWeight = activeWeights.stats + activeWeights.regression;
    if (totalWeight === 0) continue;

    let finalScore = 0;
    if (breakdown.stats !== undefined) {
      finalScore += (breakdown.stats * activeWeights.stats) / totalWeight;
    }
    if (breakdown.regression !== undefined) {
      finalScore += (breakdown.regression * activeWeights.regression) / totalWeight;
    }

    predictions.push({
      number,
      confidence: finalScore,
      reason: reasons.length > 0 ? reasons.join("; ") : "Dự đoán từ ensemble thuật toán",
      breakdown,
    });
  }

  return predictions
    .sort(
      (a, b) => b.confidence - a.confidence || a.number.localeCompare(b.number),
    )
    .slice(0, topN);
}
