import "../shared/infra/env.js";
import { runLotteryCheck } from "./lottery-runner.js";
import { notifyError } from "../shared/notification/telegram-client.js";
import { createLogger } from "../shared/infra/logger.js";

const logger = createLogger("lottery:lottery-index");
runLotteryCheck().catch(async (error) => {
  logger.error("Fatal error:", error);
  await notifyError("Lottery History Scanner", error);
  process.exit(1);
});

