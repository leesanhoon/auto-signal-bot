import "../shared/infra/env.js";
import { runLotteryBackfill } from "./lottery-backfill-runner.js";
import { notifyError } from "../shared/notification/telegram-client.js";
import { createLogger } from "../shared/infra/logger.js";

const logger = createLogger("lottery:lottery-backfill-index");
const days = Number(process.argv[2] ?? process.env.LOTTERY_BACKFILL_DAYS ?? "365");

runLotteryBackfill(days).catch(async (error) => {
  logger.error("Fatal error:", error);
  await notifyError("Lottery Backfill", error);
  process.exit(1);
});

