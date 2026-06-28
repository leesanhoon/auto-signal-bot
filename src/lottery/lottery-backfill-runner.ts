import { fetchDayPage, parseWeekdayPage } from "./lottery-scraper.js";
import { appendWeekdayHistory, loadWeekdayHistory } from "./lottery-repository.js";
import type { LotteryRegion } from "./lottery-types.js";

const REGIONS: LotteryRegion[] = ["mien-bac", "mien-trung", "mien-nam"];
const FETCH_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "YYYY-MM-DD" của N ngày trước hôm nay, theo giờ Asia/Ho_Chi_Minh. */
function vnDateNDaysAgo(n: number): { dateStr: string; weekday: number } {
  const now = new Date();
  const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  vnNow.setDate(vnNow.getDate() - n);
  return { dateStr: vnNow.toISOString().slice(0, 10), weekday: vnNow.getDay() };
}

/**
 * Backfill lịch sử sâu (vd 1 năm) bằng cách fetch TỪNG NGÀY riêng lẻ cho cả 3 miền — khác với
 * `runLotteryCheck` (chạy cron hàng ngày, chỉ fetch đúng ngày hôm đó). Đây là job chạy 1 lần
 * (hoặc khi cần mở rộng thêm), có thể chạy lại nhiều lần — tự bỏ qua ngày/miền đã có data trong
 * cache (đúng file của thứ tương ứng) để resume được nếu bị ngắt giữa chừng.
 */
export async function runLotteryBackfill(days: number): Promise<void> {
  console.log(`🎰 Lottery Backfill — ${days} ngày gần nhất, cả 3 miền\n`);

  const weekdayKeyCache = new Map<number, Set<string>>();
  const existingKeysFor = async (weekday: number): Promise<Set<string>> => {
    let set = weekdayKeyCache.get(weekday);
    if (!set) {
      const history = await loadWeekdayHistory(weekday);
      set = new Set(history.map((r) => `${r.date}|${r.region}`));
      weekdayKeyCache.set(weekday, set);
    }
    return set;
  };

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (let offset = 0; offset < days; offset++) {
    const { dateStr, weekday } = vnDateNDaysAgo(offset);
    const existingKeys = await existingKeysFor(weekday);

    for (const region of REGIONS) {
      const key = `${dateStr}|${region}`;
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      try {
        const html = await fetchDayPage(region, dateStr);
        const records = parseWeekdayPage(html, region, weekday).filter((r) => r.prizes.db !== "");
        await appendWeekdayHistory(weekday, records);
        existingKeys.add(key);
        fetched++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✗ [${region}] ${dateStr}: ${message}`);
        failed++;
      }

      await sleep(FETCH_DELAY_MS);
    }

    if (offset % 30 === 0) {
      console.log(`… đã xử lý ${offset}/${days} ngày (fetched=${fetched}, skipped=${skipped}, failed=${failed})`);
    }
  }

  console.log(`\n✅ Backfill hoàn tất — fetched=${fetched}, skipped (đã có sẵn)=${skipped}, failed=${failed}`);
}
