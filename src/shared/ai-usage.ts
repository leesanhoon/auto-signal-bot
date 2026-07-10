import { getDb } from "./db.js";
import { createLogger } from "./logger.js";
import { sendMessage } from "./telegram-client.js";
import { vnDateStr } from "./vn-time.js";

const logger = createLogger("shared:ai-usage");

export type AiProvider = "gemini" | "claude" | "openrouter";
export type AiUsageSource = "chart" | "betting" | "lottery" | "test";

export type AiUsageRecord = {
  recordedAt: string;
  usageDate: string;
  provider: AiProvider;
  model: string;
  source: AiUsageSource;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  metadata: Record<string, unknown>;
};

export type AiUsageDailyBreakdownRow = {
  key: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type AiUsageDailySummary = {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  byProvider: AiUsageDailyBreakdownRow[];
  bySource: AiUsageDailyBreakdownRow[];
  byModel: AiUsageDailyBreakdownRow[];
};

export type GeminiUsageResponseLike = {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    toolUsePromptTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

export type ClaudeUsageResponseLike = {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

export type OpenRouterUsageResponseLike = {
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
  };
};

export type AiUsageInput = {
  provider: AiProvider;
  model: string;
  source: AiUsageSource;
  inputTokens: number;
  outputTokens: number;
  recordedAt?: string | Date;
  metadata?: Record<string, unknown>;
  estimatedCostUsd?: number;
};

export type AiUsageAlertConfig = {
  dailyTokenLimit?: number;
  dailyCostLimitUsd?: number;
  thresholdRatio?: number;
};

type Rate = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

const DEFAULT_RATES: Record<AiProvider, Record<string, Rate>> = {
  gemini: {
    "gemini-2.5-pro": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
    "gemini-2.5-flash": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
    "gemini-3.5-flash": { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  },
  claude: {
    "claude-sonnet-4-6": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  },
  openrouter: {
    "xiaomi/mimo-v2.5": {
      inputPerMillionUsd: 0.105,
      outputPerMillionUsd: 0.28,
    },
    "deepseek/deepseek-v4-flash": {
      inputPerMillionUsd: 0.09,
      outputPerMillionUsd: 0.18,
    },
    "minimax/minimax-m3": { inputPerMillionUsd: 0.3, outputPerMillionUsd: 1.2 },
    "meta-llama/llama-3.3-70b-instruct": {
      inputPerMillionUsd: 0.12,
      outputPerMillionUsd: 0.34,
    },
    "moonshotai/kimi-k2.6": {
      inputPerMillionUsd: 0.3,
      outputPerMillionUsd: 1.2,
    },
  },
};

const alertedKeys = new Set<string>();

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

function getDefaultRate(provider: AiProvider, model: string): Rate {
  const normalizedModel = normalizeModel(model);
  return (
    DEFAULT_RATES[provider][normalizedModel] ??
    (provider === "gemini"
      ? DEFAULT_RATES.gemini["gemini-3.5-flash"]
      : provider === "claude"
        ? DEFAULT_RATES.claude["claude-sonnet-4-6"]
        : DEFAULT_RATES.openrouter["xiaomi/mimo-v2.5"])
  );
}

function getAlertConfig(): AiUsageAlertConfig {
  return {
    dailyTokenLimit: parseOptionalNumber(
      process.env.AI_USAGE_DAILY_TOKEN_LIMIT,
    ),
    dailyCostLimitUsd: parseOptionalNumber(
      process.env.AI_USAGE_DAILY_COST_LIMIT_USD,
    ),
    thresholdRatio:
      parseOptionalNumber(process.env.AI_USAGE_ALERT_THRESHOLD_RATIO) ?? 0.8,
  };
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function getBreakdownBucket<T extends string>(
  map: Map<
    T,
    {
      requests: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    }
  >,
  key: T,
) {
  const existing = map.get(key);
  if (existing) return existing;
  const created = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
  map.set(key, created);
  return created;
}

export function estimateAiUsageCost(
  provider: AiProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = getDefaultRate(provider, model);
  return roundMoney(
    (inputTokens / 1_000_000) * rate.inputPerMillionUsd +
      (outputTokens / 1_000_000) * rate.outputPerMillionUsd,
  );
}

export function extractGeminiUsage(response: GeminiUsageResponseLike): {
  inputTokens: number;
  outputTokens: number;
} {
  const usage = response.usageMetadata;
  const inputTokens = normalizeCount(usage?.promptTokenCount);
  const candidatesTokens = usage?.candidatesTokenCount;
  const totalTokens = normalizeCount(usage?.totalTokenCount);
  const toolTokens = normalizeCount(usage?.toolUsePromptTokenCount);
  const thoughtsTokens = normalizeCount(usage?.thoughtsTokenCount);
  const fallbackOutput = Math.max(
    0,
    totalTokens - inputTokens - toolTokens - thoughtsTokens,
  );

  return {
    inputTokens,
    outputTokens: normalizeCount(candidatesTokens ?? fallbackOutput),
  };
}

export function extractClaudeUsage(response: ClaudeUsageResponseLike): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: normalizeCount(response.usage?.input_tokens),
    outputTokens: normalizeCount(response.usage?.output_tokens),
  };
}

export function extractOpenRouterUsage(response: OpenRouterUsageResponseLike): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
} {
  return {
    inputTokens: normalizeCount(response.usage?.promptTokens),
    outputTokens: normalizeCount(response.usage?.completionTokens),
    cachedTokens: normalizeCount(response.usage?.cachedTokens),
  };
}

export function aggregateAiUsageByDay(
  records: AiUsageRecord[],
): AiUsageDailySummary[] {
  const dayMap = new Map<
    string,
    {
      requests: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
      byProvider: Map<
        AiProvider,
        {
          requests: number;
          inputTokens: number;
          outputTokens: number;
          estimatedCostUsd: number;
        }
      >;
      bySource: Map<
        AiUsageSource,
        {
          requests: number;
          inputTokens: number;
          outputTokens: number;
          estimatedCostUsd: number;
        }
      >;
      byModel: Map<
        string,
        {
          requests: number;
          inputTokens: number;
          outputTokens: number;
          estimatedCostUsd: number;
        }
      >;
    }
  >();

  for (const record of records) {
    const existing = dayMap.get(record.usageDate) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      byProvider: new Map(),
      bySource: new Map(),
      byModel: new Map(),
    };

    existing.requests += 1;
    existing.inputTokens += record.inputTokens;
    existing.outputTokens += record.outputTokens;
    existing.estimatedCostUsd = roundMoney(
      existing.estimatedCostUsd + record.estimatedCostUsd,
    );

    const providerBucket = getBreakdownBucket(
      existing.byProvider,
      record.provider,
    );
    providerBucket.requests += 1;
    providerBucket.inputTokens += record.inputTokens;
    providerBucket.outputTokens += record.outputTokens;
    providerBucket.estimatedCostUsd = roundMoney(
      providerBucket.estimatedCostUsd + record.estimatedCostUsd,
    );

    const sourceBucket = getBreakdownBucket(existing.bySource, record.source);
    sourceBucket.requests += 1;
    sourceBucket.inputTokens += record.inputTokens;
    sourceBucket.outputTokens += record.outputTokens;
    sourceBucket.estimatedCostUsd = roundMoney(
      sourceBucket.estimatedCostUsd + record.estimatedCostUsd,
    );

    const modelBucket = getBreakdownBucket(existing.byModel, record.model);
    modelBucket.requests += 1;
    modelBucket.inputTokens += record.inputTokens;
    modelBucket.outputTokens += record.outputTokens;
    modelBucket.estimatedCostUsd = roundMoney(
      modelBucket.estimatedCostUsd + record.estimatedCostUsd,
    );

    dayMap.set(record.usageDate, existing);
  }

  return [...dayMap.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, bucket]) => ({
      date,
      requests: bucket.requests,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      estimatedCostUsd: bucket.estimatedCostUsd,
      byProvider: [...bucket.byProvider.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key)),
      bySource: [...bucket.bySource.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key)),
      byModel: [...bucket.byModel.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key)),
    }));
}

export function buildAiUsageAlertMessage(
  summary: AiUsageDailySummary,
  config: AiUsageAlertConfig = getAlertConfig(),
): string | null {
  const thresholds: string[] = [];
  const ratio = config.thresholdRatio ?? 0.8;

  if (config.dailyTokenLimit && config.dailyTokenLimit > 0) {
    const tokenRatio = summary.inputTokens + summary.outputTokens;
    if (tokenRatio >= config.dailyTokenLimit * ratio) {
      thresholds.push(
        `token ${tokenRatio}/${config.dailyTokenLimit} (${((tokenRatio / config.dailyTokenLimit) * 100).toFixed(1)}%)`,
      );
    }
  }

  if (config.dailyCostLimitUsd && config.dailyCostLimitUsd > 0) {
    if (summary.estimatedCostUsd >= config.dailyCostLimitUsd * ratio) {
      thresholds.push(
        `chi phí ${formatUsd(summary.estimatedCostUsd)}/${formatUsd(config.dailyCostLimitUsd)} (${((summary.estimatedCostUsd / config.dailyCostLimitUsd) * 100).toFixed(1)}%)`,
      );
    }
  }

  if (thresholds.length === 0) {
    return null;
  }

  const lines = [
    `⚠️ Cảnh báo mức dùng AI ngày ${summary.date}`,
    `Yêu cầu: ${summary.requests}`,
    `Token: ${summary.inputTokens + summary.outputTokens} tổng cộng`,
    `Chi phí ước tính: ${formatUsd(summary.estimatedCostUsd)}`,
    `Ngưỡng chạm tới: ${thresholds.join(" | ")}`,
  ];

  if (summary.byProvider.length > 0) {
    lines.push("", "Theo provider:");
    for (const row of summary.byProvider) {
      lines.push(
        `- ${row.key}: ${row.requests} req | ${row.inputTokens + row.outputTokens} token | ${formatUsd(row.estimatedCostUsd)}`,
      );
    }
  }

  if (summary.bySource.length > 0) {
    lines.push("", "Theo nguồn:");
    for (const row of summary.bySource) {
      lines.push(
        `- ${row.key}: ${row.requests} req | ${row.inputTokens + row.outputTokens} token | ${formatUsd(row.estimatedCostUsd)}`,
      );
    }
  }

  return lines.join("\n");
}

export async function loadAiUsageRecords(
  sinceDate?: string,
): Promise<AiUsageRecord[]> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    return [];
  }

  try {
    let query = (getDb().from("ai_usage") as any).select(
      "recorded_at, usage_date, provider, model, source, input_tokens, output_tokens, estimated_cost_usd, metadata",
    );
    if (sinceDate) {
      query = query.gte("usage_date", sinceDate);
    }

    const { data, error } = await query
      .order("usage_date", { ascending: false })
      .order("recorded_at", { ascending: false });
    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      recordedAt: String(row.recorded_at ?? new Date().toISOString()),
      usageDate: String(row.usage_date ?? vnDateStr(Date.now())),
      provider:
        row.provider === "openrouter"
          ? "openrouter"
          : row.provider === "claude"
            ? "claude"
            : "gemini",
      model: String(row.model ?? ""),
      source:
        row.source === "betting" ||
        row.source === "lottery" ||
        row.source === "test"
          ? row.source
          : "chart",
      inputTokens: normalizeCount(row.input_tokens),
      outputTokens: normalizeCount(row.output_tokens),
      estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    }));
  } catch (error) {
    logger.warn("Failed to load AI usage rows from Supabase", { error });
    return [];
  }
}

export async function loadAiUsageDailySummary(
  sinceDate?: string,
): Promise<AiUsageDailySummary[]> {
  return aggregateAiUsageByDay(await loadAiUsageRecords(sinceDate));
}

async function maybeSendAiUsageAlert(
  summary: AiUsageDailySummary,
): Promise<void> {
  const config = getAlertConfig();
  const message = buildAiUsageAlertMessage(summary, config);
  if (!message) return;

  const alertKey = `${summary.date}:${config.dailyTokenLimit ?? "na"}:${config.dailyCostLimitUsd ?? "na"}:${config.thresholdRatio ?? 0.8}`;
  if (alertedKeys.has(alertKey)) return;
  alertedKeys.add(alertKey);

  try {
    await sendMessage(message);
  } catch (error) {
    logger.warn("Failed to send AI usage alert", { error });
  }
}

export async function recordAiUsage(input: AiUsageInput): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    return;
  }

  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
  const recordedAtIso = recordedAt.toISOString();
  const usageDate = vnDateStr(recordedAt.getTime());
  const inputTokens = normalizeCount(input.inputTokens);
  const outputTokens = normalizeCount(input.outputTokens);
  const estimatedCostUsd = roundMoney(
    input.estimatedCostUsd ??
      estimateAiUsageCost(
        input.provider,
        input.model,
        inputTokens,
        outputTokens,
      ),
  );

  try {
    const { error } = await ((getDb().from("ai_usage") as any).insert({
      recorded_at: recordedAtIso,
      usage_date: usageDate,
      provider: input.provider,
      model: input.model,
      source: input.source,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimatedCostUsd,
      metadata: input.metadata ?? {},
    }) as Promise<{ error?: { message?: string } }>);

    if (error) {
      throw new Error(error.message ?? "Unknown Supabase insert error");
    }
  } catch (error) {
    logger.warn("Failed to persist AI usage entry", {
      error,
      provider: input.provider,
      model: input.model,
      source: input.source,
    });
    return;
  }

  const todaySummary = (await loadAiUsageDailySummary(usageDate)).find(
    (row) => row.date === usageDate,
  );
  if (todaySummary) {
    await maybeSendAiUsageAlert(todaySummary);
  }
}

export async function recordGeminiUsage(
  response: GeminiUsageResponseLike,
  input: Omit<AiUsageInput, "provider" | "inputTokens" | "outputTokens"> & {
    provider?: "gemini";
  },
): Promise<void> {
  const usage = extractGeminiUsage(response);
  await recordAiUsage({
    provider: "gemini",
    model: input.model,
    source: input.source,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    recordedAt: input.recordedAt,
    metadata: input.metadata,
  });
}

export async function recordClaudeUsage(
  response: ClaudeUsageResponseLike,
  input: Omit<AiUsageInput, "provider" | "inputTokens" | "outputTokens"> & {
    provider?: "claude";
  },
): Promise<void> {
  const usage = extractClaudeUsage(response);
  await recordAiUsage({
    provider: "claude",
    model: input.model,
    source: input.source,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    recordedAt: input.recordedAt,
    metadata: input.metadata,
  });
}

export async function recordOpenRouterUsage(
  response: OpenRouterUsageResponseLike,
  input: Omit<AiUsageInput, "provider" | "inputTokens" | "outputTokens"> & {
    provider?: "openrouter";
  },
): Promise<void> {
  const usage = extractOpenRouterUsage(response);
  if (usage.inputTokens > 0 && usage.cachedTokens && usage.cachedTokens > 0) {
    logger.info("OpenRouter prompt cache hit", {
      model: input.model,
      cachedTokens: usage.cachedTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  }
  await recordAiUsage({
    provider: "openrouter",
    model: input.model,
    source: input.source,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    recordedAt: input.recordedAt,
    metadata: {
      ...(input.metadata ?? {}),
      cachedTokens: usage.cachedTokens,
    },
  });
}
