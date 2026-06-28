import "../shared/env.js";
import { runOddsCheck } from "./odds-runner.js";
import { notifyError } from "../shared/telegram.js";

const WINDOW_MINUTES = 24 * 60;

runOddsCheck({ windowMinutes: WINDOW_MINUTES, stage: "periodic", label: "Periodic Odds (trong 24h tới)" }).catch(
  async (error) => {
    console.error("Fatal error:", error);
    await notifyError("Periodic Odds Scanner", error);
    process.exit(1);
  },
);
