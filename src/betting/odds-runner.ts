import { sendMessage } from "../shared/telegram.js";
import { getConfiguredBookmaker } from "./betting-api.js";
import { buildOddsPayload, pickNearestUpcomingDateMatches } from "./betting.js";
import { analyzeMatchOdds, reviseMatchAnalysis, verifyMatchAnalysis } from "./betting-gemini.js";
import { saveBettingAnalysisSnapshot } from "./betting-analysis-repository.js";
import { loadUpcomingMatches } from "./match-repository.js";
import { formatMainOddsSummary, formatMatchAnalysisMessage, formatOddsDataMessage, formatOddsFallbackMessage } from "./odds-text-format.js";
import { createLogger } from "../shared/logger.js";
import { vnDateStr } from "../shared/vn-time.js";

const logger = createLogger("betting:odds-runner");
const LABEL = "Match Odds";

function formatKickoff(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export async function runOddsCheck(): Promise<void> {
  logger.info(`🏆 ${LABEL} - Starting...\n`);
  const matches = pickNearestUpcomingDateMatches(await loadUpcomingMatches());
  logger.info(`✓ ${matches.length} tran chua da cua ngay gan nhat (${matches[0]?.date ?? "-"})\n`);
  if (matches.length === 0) {
    await sendMessage(`⏸ [${LABEL}] Khong co tran nao sap toi trong DB - hay chay lai fetch-matches-list.`);
    return;
  }

  const bookmakerKey = getConfiguredBookmaker();
  logger.info(`📊 Do + lay TOAN BO market tu bookmaker "${bookmakerKey}" cho tung tran...`);
  const { payload, failures } = await buildOddsPayload(matches);
  if (failures.length > 0) {
    const failedList = failures.map((f) => `• ${f.match.home} vs ${f.match.away}: ${f.message}`).join("\n");
    await sendMessage(`⚠️ [${LABEL}] Lay du lieu that bai cho ${failures.length} tran (da bo qua):\n${failedList}`);
  }

  const statusText = payload.length > 0
    ? `🏆 *[${LABEL}] ${payload.length} tran lay duoc keo* (ngay ${matches[0].date}):\n\n` +
      payload.slice().sort((a, b) => a.kickoffUnix - b.kickoffUnix).map((match, index) => {
        const mainOdds = formatMainOddsSummary(match);
        return `${index + 1}. ⏰ *${formatKickoff(match.kickoffUnix)}*\n   🏟 ${match.home} vs ${match.away}${mainOdds ? `\n   💰 ${mainOdds}` : ""}`;
      }).join("\n\n")
    : `⏸ [${LABEL}] ${matches.length} tran ngay ${matches[0].date}, nhung khong lay duoc keo tran nao.`;
  await sendMessage(statusText);
  if (payload.length === 0) return;

  const aiEnabled = Boolean(process.env.OPENROUTER_API_KEY);
  if (!aiEnabled) await sendMessage(`⚠️ [${LABEL}] OPENROUTER_API_KEY chua duoc cau hinh - se gui raw odds cho tung tran.`);
  logger.info(`\n📤 Gui tung tran len Telegram (${aiEnabled ? "OpenRouter analysis" : "raw odds fallback"})...`);

  for (const match of payload) {
    if (!aiEnabled) {
      await sendMessage(formatOddsFallbackMessage(match, "thieu OPENROUTER_API_KEY"));
      continue;
    }
    try {
      let analysis = await analyzeMatchOdds(match);
      try {
        const verification = await verifyMatchAnalysis(match, analysis);
        if (verification.confirmed) {
          analysis.verifiedConfirmed = true;
          analysis.verifiedConfidence = verification.confidence;
          analysis.verifiedComment = verification.comment;
          analysis.verificationStatus = "confirmed";
          logger.info(`  ✓ Verify ${match.home} vs ${match.away}: confirmed (${verification.confidence}%)`);
        } else {
          logger.info(`  ✗ Verify ${match.home} vs ${match.away}: rejected (${verification.confidence}%) - ${verification.comment}`);
          analysis = await reviseMatchAnalysis(match, analysis, verification.comment);
          analysis.verifiedConfirmed = false;
          analysis.verifiedConfidence = verification.confidence;
          analysis.verifiedComment = `Nhan dinh da duoc dieu chinh sau khi bi tu choi: ${verification.comment}`;
          analysis.revisedAfterReject = true;
          analysis.verificationStatus = "revised";
          logger.info(`  ↻ Revised ${match.home} vs ${match.away} thanh nhan dinh moi`);
        }
      } catch (verifyError) {
        analysis.verificationStatus = "failed";
        analysis.verifiedComment = verifyError instanceof Error ? verifyError.message : String(verifyError);
        logger.warn(
          `  ⚠ Verify unavailable for ${match.home} vs ${match.away}; keeping primary analysis: ${verifyError instanceof Error ? verifyError.message : verifyError}`,
        );
      }
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`  ⚠ OpenRouter failed for ${match.home} vs ${match.away}: ${message}`);
      await sendMessage(formatOddsFallbackMessage(match, message.slice(0, 200)));
    }
  }
  logger.info(`\n✅ Da gui ${payload.length} tran dau len Telegram.`);
}
