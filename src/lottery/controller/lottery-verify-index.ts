import "../../shared/infra/env.js";
import { runLotteryVerify } from "./lottery-verify-runner.js";
import { notifyError } from "../../shared/notification/telegram-client.js";
import type { LotteryRegion } from "../model/lottery-types.js";
import { createLogger } from "../../shared/infra/logger.js";

const logger = createLogger("lottery:lottery-verify-index");
const region = process.argv[2] as LotteryRegion | undefined;
const VALID_REGIONS: LotteryRegion[] = ["mien-bac", "mien-trung", "mien-nam"];

if (!region || !VALID_REGIONS.includes(region)) {
  logger.error(`Usage: lottery-verify <${VALID_REGIONS.join("|")}>`);
  process.exit(1);
}

runLotteryVerify(region).catch(async (error) => {
  logger.error("Fatal error:", error);
  await notifyError(`Lottery Verify ${region}`, error);
  process.exit(1);
});

