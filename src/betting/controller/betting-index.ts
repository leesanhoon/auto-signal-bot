import "../../shared/env.js";
import { createOddsApplication } from "../application/odds-application.js";
import { createBettingApiClient } from "../client/betting-api-client.js";
import * as bettingAiClient from "../client/betting-ai-client.js";
import { getDb } from "../../shared/db.js";
import { createBettingAnalysisRepository } from "../repository/betting-analysis-repository.js";
import { createMatchRepository } from "../repository/match-repository.js";
import { createBettingService } from "../service/betting-service.js";
import { notifyError } from "../../shared/telegram.js";
import { createLogger } from "../../shared/logger.js";
import { createTelegramNotifier } from "../../shared/notifier.js";

const logger = createLogger("betting:betting-index");

const db = getDb();
const bettingApiClient = createBettingApiClient();
const app = createOddsApplication({
  bettingApiClient,
  bettingService: createBettingService({ bettingApiClient }),
  aiClient: { generateCombinedAnalysis: bettingAiClient.generateCombinedAnalysis },
  bettingAnalysisRepository: createBettingAnalysisRepository(db),
  matchRepository: createMatchRepository(db),
  notifier: createTelegramNotifier(),
});

app.run().catch(async (error) => {
  logger.error("Fatal error:", error);
  await notifyError("Match Odds Scanner", error);
  process.exit(1);
});
