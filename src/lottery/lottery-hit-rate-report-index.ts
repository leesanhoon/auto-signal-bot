import "../shared/env.js";
import { computeHitRateStats, formatHitRateReport } from "./lottery-hit-rate-report.js";
import { notifyError, sendMessage } from "../shared/telegram-client.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("lottery:lottery-hit-rate-report-index");

function getTrailingDays(): number {
  const raw = Number.parseInt(
    process.env.LOTTERY_HIT_RATE_TRAILING_DAYS ?? "",
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

async function runLotteryHitRateReport(): Promise<void> {
  const trailingDays = getTrailingDays();
  logger.info(`📊 Lottery Hit-Rate Report — trailingDays=${trailingDays}`);

  const stats = await computeHitRateStats(trailingDays);
  if (stats.length === 0) {
    await sendMessage(
      `📊 *LOTTERY HIT-RATE REPORT*\n\nChưa đủ dữ liệu verify trong ${trailingDays} ngày gần nhất.`,
    );
    logger.info("Không có dữ liệu verify để tổng hợp.");
    return;
  }

  await sendMessage(formatHitRateReport(stats, trailingDays));
  logger.info(`Đã gửi report hit-rate với ${stats.length} nhóm region/method_version.`);
}

runLotteryHitRateReport().catch(async (error) => {
  logger.error("Fatal error:", error);
  await notifyError("Lottery Hit-Rate Report", error);
  process.exit(1);
});
