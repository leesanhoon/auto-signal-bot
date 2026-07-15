import "../shared/infra/env.js";
import { runLotteryPredict } from "./lottery-predict-runner.js";
import { notifyError } from "../shared/notification/telegram-client.js";
import { createLogger } from "../shared/infra/logger.js";
import type { LotteryRegion } from "./model/lottery-types.js";

const logger = createLogger("lottery:lottery-predict-index");

const VALID_REGIONS: LotteryRegion[] = ["mien-bac", "mien-trung", "mien-nam"];

const regionEnv = process.env.LOTTERY_PREDICT_REGION;
if (regionEnv) {
  const trimmed = regionEnv.trim() as LotteryRegion;
  if (!VALID_REGIONS.includes(trimmed)) {
    throw new Error(
      `Invalid LOTTERY_PREDICT_REGION="${regionEnv}". Must be one of: ${VALID_REGIONS.join(", ")}`,
    );
  }
  logger.info(`LOTTERY_PREDICT_REGION=${trimmed} — chỉ dự đoán miền này.`);
  runLotteryPredict([trimmed]).catch(async (error) => {
    logger.error("Fatal error:", error);
    await notifyError("Lottery Predictor", error);
    process.exit(1);
  });
} else {
  runLotteryPredict().catch(async (error) => {
    logger.error("Fatal error:", error);
    await notifyError("Lottery Predictor", error);
    process.exit(1);
  });
}