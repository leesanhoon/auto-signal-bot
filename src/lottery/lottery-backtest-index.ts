#!/usr/bin/env node
import "../shared/infra/env.js";
import { createLogger } from "../shared/infra/logger.js";
import { compareBacktestSummaries, runBacktest, type BacktestMethod, type BacktestSummary } from "./service/lottery-backtest.js";
import { loadRegionHistory } from "./repository/lottery-repository.js";
import type { LotteryRegion } from "./model/lottery-types.js";

const logger = createLogger("lottery:lottery-backtest-index");
const VALID_REGIONS: LotteryRegion[] = ["mien-bac", "mien-trung", "mien-nam"];
const METHODS: BacktestMethod[] = ["stats", "regression", "ensemble", "random-baseline"];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const TOP_N = 3;
const MIN_TRAINING_PERIODS = 10;

function aggregateBacktestSummaries(summaries: BacktestSummary[], topN: number): BacktestSummary {
  const [firstSummary] = summaries;
  if (!firstSummary) {
    throw new Error("aggregateBacktestSummaries requires at least one summary");
  }

  const periods = summaries.flatMap((summary) => summary.periods);
  const totalHits = summaries.reduce((sum, summary) => sum + summary.totalHits, 0);
  const totalHits2 = summaries.reduce((sum, summary) => sum + summary.totalHits2, 0);
  const periodsEvaluated = summaries.reduce((sum, summary) => sum + summary.periodsEvaluated, 0);
  const totalPredictions = periodsEvaluated * topN;

  return {
    method: firstSummary.method,
    region: firstSummary.region,
    periodsEvaluated,
    totalPredictions,
    totalHits,
    hitRate: totalPredictions > 0 ? totalHits / totalPredictions : 0,
    totalHits2,
    hitRate2: totalPredictions > 0 ? totalHits2 / totalPredictions : 0,
    periods,
  };
}

async function runRegionBacktests(region: LotteryRegion): Promise<BacktestSummary[]> {
  const history = await loadRegionHistory(region);
  if (history.length === 0) {
    logger.warn(`No history found for region ${region}.`);
    return [];
  }

  const summaries: BacktestSummary[] = [];

  for (const method of METHODS) {
    const weekdaySummaries = await Promise.all(
      WEEKDAYS.map((weekday) =>
        runBacktest(history, region, weekday, method, TOP_N, MIN_TRAINING_PERIODS),
      ),
    );
    summaries.push(aggregateBacktestSummaries(weekdaySummaries, TOP_N));
  }

  return summaries;
}

async function main(): Promise<void> {
  const regionEnv = process.env.LOTTERY_PREDICT_REGION;
  const regions = (() => {
    if (!regionEnv) return VALID_REGIONS;
    const trimmed = regionEnv.trim() as LotteryRegion;
    if (!VALID_REGIONS.includes(trimmed)) {
      throw new Error(
        `Invalid LOTTERY_PREDICT_REGION="${regionEnv}". Must be one of: ${VALID_REGIONS.join(", ")}`,
      );
    }
    return [trimmed];
  })();

  for (const region of regions) {
    const summaries = await runRegionBacktests(region);
    if (summaries.length === 0) {
      logger.info(`Region ${region}: no summaries generated.`);
      continue;
    }
    logger.info(`Backtest summary for ${region}\n${compareBacktestSummaries(summaries)}`);
  }
}

main().catch((error) => {
  logger.error("Fatal error:", error);
  process.exit(1);
});
