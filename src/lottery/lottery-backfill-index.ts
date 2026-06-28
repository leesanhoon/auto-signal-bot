import "../shared/env.js";
import { runLotteryBackfill } from "./lottery-backfill-runner.js";
import { notifyError } from "../shared/telegram.js";

const days = Number(process.argv[2] ?? process.env.LOTTERY_BACKFILL_DAYS ?? "365");

runLotteryBackfill(days).catch(async (error) => {
  console.error("Fatal error:", error);
  await notifyError("Lottery Backfill", error);
  process.exit(1);
});
