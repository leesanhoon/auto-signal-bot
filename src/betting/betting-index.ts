import "../shared/env.js";
import { runOddsCheck } from "./odds-runner.js";
import { notifyError } from "../shared/telegram.js";

const WINDOW_MINUTES = 30;

runOddsCheck({ windowMinutes: WINDOW_MINUTES, stage: "final", label: "Final Odds (trước kickoff)" }).catch(
  async (error) => {
    console.error("Fatal error:", error);
    await notifyError("Match Odds Scanner", error);
    process.exit(1);
  },
);
