import type { PerformanceSummary } from "../charts/service/performance-tracking-volman.js";
import type { AiProvider } from "./ai-usage.js";

export type AiUsageDailySummary = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  byProvider: Array<{
    provider: AiProvider;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  }>;
};

export type StatsReport = {
  openPositions: number;
  performanceWindowLabel: string;
  recentPerformance: PerformanceSummary | null;
  aiUsageToday: AiUsageDailySummary | null;
  updatedAtLabel?: string;
};

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatPerformanceLine(report: PerformanceSummary | null, windowLabel: string): string {
  if (!report || report.trades === 0) {
    return `Win-rate ${windowLabel}: chưa có đủ lệnh đóng`;
  }

  return `Win-rate ${windowLabel}: ${report.winRate.toFixed(2)}% (${report.wins}W/${report.losses}L/${report.breakevens}BE)`;
}

export function buildStatsMessage(report: StatsReport): string {
  const lines: string[] = [
    "📊 *Bảng điều khiển*",
    "",
    `• Lệnh đang mở: *${report.openPositions}*`,
    `• ${formatPerformanceLine(report.recentPerformance, report.performanceWindowLabel)}`,
  ];

  if (report.aiUsageToday) {
    const totalTokens = report.aiUsageToday.inputTokens + report.aiUsageToday.outputTokens;
    lines.push(
      `• AI usage hôm nay: *${report.aiUsageToday.requests}* req | *${formatCompactNumber(totalTokens)}* tokens | *${formatUsd(report.aiUsageToday.estimatedCostUsd)}*`,
    );

    if (report.aiUsageToday.byProvider.length > 0) {
      lines.push("", "_Theo provider_");
      for (const row of report.aiUsageToday.byProvider) {
        lines.push(
          `• ${row.provider}: ${row.requests} req | ${formatCompactNumber(row.inputTokens + row.outputTokens)} tokens | ${formatUsd(row.estimatedCostUsd)}`,
        );
      }
    }
  } else {
    lines.push("• AI usage hôm nay: chưa có dữ liệu");
  }

  if (report.updatedAtLabel) {
    lines.push("", `Cập nhật: ${report.updatedAtLabel}`);
  }

  lines.push("", "_Dữ liệu tham khảo nội bộ, không phải khuyến nghị đầu tư._");
  return lines.join("\n");
}
