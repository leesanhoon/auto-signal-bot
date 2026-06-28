import "../shared/env.js";
import { fetchFixtures } from "./betting-api.js";
import { extractMatches } from "./betting.js";
import { saveDailyMatchesCache } from "./cache.js";
import { notifyError } from "../shared/telegram.js";

/**
 * Entry point riêng — chỉ refresh danh sách fixtures (không đụng odds/Telegram).
 * Chạy theo cron riêng (mỗi ngày) để giới hạn tần suất gọi API-Football,
 * độc lập với workflow check-and-send odds (chạy thường xuyên hơn).
 */
async function main(): Promise<void> {
  console.log("📡 Fetch Matches List — Starting...\n");

  const raw = await fetchFixtures();
  const matches = extractMatches(raw);
  await saveDailyMatchesCache(matches);

  console.log(`✓ ${matches.length} trận đấu (đã lưu cache)`);
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await notifyError("Fetch Matches List", error);
  process.exit(1);
});
