import { fetchActualRecords } from "../client/lottery-scraper.js";
import { appendWeekdayHistory, loadWeekdayHistory } from "../repository/lottery-repository.js";
import { buildLotteryDataset, lotteryFilename } from "../service/lottery-format.js";
import { WEEKDAY_LABELS } from "../service/lottery-schedule.js";
import { sendDocument, sendMessage } from "../../shared/notification/telegram-client.js";
import type { LotteryDrawRecord, LotteryRegion } from "../model/lottery-types.js";
import { createLogger } from "../../shared/infra/logger.js";

const logger = createLogger("lottery:lottery-runner");
const REGIONS: LotteryRegion[] = ["mien-bac", "mien-trung", "mien-nam"];

function vnDateOffset(offsetDays: number): { dateStr: string; weekday: number } {
  const now = new Date();
  const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  vnNow.setDate(vnNow.getDate() + offsetDays);
  return { dateStr: vnNow.toISOString().slice(0, 10), weekday: vnNow.getDay() };
}

function vnHour(): number {
  const now = new Date();
  const hourStr = now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh", hour: "numeric", hour12: false });
  return Number(hourStr);
}

/**
 * (1) Lấy + append kết quả THẬT của hôm nay vào file đúng thứ hôm nay (giữ cache luôn mới —
 * bỏ qua fetch nếu hôm nay đã có sẵn, tránh request thừa khi chạy tay nhiều lần).
 * (2) Gửi Telegram file data: nếu hiện tại đã sau 19h (giờ VN) thì gửi data của NGÀY MAI (để có
 * sẵn lịch sử trước khi kỳ quay ngày mai diễn ra), còn trước 19h thì vẫn gửi data của HÔM NAY.
 * 2 việc này độc lập.
 */
export async function runLotteryCheck(): Promise<void> {
  const today = vnDateOffset(0);
  const isAfter19h = vnHour() >= 19;
  const target = isAfter19h ? vnDateOffset(1) : today;
  const todayLabel = WEEKDAY_LABELS[today.weekday];
  const targetLabel = WEEKDAY_LABELS[target.weekday];
  logger.info(`🎰 Lottery History Scanner — hôm nay ${todayLabel} ${today.dateStr}, ${isAfter19h ? "sau 19h" : "trước 19h"} nên chuẩn bị data cho ${targetLabel} ${target.dateStr}\n`);

  const historyToday = await loadWeekdayHistory(today.weekday);
  const regionsAlreadyToday = new Set(historyToday.filter((r) => r.date === today.dateStr).map((r) => r.region));

  const todayRecords: LotteryDrawRecord[] = [];
  const failures: string[] = [];

  for (const region of REGIONS) {
    if (regionsAlreadyToday.has(region)) {
      logger.info(`✓ [${region}] Đã có dữ liệu hôm nay (${today.dateStr}) — bỏ qua, không fetch lại.\n`);
      continue;
    }

    try {
      logger.info(`📡 [${region}] Lấy kết quả hôm nay (${today.dateStr})...`);
      const records = await fetchActualRecords(region, today.dateStr, today.weekday);
      todayRecords.push(...records);
      logger.info(`✓ [${region}] Lấy được ${records.length} bản ghi.\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`✗ [${region}] Lấy dữ liệu thất bại: ${message}\n`);
      failures.push(`${region}: ${message}`);
    }
  }

  if (failures.length > 0) {
    await sendMessage(`⚠️ [Lottery] Lấy dữ liệu hôm nay thất bại:\n${failures.join("\n").slice(0, 1000)}`);
  }

  await appendWeekdayHistory(today.weekday, todayRecords);

  const historyForTarget = await loadWeekdayHistory(target.weekday);
  if (historyForTarget.length === 0) {
    await sendMessage(`🎰 *Lottery History Scanner*\nChưa có dữ liệu lịch sử cho ${targetLabel} (${target.dateStr}) — bỏ qua, không gửi file.`);
    logger.info("\n✓ Không có dữ liệu để gửi.");
    return;
  }

  for (const region of REGIONS) {
    const recordsForRegion = historyForTarget.filter((r) => r.region === region);
    if (recordsForRegion.length === 0) continue;

    const dataset = buildLotteryDataset(target.weekday, region, recordsForRegion);
    const buffer = Buffer.from(JSON.stringify(dataset, null, 0));
    const filename = lotteryFilename(target.weekday, target.dateStr, region);
    await sendDocument(
      buffer,
      filename,
      `🎰 Chuẩn bị cho ${targetLabel} ${target.dateStr} — ${region} (${recordsForRegion.length} kỳ tích lũy)`,
    );
    logger.info(`✓ Đã gửi file ${filename} (${recordsForRegion.length} bản ghi, ${region}, cho ${targetLabel}).`);
  }

  logger.info("\n✅ Hoàn tất.");
}

