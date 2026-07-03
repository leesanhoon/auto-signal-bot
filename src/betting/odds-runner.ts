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
import { saveBettingAnalysisSnapshot } from "./betting-analysis-repository.js";
import { loadUpcomingMatches } from "./match-repository.js";
import {
  formatBettingPlanMessage,
  formatOddsText,
  formatPicksSummaryBlock,
  sortMatchOddsByKickoff,
} from "./odds-text-format.js";
import { createLogger } from "../shared/logger.js";
import { vnDateStr } from "../shared/vn-time.js";

const logger = createLogger("betting:odds-runner");
const LABEL = "Match Odds";

function buildCombinedMatchAnalysis(
  payload: MatchOddsPayload,
  match: CombinedAnalysisPlanMatch,
): MatchAiAnalysis {
  const topPicks = Array.isArray(match.topPicks) ? match.topPicks : [];
  const keyPoints = Array.isArray(match.keyPoints) ? match.keyPoints.slice(0, 2) : [];
  const risks = Array.isArray(match.risks) ? match.risks.slice(0, 2) : [];

  return {
    match: match.matchLabel,
    preferredScoreline: match.preferredScoreline,
    scoreConfidence: match.scoreConfidence,
    recommendation: match.analysis,
    confidence: Math.max(0, Math.min(100, match.scoreConfidence)),
    picks: topPicks.map((pick) => ({
      market: pick.market,
      selection: pick.selection,
      odds: pick.odds,
      reason: pick.reason,
      suitability: pick.suitability as "parlay" | "single" | "both" | undefined,
    })),
    keyPoints,
    risks,
    summary: match.analysis,
    verificationStatus: "skipped",
  };
}

function buildCombinedAnalysisMessage(
  payloads: MatchOddsPayload[],
  plan: CombinedAnalysisPlan,
): string {
  const sections: string[] = [];
  sections.push(`💡 *Tổng quan:* ${plan.summary || "Không có tóm tắt."}`);
  sections.push(formatPicksSummaryBlock(payloads, plan));

  return sections.join("\n\n");
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

  let plan: CombinedAnalysisPlan | null = null;
  try {
    logger.info(`\n📤 Gui combined analysis len Telegram (${payload.length} tran)...`);
    plan = await generateCombinedAnalysis(payload);
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

  // Gộp analysis + plan thành 1 message
  const combinedMessage = buildCombinedAnalysisMessage(payload, plan);
  const planBlock = formatBettingPlanMessage(plan);
  if (combinedMessage.trim() || planBlock.trim()) {
    const fullMessage = [
      "📋 *PHÂN TÍCH + KẾ HOẠCH ĐẶT CƯỢC*",
      "",
      combinedMessage.trim(),
      "═══════════════════════",
      planBlock.trim(),
    ].filter(Boolean).join("\n\n");
    await sendMessage(fullMessage);
  }

  await saveCombinedAnalysisSnapshots(payload, plan);
  logger.info(`\n✅ Da phan tich xong ${payload.length} tran (combined mode).`);
}
