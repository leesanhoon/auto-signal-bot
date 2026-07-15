import type {
  CombinedAnalysisPlan,
  CombinedAnalysisPlanMatch,
  MatchAiAnalysis,
  MatchOddsPayload,
  MatchInfo,
} from "../model/betting-types.js";
import type { BettingAnalysisRepository } from "../repository/betting-analysis-repository.js";
import type { MatchRepository } from "../repository/match-repository.js";
import type { Notifier } from "../../shared/notifier.js";
import {
  formatCachedAnalysisMessage,
  formatCombinedAnalysisMessage,
  formatOddsText,
  sortMatchOddsByKickoff,
} from "../service/odds-text-format-service.js";
import { vnDateStr } from "../../shared/vn-time.js";
import { createLogger } from "../../shared/infra/logger.js";
import type { BettingApiClient } from "../client/betting-api-client.js";
import type { BettingService } from "../service/betting-service.js";

const logger = createLogger("betting:odds-runner");
const LABEL = "Match Odds";
const SKIP_CACHE =
  process.env.BETTING_SKIP_CACHE?.trim().toLowerCase() === "true";

function buildCombinedMatchAnalysis(
  match: CombinedAnalysisPlanMatch,
  summary: string,
): MatchAiAnalysis {
  return {
    match: match.matchLabel,
    handicapPick: match.handicapPick,
    totalGoalsPick: match.totalGoalsPick,
    picks: match.picks,
    predictedScore: match.predictedScore,
    note: match.note,
    summary,
    preferredScoreline: match.predictedScore.score,
    scoreConfidence: match.predictedScore.confidence,
    recommendation: match.picks.length > 0 ? "Có nhận định" : "Đứng ngoài",
    confidence: match.predictedScore.confidence,
    keyPoints: [],
    risks: [],
    verificationStatus: "skipped",
  };
}

export function createOddsApplication(deps: {
  bettingApiClient: Pick<BettingApiClient, "getConfiguredBookmaker" | "fetchLiveFixtures">;
  bettingService: Pick<BettingService, "extractMatches" | "pickNearestUpcomingMatches" | "buildOddsPayload">;
  aiClient: { generateCombinedAnalysis(payloads: MatchOddsPayload[]): Promise<CombinedAnalysisPlan | null> };
  bettingAnalysisRepository: Pick<BettingAnalysisRepository, "loadRecentSnapshotsByGameIds" | "saveBettingAnalysisSnapshot">;
  matchRepository: Pick<MatchRepository, "loadUpcomingMatches">;
  notifier: Notifier;
}) {
  async function saveCombinedAnalysisSnapshots(
    payloads: MatchOddsPayload[],
    plan: CombinedAnalysisPlan,
  ): Promise<void> {
    for (const match of plan.matches) {
      const payload = payloads[match.matchIndex];
      if (!payload) continue;

      const analysis = buildCombinedMatchAnalysis(match, plan.summary);
      try {
        await deps.bettingAnalysisRepository.saveBettingAnalysisSnapshot({
          gameId: payload.gameId,
          date: vnDateStr(payload.kickoffUnix * 1000),
          home: payload.home,
          away: payload.away,
          kickoffUnix: payload.kickoffUnix,
          odds: payload.odds,
          correctScore: payload.correctScore ?? null,
          analysis,
          verifiedConfirmed: null,
          verifiedConfidence: null,
          verifiedComment: null,
          revisedAfterReject: false,
        });
      } catch (saveError) {
        logger.warn(
          `  ⚠ Save failed for ${payload.home} vs ${payload.away}: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
        );
      }
    }
  }

  return {
    async run(): Promise<void> {
      logger.info(`🏆 ${LABEL} - Starting combined analysis...\n`);

      let matches: MatchInfo[] = [];
      let isLive = false;

      try {
        const liveFixtures = await deps.bettingApiClient.fetchLiveFixtures();
        const liveMatches = deps.bettingService.extractMatches(liveFixtures);
        if (liveMatches.length > 0) {
          matches = liveMatches;
          isLive = true;
          logger.info(`✓ ${liveMatches.length} trận đang LIVE\n`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`  ⚠ Không lấy được trận live (free plan hoặc lỗi): ${message}`);
      }

      if (matches.length === 0) {
        const allMatches = await deps.matchRepository.loadUpcomingMatches();
        matches = deps.bettingService.pickNearestUpcomingMatches(allMatches);
        isLive = false;
        if (matches.length > 0) {
          logger.info(`✓ ${matches.length} trận sắp tới (${matches[0].date} ${matches[0].kickoffTime})\n`);
        }
      }

      if (matches.length === 0) {
        await deps.notifier.sendMessage(`⏸ [${LABEL}] Không có trận nào (live hoặc sắp tới).`);
        return;
      }

      const bookmakerKey = deps.bettingApiClient.getConfiguredBookmaker();
      logger.info(`📊 Đọc và lấy toàn bộ market từ bookmaker "${bookmakerKey}" cho từng trận...`);
      const { payload, failures } = await deps.bettingService.buildOddsPayload(matches);
      if (failures.length > 0) {
        const failedList = failures
          .map((failure) => `• ${failure.match.home} vs ${failure.match.away}: ${failure.message}`)
          .join("\n");
        await deps.notifier.sendMessage(`⚠️ [${LABEL}] Lấy dữ liệu thất bại cho ${failures.length} trận (đã bỏ qua):\n${failedList}`);
      }

      if (payload.length === 0) {
        await deps.notifier.sendMessage(`⏸ [${LABEL}] ${matches.length} trận ngày ${matches[0].date}, nhưng không lấy được kèo trận nào.`);
        return;
      }

      const sortedPayload = sortMatchOddsByKickoff(payload);
      for (const match of sortedPayload) {
        await deps.notifier.sendMessage(formatOddsText(match));
      }

      const gameIds = sortedPayload.map((payloadItem) => payloadItem.gameId);
      if (SKIP_CACHE || isLive) {
        const reason = isLive ? "trận live" : "BETTING_SKIP_CACHE=true";
        logger.info(`⚙ Bỏ qua cache (${reason}) - luôn gọi AI mới`);
      } else {
        try {
          const cachedSnapshots = await deps.bettingAnalysisRepository.loadRecentSnapshotsByGameIds(
            gameIds,
            30 * 60 * 1000,
          );
          if (cachedSnapshots.length === gameIds.length) {
            logger.info("↻ Dùng lại phân tích đã cache trong 30 phút gần nhất, bỏ qua gọi AI");
            const cachedMessage = formatCachedAnalysisMessage(sortedPayload, cachedSnapshots);
            const fullMessage = ["📋 *PHÂN TÍCH TÀI/XỈU + TỈ SỐ (CACHE)*", cachedMessage.trim()]
              .filter(Boolean)
              .join("\n\n");
            await deps.notifier.sendMessage(fullMessage);
            logger.info(`\n✅ Đã phân tích xong ${sortedPayload.length} trận (cache).`);
            return;
          }
        } catch {
        }
      }

      let plan: CombinedAnalysisPlan | null = null;
      try {
        logger.info(`\n📤 Gửi combined analysis lên Telegram (${sortedPayload.length} trận)...`);
        plan = await deps.aiClient.generateCombinedAnalysis(sortedPayload);
      } catch (error) {
        logger.warn(`  ⚠ Combined analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!plan) {
        await deps.notifier.sendMessage("⚠️ AI không phân tích được. Đã gửi dữ liệu odds thô phía trên.");
        logger.info(`\n✅ Đã phân tích xong ${payload.length} trận (combined mode, fallback).`);
        return;
      }

      const combinedMessage = formatCombinedAnalysisMessage(sortedPayload, plan);
      if (combinedMessage.trim()) {
        const fullMessage = ["📋 *PHÂN TÍCH TÀI/XỈU + TỈ SỐ*", "", combinedMessage.trim()]
          .filter(Boolean)
          .join("\n\n");
        await deps.notifier.sendMessage(fullMessage);
      }

      await saveCombinedAnalysisSnapshots(sortedPayload, plan);

      logger.info(`\n✅ Đã phân tích xong ${payload.length} trận (combined mode).`);
    },
  };
}

export type OddsApplication = ReturnType<typeof createOddsApplication>;
