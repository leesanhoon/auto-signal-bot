import "./env.js";
import { fetchEvents, getConfiguredBookmaker } from "./betting-api.js";
import { extractMatches, filterUpcomingWithin, buildOddsPayload } from "./betting.js";
import { sendMessage, notifyError } from "./telegram.js";
import {
  loadDailyMatchesCache,
  saveDailyMatchesCache,
  isDailyCacheValid,
  hasOddsCache,
  saveOddsCache,
  cleanupExpiredOddsCache,
} from "./cache.js";
import type { MatchInfo } from "./betting-types.js";
import { formatOddsText } from "./odds-text-format.js";

const HOURS_WINDOW = 5;

async function getMatches(): Promise<MatchInfo[]> {
  const cached = loadDailyMatchesCache();
  if (isDailyCacheValid(cached)) {
    console.log(`📦 Dùng danh sách trận từ cache (${cached!.matches.length} trận)\n`);
    return cached!.matches;
  }

  console.log("📡 Cache hết hạn/không có — lấy danh sách trận mới...");
  const raw = await fetchEvents();
  const matches = extractMatches(raw);
  saveDailyMatchesCache(matches);
  console.log(`✓ ${matches.length} trận đấu (đã lưu cache)\n`);
  return matches;
}

async function main(): Promise<void> {
  console.log("🏆 Match Odds Scanner — Starting...\n");

  cleanupExpiredOddsCache();

  const matches = await getMatches();

  const upcoming = filterUpcomingWithin(matches, HOURS_WINDOW);
  console.log(`✓ ${upcoming.length} trận sắp đá trong ${HOURS_WINDOW}h tới\n`);

  const needsFetch = upcoming.filter((m) => !hasOddsCache(m.gameId));
  const alreadyCached = upcoming.length - needsFetch.length;
  console.log(`✓ ${needsFetch.length} trận cần lấy kèo mới, ${alreadyCached} trận đã có cache\n`);

  const bookmakerKey = getConfiguredBookmaker();
  let newPayload: Awaited<ReturnType<typeof buildOddsPayload>>["payload"] = [];
  let failures: Awaited<ReturnType<typeof buildOddsPayload>>["failures"] = [];

  if (needsFetch.length > 0) {
    console.log(`📊 Dò + lấy TOÀN BỘ market từ bookmaker "${bookmakerKey}" cho từng trận mới...`);
    const result = await buildOddsPayload(needsFetch);
    newPayload = result.payload;
    failures = result.failures;

    for (const match of newPayload) {
      saveOddsCache(match);
    }
  }

  if (failures.length > 0) {
    const failedList = failures
      .map((f) => `• ${f.match.home} vs ${f.match.away}: ${f.message}`)
      .join("\n");
    await sendMessage(
      `⚠️ Lấy dữ liệu thất bại cho ${failures.length} trận (đã bỏ qua):\n${failedList}`,
    );
  }

  const formatKickoff = (unixSeconds: number) =>
    new Date(unixSeconds * 1000).toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const statusText =
    upcoming.length === 0
      ? `⏸ Không có trận nào sắp đá trong ${HOURS_WINDOW}h tới.`
      : newPayload.length > 0
        ? `🏆 *${newPayload.length} trận mới lấy được kèo* (${alreadyCached} trận đã cache từ trước, trong ${HOURS_WINDOW}h tới):\n\n` +
          newPayload
            .slice()
            .sort((a, b) => a.kickoffUnix - b.kickoffUnix)
            .map((m, i) => `${i + 1}. ⏰ *${formatKickoff(m.kickoffUnix)}*\n   🏟 ${m.home} vs ${m.away}`)
            .join("\n\n")
        : `⏸ ${upcoming.length} trận trong ${HOURS_WINDOW}h tới, không có trận nào mới (đã cache hết).`;

  await sendMessage(statusText);

  if (newPayload.length > 0) {
    console.log("\n📤 Gửi từng trận mới lên Telegram (dạng text)...");
    for (const match of newPayload) {
      await sendMessage(`\`\`\`\n${formatOddsText(match)}\n\`\`\``);
    }
    console.log(`\n✅ Đã gửi ${newPayload.length} trận đấu mới lên Telegram.`);
  } else {
    console.log("\n✓ Không có trận mới cần gửi.");
  }
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await notifyError("Match Odds Scanner", error);
  process.exit(1);
});
