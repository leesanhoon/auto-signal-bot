import { fetchActualRecords } from "./client/lottery-scraper.js";
import { appendWeekdayHistory } from "./repository/lottery-repository.js";
import { matchPrizeLabel, matchPrizeLabelLast2 } from "./service/lottery-format.js";
import { loadUnverifiedPredictions, markPredictionVerified } from "./repository/lottery-predictions-repository.js";
import { WEEKDAY_LABELS } from "./service/lottery-schedule.js";
import { sendMessage } from "../shared/notification/telegram-client.js";
import type { LotteryRegion } from "./model/lottery-types.js";
import { createLogger } from "../shared/infra/logger.js";

const logger = createLogger("lottery:lottery-verify-runner");
const REGION_LABELS: Record<LotteryRegion, string> = {
  "mien-bac": "🟦 Miền Bắc",
  "mien-trung": "🟨 Miền Trung",
  "mien-nam": "🟩 Miền Nam",
};

function vnToday(): { dateStr: string; weekday: number } {
  const vnNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return { dateStr: vnNow.toISOString().slice(0, 10), weekday: vnNow.getDay() };
}

/** Xác minh các dự đoán đã lưu của 1 miền/hôm nay bằng kết quả scrape thật, lưu luôn vào `lottery_draws`, báo Telegram. */
export async function runLotteryVerify(region: LotteryRegion): Promise<void> {
  const { dateStr, weekday } = vnToday();
  const weekdayLabel = WEEKDAY_LABELS[weekday];
  logger.info(`🔍 Lottery Verify [${region}] — ${weekdayLabel} ${dateStr}\n`);

  const predictions = await loadUnverifiedPredictions(dateStr, region);
  if (predictions.length === 0) {
    logger.info("✓ Không có dự đoán nào cần xác minh hôm nay.");
    await sendMessage(`🔍 *DÒ KẾT QUẢ* — ${REGION_LABELS[region]}\n📅 ${weekdayLabel}, ${dateStr}\n\nKhông có dự đoán nào để xác minh hôm nay.`);
    return;
  }

  const actualRecords = await fetchActualRecords(region, dateStr, weekday);
  if (actualRecords.length === 0) {
    logger.info("✓ Chưa có kết quả thật hôm nay — bỏ qua, lần chạy sau (theo lịch) sẽ thử lại.");
    await sendMessage(
      `🔍 *DÒ KẾT QUẢ* — ${REGION_LABELS[region]}\n📅 ${weekdayLabel}, ${dateStr}\n\n⏳ Chưa có kết quả quay số hôm nay trên xoso.com.vn — thử lại sau.`,
    );
    return;
  }

  await appendWeekdayHistory(weekday, actualRecords);
  logger.info(`✓ Đã lưu ${actualRecords.length} bản ghi kết quả thật vào lottery_draws.`);

  const lines: string[] = [`🔍 *DÒ KẾT QUẢ* — ${REGION_LABELS[region]}`, `📅 ${weekdayLabel}, ${dateStr}`, ""];
  let hitCount = 0;
  let hit2Count = 0;

  for (const prediction of predictions) {
    let matchedProvince: string | undefined;
    let matchedPrize: string | undefined;

    for (const record of actualRecords) {
      const label = matchPrizeLabel(record.prizes, prediction.number);
      if (label) {
        matchedProvince = record.province;
        matchedPrize = label;
        break;
      }
    }

    let matchedProvince2: string | undefined;
    let matchedPrize2: string | undefined;

    for (const record of actualRecords) {
      const label2 = matchPrizeLabelLast2(record.prizes, prediction.number);
      if (label2) {
        matchedProvince2 = record.province;
        matchedPrize2 = label2;
        break;
      }
    }

    const hit = matchedPrize !== undefined;
    const hit2 = matchedPrize2 !== undefined;
    await markPredictionVerified(
      dateStr,
      region,
      prediction.number,
      hit,
      matchedProvince,
      matchedPrize,
      hit2,
      matchedProvince2,
      matchedPrize2,
    );
    if (hit) hitCount++;
    if (hit2) hit2Count++;

    let detail: string;
    if (hit) {
      detail = `✅ TRÚNG${matchedPrize ? ` — ${matchedPrize}` : ""}${matchedProvince ? ` (${matchedProvince})` : ""}`;
    } else if (hit2) {
      detail = `🔸 Trúng 2 số cuối${matchedPrize2 ? ` — ${matchedPrize2}` : ""}${matchedProvince2 ? ` (${matchedProvince2})` : ""}`;
    } else {
      detail = "❌ Không trúng";
    }
    lines.push(`#${prediction.rank} \`${prediction.number}\`  —  ${detail}`);
    logger.info(`✓ [${prediction.number}] ${hit ? "TRÚNG" : hit2 ? "trúng 2 số cuối" : "không trúng"}`);
  }

  lines.push("");
  lines.push(`*Tổng kết: trúng đủ 3 số ${hitCount}/${predictions.length}, trúng 2 số cuối ${hit2Count}/${predictions.length}*`);
  await sendMessage(lines.join("\n"));
  logger.info(`\n✅ Hoàn tất. Trúng đủ 3 số ${hitCount}/${predictions.length}, trúng 2 số cuối ${hit2Count}/${predictions.length}.`);
}

