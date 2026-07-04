import { sendMessage } from "../shared/telegram.js";
import { getConfiguredBookmaker } from "./betting-api.js";
import type {
  CombinedAnalysisPlan,
  CombinedAnalysisPlanMatch,
  MatchAiAnalysis,
  MatchOddsPayload,
} from "./betting-types.js";
import { buildOddsPayload, pickNearestUpcomingDateMatches } from "./betting.js";
import { generateCombinedAnalysis } from "./betting-gemini.js";
import {
  loadRecentSnapshotsByGameIds,
  saveBettingAnalysisSnapshot,
} from "./betting-analysis-repository.js";
import { loadUpcomingMatches } from "./match-repository.js";
import {
  formatCachedAnalysisMessage,
  formatOddsText,
  formatCombinedAnalysisMessage,
  sortMatchOddsByKickoff,
} from "./odds-text-format.js";
import { createLogger } from "../shared/logger.js";
import { vnDateStr } from "../shared/vn-time.js";

const logger = createLogger("betting:odds-runner");
const LABEL = "Match Odds";
const SKIP_CACHE = process.env.BETTING_SKIP_CACHE?.trim().toLowerCase() === "true";

function buildCombinedMatchAnalysis(
  payload: MatchOddsPayload,
  match: CombinedAnalysisPlanMatch,
): MatchAiAnalysis {
  return {
    match: match.matchLabel,
    totalGoalsPick: match.totalGoalsPick,
    predictedScore: match.predictedScore,
    note: match.note,
    summary: "",
    // Backward compat fields for betting-backtest
    preferredScoreline: match.predictedScore.score,
    scoreConfidence: match.predictedScore.confidence,
    recommendation: match.totalGoalsPick ? "Có nhận định" : "Đứng ngoài",
    confidence: match.predictedScore.confidence,
    picks: match.totalGoalsPick
      ? [
          {
            market: match.totalGoalsPick.market,
            selection: match.totalGoalsPick.selection,
            odds: match.totalGoalsPick.odds,
            reason: match.totalGoalsPick.reason,
          },
        ]
      : [],
    keyPoints: [],
    risks: [],
    verificationStatus: "skipped",
  };
}

async function saveCombinedAnalysisSnapshots(
  payloads: MatchOddsPayload[],
  plan: CombinedAnalysisPlan,
): Promise<void> {
  for (const match of plan.matches) {
    const payload = payloads[match.matchIndex];
    if (!payload) continue;

    const analysis = buildCombinedMatchAnalysis(payload, match);
    try {
      await saveBettingAnalysisSnapshot({
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

export async function runOddsCheck(): Promise<void> {
  logger.info(`🏆 ${LABEL} - Starting combined analysis...\n`);

  const matches = pickNearestUpcomingDateMatches(await loadUpcomingMatches());
  logger.info(`✓ ${matches.length} tran chua da cua ngay gan nhat (${matches[0]?.date ?? "-"})\n`);
  if (matches.length === 0) {
    await sendMessage(`⏸ [${LABEL}] Không có trận nào sắp tới trong DB — hãy chạy lại fetch-matches-list.`);
    return;
  }

  const bookmakerKey = getConfiguredBookmaker();
  logger.info(`📊 Do + lay TOAN BO market tu bookmaker "${bookmakerKey}" cho tung tran...`);
  const { payload, failures } = await buildOddsPayload(matches);
  if (failures.length > 0) {
    const failedList = failures
      .map((failure) => `• ${failure.match.home} vs ${failure.match.away}: ${failure.message}`)
      .join("\n");
    await sendMessage(`⚠️ [${LABEL}] Lấy dữ liệu thất bại cho ${failures.length} trận (đã bỏ qua):\n${failedList}`);
  }

  if (payload.length === 0) {
    await sendMessage(`⏸ [${LABEL}] ${matches.length} trận ngày ${matches[0].date}, nhưng không lấy được kèo trận nào.`);
    return;
  }

  const sortedPayload = sortMatchOddsByKickoff(payload);
  for (const match of sortedPayload) {
    await sendMessage(formatOddsText(match));
  }

  // Kiểm tra cache 30 phút trước khi gọi AI
  let plan: CombinedAnalysisPlan | null = null;
  const gameIds = sortedPayload.map((p) => p.gameId);
  const dateStr = vnDateStr(Date.now());
  if (SKIP_CACHE) {
    logger.info("⚙ BETTING_SKIP_CACHE=true — bỏ qua cache, luôn gọi AI mới");
  } else {
    try {
      const cachedSnapshots = await loadRecentSnapshotsByGameIds(gameIds, 30 * 60 * 1000);
      if (cachedSnapshots.length === gameIds.length) {
        logger.info("↻ Dùng lại phân tích đã cache trong 30 phút gần nhất, bỏ qua gọi AI");
        const cachedMessage = formatCachedAnalysisMessage(sortedPayload, cachedSnapshots);
        const fullMessage = [
          "📋 *PHÂN TÍCH TÀI/XỈU + TỈ SỐ (CACHE)*",
          "",
          cachedMessage.trim(),
        ]
          .filter(Boolean)
          .join("\n\n");
        await sendMessage(fullMessage);
        logger.info(`\n✅ Da phan tich xong ${sortedPayload.length} tran (cache).`);
        return;
      }
    } catch {
      // Lỗi khi đọc cache — coi như cache miss, fallback về gọi AI
    }
  }

  try {
    logger.info(`\n📤 Gui combined analysis len Telegram (${sortedPayload.length} tran)...`);
    plan = await generateCombinedAnalysis(sortedPayload);
  } catch (error) {
    logger.warn(
      `  ⚠ Combined analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!plan) {
    await sendMessage("⚠️ AI không phân tích được. Đã gửi dữ liệu odds thô phía trên.");
    logger.info(`\n✅ Da phan tich xong ${payload.length} tran (combined mode, fallback).`);
    return;
  }

  // Gộp analysis thành 1 message
  const combinedMessage = formatCombinedAnalysisMessage(sortedPayload, plan);
  if (combinedMessage.trim()) {
    const fullMessage = [
      "📋 *PHÂN TÍCH TÀI/XỈU + TỈ SỐ*",
      "",
      combinedMessage.trim(),
    ].filter(Boolean).join("\n\n");
    await sendMessage(fullMessage);
  }

  await saveCombinedAnalysisSnapshots(sortedPayload, plan);

  logger.info(`\n✅ Da phan tich xong ${payload.length} tran (combined mode).`);
}
