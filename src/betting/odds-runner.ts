import { fetchFixtures, getConfiguredBookmaker } from "./betting-api.js";
import { extractMatches, filterUpcomingWithin, buildOddsPayload, formatWindowLabel } from "./betting.js";
import { sendMessage } from "../shared/telegram.js";
import {
  loadDailyMatchesCache,
  saveDailyMatchesCache,
  isDailyCacheValid,
  hasBeenSent,
  markMatchesSent,
  type SentStage,
} from "./cache.js";
import type { MatchInfo } from "./betting-types.js";
import { formatOddsText, formatMainOddsSummary } from "./odds-text-format.js";

async function getMatches(): Promise<MatchInfo[]> {
  const cached = await loadDailyMatchesCache();
  if (isDailyCacheValid(cached)) {
    console.log(`📦 Dùng danh sách trận từ cache (${cached!.matches.length} trận)\n`);
    return cached!.matches;
  }

  console.log("📡 Cache hết hạn/không có — lấy danh sách trận mới...");
  const raw = await fetchFixtures();
  const matches = extractMatches(raw);
  await saveDailyMatchesCache(matches);
  console.log(`✓ ${matches.length} trận đấu (đã lưu cache)\n`);
  return matches;
}

function formatKickoff(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type OddsCheckConfig = {
  /** Lấy odds cho trận còn trong vòng bao nhiêu phút tới giờ đá. */
  windowMinutes: number;
  /** "periodic" (lấy sớm, lặp lại theo cron riêng) hoặc "final" (lấy cuối, ngay trước kickoff) — mỗi stage gửi tối đa 1 lần/trận. */
  stage: SentStage;
  /** Nhãn hiển thị trong log/Telegram để phân biệt 2 luồng. */
  label: string;
};

/**
 * Logic chung cho cả 2 luồng lấy odds: "periodic" (mỗi 5h, window 24h) và "final"
 * (mỗi 10', window ngay trước kickoff). Khác nhau duy nhất ở windowMinutes + stage.
 */
export async function runOddsCheck(config: OddsCheckConfig): Promise<void> {
  console.log(`🏆 ${config.label} — Starting...\n`);

  const matches = await getMatches();

  const windowLabel = formatWindowLabel(config.windowMinutes);
  const upcoming = filterUpcomingWithin(matches, config.windowMinutes);
  console.log(`✓ ${upcoming.length} trận sắp đá trong ${windowLabel} tới\n`);

  if (upcoming.length === 0) {
    console.log(`✓ Không có trận nào sắp đá trong ${windowLabel} tới — bỏ qua, không gửi Telegram.\n`);
    return;
  }

  // "final": mỗi trận chỉ lấy lại kèo tối đa 1 lần ngay trước kickoff.
  // "periodic": luôn lấy kèo mới nhất cho mọi trận còn trong window, kể cả đã gửi ở lần chạy trước.
  const needsFetch =
    config.stage === "final"
      ? (
          await Promise.all(upcoming.map(async (m) => ((await hasBeenSent(m.gameId, config.stage)) ? null : m)))
        ).filter((m): m is MatchInfo => m !== null)
      : upcoming;
  const alreadySent = upcoming.length - needsFetch.length;
  console.log(`✓ ${needsFetch.length} trận cần lấy kèo, ${alreadySent} trận đã gửi trước đó (bỏ qua)\n`);

  const bookmakerKey = getConfiguredBookmaker();
  let newPayload: Awaited<ReturnType<typeof buildOddsPayload>>["payload"] = [];
  let failures: Awaited<ReturnType<typeof buildOddsPayload>>["failures"] = [];

  if (needsFetch.length > 0) {
    console.log(`📊 Dò + lấy TOÀN BỘ market từ bookmaker "${bookmakerKey}" cho từng trận mới...`);
    const result = await buildOddsPayload(needsFetch);
    newPayload = result.payload;
    failures = result.failures;
  }

  if (failures.length > 0) {
    const failedList = failures
      .map((f) => `• ${f.match.home} vs ${f.match.away}: ${f.message}`)
      .join("\n");
    await sendMessage(
      `⚠️ [${config.label}] Lấy dữ liệu thất bại cho ${failures.length} trận (đã bỏ qua):\n${failedList}`,
    );
  }

  const alreadySentSuffix = config.stage === "final" && alreadySent > 0 ? ` (${alreadySent} trận đã gửi từ trước)` : "";
  const statusText =
    newPayload.length > 0
      ? `🏆 *[${config.label}] ${newPayload.length} trận lấy được kèo*${alreadySentSuffix}, trong ${windowLabel} tới:\n\n` +
        newPayload
          .slice()
          .sort((a, b) => a.kickoffUnix - b.kickoffUnix)
          .map((m, i) => {
            const mainOdds = formatMainOddsSummary(m);
            return (
              `${i + 1}. ⏰ *${formatKickoff(m.kickoffUnix)}*\n   🏟 ${m.home} vs ${m.away}` +
              (mainOdds ? `\n   💰 ${mainOdds}` : "")
            );
          })
          .join("\n\n")
      : `⏸ [${config.label}] ${upcoming.length} trận trong ${windowLabel} tới, nhưng không lấy được kèo trận nào.`;

  await sendMessage(statusText);

  if (newPayload.length > 0) {
    console.log("\n📤 Gửi từng trận lên Telegram (dạng text)...");
    for (const match of newPayload) {
      await sendMessage(`\`\`\`\n${formatOddsText(match)}\n\`\`\``);
      if (config.stage === "final") {
        await markMatchesSent([match], config.stage);
      }
    }
    console.log(`\n✅ Đã gửi ${newPayload.length} trận đấu lên Telegram.`);
  } else {
    console.log("\n✓ Không có trận cần gửi.");
  }
}
