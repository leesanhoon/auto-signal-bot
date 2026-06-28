import "../shared/env.js";
import { runLotteryCheck } from "./lottery-runner.js";
import { notifyError } from "../shared/telegram.js";

runLotteryCheck().catch(async (error) => {
  console.error("Fatal error:", error);
  await notifyError("Lottery History Scanner", error);
  process.exit(1);
});
