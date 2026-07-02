import { sendMessage } from "../shared/telegram.js";
import { getConfiguredBookmaker } from "./betting-api.js";
import type { MatchAiAnalysis, MatchOddsPayload } from "./betting-types.js";
import { buildOddsPayload, pickNearestUpcomingDateMatches } from "./betting.js";
import {
  analyzeMatchOdds,
  isStandAsideAnalysis,
  reviseMatchAnalysis,
  verifyMatchAnalysis,
  type VerificationReasonCode,
} from "./betting-gemini.js";
import { saveBettingAnalysisSnapshot } from "./betting-analysis-repository.js";
import { loadUpcomingMatches } from "./match-repository.js";
import { formatMainOddsSummary, formatMatchAnalysisMessage, formatOddsDataMessage, formatOddsFallbackMessage } from "./odds-text-format.js";
import { createLogger } from "../shared/logger.js";
import { vnDateStr } from "../shared/vn-time.js";

const logger = createLogger("betting:odds-runner");
const LABEL = "Match Odds";
const MIN_VERIFY_CONFIDENCE = 50;

function formatKickoff(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function shouldReviseReason(reasonCode: VerificationReasonCode): boolean {
  return reasonCode === "CONFLICT" || reasonCode === "OVERCLAIM" || reasonCode === "INSUFFICIENT_SUPPORT";
}

function makeConservativeRejectedAnalysis(
  analysis: MatchAiAnalysis,
  verifiedConfidence: number,
  verifiedComment: string,
): MatchAiAnalysis {
  return {
    ...analysis,
    picks: [],
    recommendation: "Đứng ngoài.",
    verifiedConfirmed: false,
    verifiedConfidence,
    verifiedComment,
    verificationStatus: "failed",
    revisedAfterReject: analysis.revisedAfterReject ?? false,
  };
}

export async function processMatch(match: MatchOddsPayload): Promise<{ match: MatchOddsPayload; analysis: MatchAiAnalysis | null; error: string | null }> {
  try {
    let analysis = await analyzeMatchOdds(match);
    const hasValidPick = (analysis.picks ?? []).length > 0;
    if (!hasValidPick || isStandAsideAnalysis(analysis.recommendation)) {
      if (!hasValidPick && !isStandAsideAnalysis(analysis.recommendation)) {
        analysis.recommendation = "Đứng ngoài.";
      }
      logger.info(`  ↷ Skip verify/revise for ${match.home} vs ${match.away}: no valid pick or stand-aside`);
      return { match, analysis, error: null };
    }

    try {
      const verification = await verifyMatchAnalysis(match, analysis);
      if (verification.confirmed && verification.confidence >= MIN_VERIFY_CONFIDENCE) {
        analysis.verifiedConfirmed = true;
        analysis.verifiedConfidence = verification.confidence;
        analysis.verifiedComment = verification.comment;
        analysis.verificationStatus = "confirmed";
        logger.info(`  ✓ Verify ${match.home} vs ${match.away}: confirmed (${verification.confidence}%)`);
      } else if (verification.confirmed && verification.confidence < MIN_VERIFY_CONFIDENCE) {
        // confirmed=true with extremely low confidence is a contradiction — treat as rejected
        logger.info(`  ✗ Verify ${match.home} vs ${match.away}: confirmed=${verification.confirmed} but confidence=${verification.confidence}% < ${MIN_VERIFY_CONFIDENCE}% — treating as INSUFFICIENT_SUPPORT`);
        const originalAnalysis = analysis;
        analysis = makeConservativeRejectedAnalysis(
          originalAnalysis,
          verification.confidence,
          `Xác nhận với độ tin cậy ${verification.confidence}% là quá thấp để follow: ${verification.comment}`,
        );
        if (shouldReviseReason("INSUFFICIENT_SUPPORT")) {
          try {
            analysis = await reviseMatchAnalysis(match, originalAnalysis, `Xác nhận với độ tin cậy ${verification.confidence}% là quá thấp để follow: ${verification.comment}`);
            analysis.verifiedConfirmed = false;
            analysis.verifiedConfidence = verification.confidence;
            analysis.verifiedComment = `Nhận định đã được điều chỉnh sau khi bị từ chối: ${verification.comment}`;
            analysis.revisedAfterReject = true;
            analysis.verificationStatus = "revised";
            logger.info(`  ↻ Revised ${match.home} vs ${match.away} thanh nhan dinh moi (low confidence)`);
          } catch (reviseError) {
            logger.warn(
              `  ⚠ Low-confidence revise failed for ${match.home} vs ${match.away}; keeping stand-aside: ${reviseError instanceof Error ? reviseError.message : reviseError}`,
            );
          }
        }
      } else if (shouldReviseReason(verification.reasonCode)) {
        logger.info(`  ✗ Verify ${match.home} vs ${match.away}: rejected (${verification.confidence}%) - ${verification.comment}`);
        const originalAnalysis = analysis;
        analysis = makeConservativeRejectedAnalysis(originalAnalysis, verification.confidence, verification.comment);
        try {
          analysis = await reviseMatchAnalysis(match, originalAnalysis, verification.comment);
          analysis.verifiedConfirmed = false;
          analysis.verifiedConfidence = verification.confidence;
          analysis.verifiedComment = `Nhận định đã được điều chỉnh sau khi bị từ chối: ${verification.comment}`;
          analysis.revisedAfterReject = true;
          analysis.verificationStatus = "revised";
          logger.info(`  ↻ Revised ${match.home} vs ${match.away} thanh nhan dinh moi`);
        } catch (reviseError) {
          logger.warn(
            `  ⚠ Revise failed for ${match.home} vs ${match.away}; keeping stand-aside: ${reviseError instanceof Error ? reviseError.message : reviseError}`,
          );
        }
      } else {
        analysis.verifiedConfirmed = false;
        analysis.verifiedConfidence = verification.confidence;
        analysis.verifiedComment = verification.comment;
        analysis.verificationStatus = "failed";
        if (verification.reasonCode === "HARD_INVALID") {
          analysis.picks = [];
          analysis.recommendation = "Đứng ngoài.";
        }
        logger.info(
          `  ✗ Verify ${match.home} vs ${match.away}: hard stop (${verification.reasonCode}) (${verification.confidence}%) - ${verification.comment}`,
        );
      }
    } catch (verifyError) {
      analysis.verificationStatus = "failed";
      analysis.verifiedComment = verifyError instanceof Error ? verifyError.message : String(verifyError);
      logger.warn(
        `  ⚠ Verify unavailable for ${match.home} vs ${match.away}; keeping primary analysis: ${verifyError instanceof Error ? verifyError.message : verifyError}`,
      );
    }
    return { match, analysis, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`  ⚠ OpenRouter failed for ${match.home} vs ${match.away}: ${message}`);
    return { match, analysis: null, error: message };
  }
}

export async function runOddsCheck(): Promise<void> {
  logger.info(`🏆 ${LABEL} - Starting...\n`);
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
    const failedList = failures.map((f) => `• ${f.match.home} vs ${f.match.away}: ${f.message}`).join("\n");
    await sendMessage(`⚠️ [${LABEL}] Lấy dữ liệu thất bại cho ${failures.length} trận (đã bỏ qua):\n${failedList}`);
  }

  const statusText = payload.length > 0
    ? `🏆 *[${LABEL}] ${payload.length} trận lấy được kèo* (ngày ${matches[0].date}):\n\n` +
      payload.slice().sort((a, b) => a.kickoffUnix - b.kickoffUnix).map((match, index) => {
        const mainOdds = formatMainOddsSummary(match);
        return `${index + 1}. ⏰ *${formatKickoff(match.kickoffUnix)}*\n   🏟 ${match.home} vs ${match.away}${mainOdds ? `\n   💰 ${mainOdds}` : ""}`;
      }).join("\n\n")
    : `⏸ [${LABEL}] ${matches.length} trận ngày ${matches[0].date}, nhưng không lấy được kèo trận nào.`;
  await sendMessage(statusText);
  if (payload.length === 0) return;

  const aiEnabled = Boolean(process.env.OPENROUTER_API_KEY);
  if (!aiEnabled) await sendMessage(`⚠️ [${LABEL}] OPENROUTER_API_KEY chưa được cấu hình — sẽ gửi dữ liệu odds thô cho từng trận.`);
  logger.info(`\n📤 Gui tung tran len Telegram (${aiEnabled ? "OpenRouter analysis" : "raw odds fallback"})...`);

  type MatchResult = {
    match: MatchOddsPayload;
    analysis: MatchAiAnalysis | null;
    error: string | null;
  };

  const matchResults: MatchResult[] = aiEnabled
    ? await Promise.all(payload.map(async (match) => processMatch(match)))
    : payload.map((match) => ({ match, analysis: null, error: null }));

  for (const { match, analysis, error } of matchResults) {
    try {
      if (!aiEnabled) {
        await sendMessage(formatOddsFallbackMessage(match, "thiếu OPENROUTER_API_KEY"));
      } else if (analysis) {
        await saveBettingAnalysisSnapshot({
          gameId: match.gameId,
          date: vnDateStr(match.kickoffUnix * 1000),
          home: match.home,
          away: match.away,
          kickoffUnix: match.kickoffUnix,
          odds: match.odds,
          correctScore: match.correctScore ?? null,
          analysis,
          verifiedConfirmed: analysis.verifiedConfirmed ?? null,
          verifiedConfidence: analysis.verifiedConfidence ?? null,
          verifiedComment: analysis.verifiedComment ?? null,
          revisedAfterReject: analysis.revisedAfterReject ?? false,
        });
        await sendMessage(formatMatchAnalysisMessage(match, analysis));
        await sendMessage(formatOddsDataMessage(match));
        logger.info(`  ✓ OpenRouter analyzed: ${match.home} vs ${match.away}`);
      } else {
        await sendMessage(formatOddsFallbackMessage(match, error!.slice(0, 200)));
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      logger.warn(`  ⚠ Telegram/snapshot failed for ${match.home} vs ${match.away}: ${message}`);
      try {
        await sendMessage(formatOddsFallbackMessage(match, `không gửi được kết quả phân tích: ${message.slice(0, 120)}`));
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        logger.warn(`  ⚠ Fallback message also failed for ${match.home} vs ${match.away}: ${fallbackMessage}`);
      }
    }
  }
  logger.info(`\n✅ Da gui ${payload.length} tran dau len Telegram.`);
}
