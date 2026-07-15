import { summarizeClosedPositionsPerformance, type ClosedPositionRecord } from "../charts/service/performance-tracking-volman.js";
import { vnDateStr } from "./vn-time.js";
import type { AiUsageDailySummary, StatsReport } from "./stats.js";
import type { AiProvider } from "./ai-usage.js";

export type StatsAiUsageRecord = {
  recordedAt: string;
  usageDate: string;
  provider: AiProvider;
  model: string;
  source: "chart" | "betting" | "lottery" | "test";
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  metadata: Record<string, unknown>;
};

export type BuildStatsReportInput = {
  openPositions: number;
  closedPositions: ClosedPositionRecord[];
  aiUsageRecords: StatsAiUsageRecord[];
  now?: Date;
  performanceWindowDays?: number;
};

function formatUpdatedAtLabel(now: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(now);
}

function aggregateStatsAiUsageByDay(records: StatsAiUsageRecord[]): Array<
  {
    date: string;
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
  }
> {
  const dayMap = new Map<
    string,
    {
      requests: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
      byProvider: Map<AiProvider, { requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number }>;
    }
  >();

  for (const record of records) {
    const existing = dayMap.get(record.usageDate) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      byProvider: new Map(),
    };

    existing.requests += 1;
    existing.inputTokens += record.inputTokens;
    existing.outputTokens += record.outputTokens;
    existing.estimatedCostUsd += record.estimatedCostUsd;

    const providerBucket = existing.byProvider.get(record.provider) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };
    providerBucket.requests += 1;
    providerBucket.inputTokens += record.inputTokens;
    providerBucket.outputTokens += record.outputTokens;
    providerBucket.estimatedCostUsd += record.estimatedCostUsd;
    existing.byProvider.set(record.provider, providerBucket);

    dayMap.set(record.usageDate, existing);
  }

  return Array.from(dayMap.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, bucket]) => ({
      date,
      requests: bucket.requests,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      estimatedCostUsd: bucket.estimatedCostUsd,
      byProvider: Array.from(bucket.byProvider.entries())
        .map(([provider, value]) => ({ provider, ...value }))
        .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider)),
    }));
}

function toStatsAiUsageSummary(summary: ReturnType<typeof aggregateStatsAiUsageByDay>[number]): AiUsageDailySummary {
  return {
    requests: summary.requests,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    estimatedCostUsd: summary.estimatedCostUsd,
    byProvider: summary.byProvider.map((row) => ({
      provider: row.provider,
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      estimatedCostUsd: row.estimatedCostUsd,
    })),
  };
}

export function buildStatsReport(input: BuildStatsReportInput): StatsReport {
  const now = input.now ?? new Date();
  const performanceWindowDays = input.performanceWindowDays ?? 7;
  const performanceWindowLabel = `${performanceWindowDays} ngày`;
  const startAt = new Date(now.getTime() - performanceWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const endAt = now.toISOString();
  const performanceReport = summarizeClosedPositionsPerformance(input.closedPositions, {
    periodLabel: performanceWindowLabel,
    startAt,
    endAt,
  });

  const today = vnDateStr(now.getTime());
  const usageByDay = aggregateStatsAiUsageByDay(input.aiUsageRecords);
  const todaySummary = usageByDay.find((row) => row.date === today);

  return {
    openPositions: input.openPositions,
    performanceWindowLabel,
    recentPerformance: performanceReport.portfolio,
    aiUsageToday: todaySummary ? toStatsAiUsageSummary(todaySummary) : null,
    updatedAtLabel: formatUpdatedAtLabel(now),
  };
}
