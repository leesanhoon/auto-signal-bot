import "../shared/env.js";
import { loadClosedPositions } from "./positions-repository-smc.js";
import { summarizeClosedPositionsPerformance } from "./performance-tracking-smc.js";
import { buildPerformanceReportMessage } from "../shared/telegram-smc.js";
import { sendMessage } from "../shared/telegram-client.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:performance-report-smc");

function getPeriodConfig() {
  const mode = (process.env.PERFORMANCE_REPORT_PERIOD ?? "weekly").trim().toLowerCase();
  const now = new Date();
  const lookbackDays = mode === "monthly" ? 30 : 7;
  const start = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const dateLabel = (value: Date) => value.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  return {
    mode: mode === "monthly" ? "monthly" : "weekly",
    periodLabel: mode === "monthly" ? "thang" : "tuan",
    startIso: start.toISOString(),
    startLabel: dateLabel(start),
    endLabel: dateLabel(now),
  };
}

export async function runPerformanceReport(): Promise<void> {
  const config = getPeriodConfig();
  logger.info("Performance report starting", { period: config.mode, since: config.startIso });

  const closedPositions = await loadClosedPositions(config.startIso);
  const report = summarizeClosedPositionsPerformance(closedPositions, {
    periodLabel: config.periodLabel,
    startAt: config.startLabel,
    endAt: config.endLabel,
  });

  await sendMessage(buildPerformanceReportMessage(report));
  logger.info("Performance report sent", { trades: report.portfolio.trades, period: config.mode });
}

runPerformanceReport().catch((error) => {
  logger.error("Performance report failed", { error });
  process.exit(1);
});
