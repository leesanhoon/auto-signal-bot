import type { LotteryDrawRecord, LotteryRegion } from "./lottery-types.js";
import type { AiNumberPrediction } from "./lottery-ai-predict.js";
import { predictTopNumbersAI } from "./lottery-ai-predict.js";
import type { StatNumberPrediction } from "./lottery-stats-predict.js";
import { predictTopNumbersStats } from "./lottery-stats-predict.js";
import type { RegressionNumberPrediction } from "./lottery-regression-predict.js";
import { predictTopNumbersRegression } from "./lottery-regression-predict.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("lottery-ensemble");

const INTERNAL_CANDIDATE_POOL_SIZE = 15;

export const ENSEMBLE_METHOD_VERSION = "ensemble-v1";

export const ENSEMBLE_WEIGHTS = {
  ai: 0.4,
  stats: 0.3,
  regression: 0.3,
} as const;

export type MethodBreakdown = {
  ai?: number;
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

  // Call all 3 predictors with error handling
  let aiResults: AiNumberPrediction[] | null = null;
  let statsResults: StatNumberPrediction[] | null = null;
  let regressionResults: RegressionNumberPrediction[] | null = null;

  // Try AI (async)
  try {
    aiResults = await predictTopNumbersAI(records, region, weekday, poolSize);
  } catch (error) {
    logger.warn(
      `AI predictor failed (will continue with stats+regression): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Try stats (sync)
  try {
    statsResults = predictTopNumbersStats(records, poolSize);
  } catch (error) {
    logger.warn(
      `Stats predictor failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Try regression (sync)
  try {
    regressionResults = predictTopNumbersRegression(records, poolSize);
  } catch (error) {
    logger.warn(
      `Regression predictor failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // If all failed, throw
  if (!aiResults && !statsResults && !regressionResults) {
    throw new Error("Ensemble: cả 3 phương pháp đều không tạo được dự đoán");
  }

  // Build map of number -> breakdown + reason
  const candidateMap = new Map<
    string,
    {
      breakdown: MethodBreakdown;
      aiReason?: string;
    }
  >();

  // Populate from AI
  if (aiResults) {
    for (const pred of aiResults) {
      const existing = candidateMap.get(pred.number) || {
        breakdown: {},
        aiReason: pred.reason,
      };
      existing.breakdown.ai = pred.confidence;
      if (pred.reason) {
        existing.aiReason = pred.reason;
      }
      candidateMap.set(pred.number, existing);
    }
  }

  // Populate from stats
  if (statsResults) {
    for (const pred of statsResults) {
      const existing = candidateMap.get(pred.number) || { breakdown: {} };
      existing.breakdown.stats = pred.confidence;
      candidateMap.set(pred.number, existing);
    }
  }

  // Populate from regression
  if (regressionResults) {
    for (const pred of regressionResults) {
      const existing = candidateMap.get(pred.number) || { breakdown: {} };
      existing.breakdown.regression = pred.confidence;
      candidateMap.set(pred.number, existing);
    }
  }

  if (candidateMap.size === 0) {
    throw new Error(
      "Ensemble: không có candidate number nào từ các phương pháp",
    );
  }

  // Calculate final scores
  const predictions: EnsembleNumberPrediction[] = [];

  for (const [number, { breakdown, aiReason }] of candidateMap) {
    // Renormalize weights based on which methods contributed to this number
    const activeWeights = {
      ai: breakdown.ai !== undefined ? ENSEMBLE_WEIGHTS.ai : 0,
      stats: breakdown.stats !== undefined ? ENSEMBLE_WEIGHTS.stats : 0,
      regression:
        breakdown.regression !== undefined ? ENSEMBLE_WEIGHTS.regression : 0,
    };

    const totalWeight =
      activeWeights.ai + activeWeights.stats + activeWeights.regression;

    if (totalWeight === 0) {
      continue; // Should not happen
    }

    // Final score = weighted average
    let finalScore = 0;
    if (breakdown.ai !== undefined) {
      finalScore += (breakdown.ai * activeWeights.ai) / totalWeight;
    }
    if (breakdown.stats !== undefined) {
      finalScore += (breakdown.stats * activeWeights.stats) / totalWeight;
    }
    if (breakdown.regression !== undefined) {
      finalScore +=
        (breakdown.regression * activeWeights.regression) / totalWeight;
    }

    // Build reason with list of contributing methods
    const reasonParts: string[] = [];
    if (aiReason) {
      reasonParts.push(`AI: ${aiReason}`);
    }
    if (breakdown.stats !== undefined) {
      reasonParts.push("tần suất thống kê");
    }
    if (breakdown.regression !== undefined) {
      reasonParts.push("xu hướng hồi quy tuyến tính");
    }
    const reason =
      reasonParts.length > 0 ? reasonParts.join("; ") : "Dự đoán từ ensemble";

    predictions.push({
      number,
      confidence: finalScore,
      reason,
      breakdown,
    });
  }

  // Sort by confidence descending, deduplicate, return topN
  return predictions
    .sort(
      (a, b) => b.confidence - a.confidence || a.number.localeCompare(b.number),
    )
    .slice(0, topN);
}
