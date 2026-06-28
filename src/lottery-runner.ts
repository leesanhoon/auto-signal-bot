import { fetchDayPage, parseWeekdayPage } from "./lottery-scraper.js";
import { appendWeekdayHistory, loadWeekdayHistory } from "./lottery-cache.js";
import { buildLotteryDataset, lotteryFilename } from "./lottery-format.js";
import { WEEKDAY_LABELS } from "./lottery-schedule.js";
import { sendDocument, sendMessage } from "./telegram.js";
import type { LotteryDrawRecord, LotteryRegion } from "./lottery-types.js";

const REGIONS: LotteryRegion[] = ["mien-bac", "mien-trung", "mien-nam"];

function todayInVietnam(): { dateStr: string; weekday: number } {
  const now = new Date();
  const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const dateStr = vnNow.toISOString().slice(0, 10);
  return { dateStr, weekday: vnNow.getDay() };
}

export async function runLotteryCheck(): Promise<void> {
  const { dateStr, weekday } = todayInVietnam();
  const weekdayLabel = WEEKDAY_LABELS[weekday];
  console.log(`🎰 Lottery History Scanner — ${weekdayLabel} ${dateStr}\n`);

  const historyBefore = loadWeekdayHistory(weekday);
  const regionsAlreadyToday = new Set(historyBefore.filter((r) => r.date === dateStr).map((r) => r.region));

  const todayRecords: LotteryDrawRecord[] = [];
  const failures: string[] = [];

  for (const region of REGIONS) {
    if (regionsAlreadyToday.has(region)) {
      console.log(`✓ [${region}] Đã có dữ liệu hôm nay (${dateStr}) trong cache — bỏ qua, không fetch lại.\n`);
      continue;
    }

    try {
      console.log(`📡 [${region}] Lấy kết quả hôm nay (${dateStr})...`);
      const html = await fetchDayPage(region, dateStr);
      const records = parseWeekdayPage(html, region, weekday).filter((r) => r.prizes.db !== "");
      todayRecords.push(...records);
      console.log(`✓ [${region}] Lấy được ${records.length} bản ghi.\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ [${region}] Lấy dữ liệu thất bại: ${message}\n`);
      failures.push(`${region}: ${message}`);
    }
  }

  if (failures.length > 0) {
    await sendMessage(`⚠️ [Lottery] Lấy dữ liệu hôm nay thất bại:\n${failures.join("\n").slice(0, 1000)}`);
  }

  if (todayRecords.length === 0 && regionsAlreadyToday.size === REGIONS.length) {
    console.log(`\n✓ Hôm nay (${weekdayLabel} ${dateStr}) đã có đủ dữ liệu 3 miền từ trước — không gửi lại Telegram.`);
    return;
  }

  appendWeekdayHistory(weekday, todayRecords);

  const history = loadWeekdayHistory(weekday);
  if (history.length === 0) {
    await sendMessage(`🎰 *Lottery History Scanner* — ${weekdayLabel} ${dateStr}\nChưa có dữ liệu lịch sử cho ${weekdayLabel} — bỏ qua, không gửi file.`);
    console.log("\n✓ Không có dữ liệu để gửi.");
    return;
  }

  const dataset = buildLotteryDataset(weekday, history);
  const buffer = Buffer.from(JSON.stringify(dataset, null, 0));
  const filename = lotteryFilename(weekday, dateStr);
  await sendDocument(buffer, filename, `🎰 ${weekdayLabel} ${dateStr} — cả 3 miền (${history.length} kỳ tích lũy)`);
  console.log(`✓ Đã gửi file ${filename} (${history.length} bản ghi, cả 3 miền).`);

  console.log("\n✅ Hoàn tất.");
}
