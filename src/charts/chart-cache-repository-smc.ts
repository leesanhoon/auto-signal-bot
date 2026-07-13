import { getDb } from "../shared/db.js";
import { createLogger } from "../shared/logger.js";
import type { ChartEngineMode, ChartTimeframeMode } from "./smc-config-env.js";
import type { ChartTimeframe } from "./chart-types-common.js";
import type { AnalysisResult, AnalysisStats, TradeSetup } from "./chart-types-smc.js";

const logger = createLogger("chart-cache-repository");

/** Lưu kết quả phân tích chart theo candle_key (upsert). */
export async function saveChartAnalysisCache(
  candleKey: string,
  result: AnalysisResult,
): Promise<void> {
  try {
    const serializable = {
      summaries: result.summaries,
      setups: result.setups,
      noSetupReason: result.noSetupReason,
      ...(result.analysisStats ? { analysisStats: result.analysisStats } : {}),
    };

    await (getDb().from("analysis_cache_smc") as any).upsert(
      { candle_key: candleKey, result: serializable, created_at: new Date().toISOString() },
      { onConflict: "candle_key" },
    );
  } catch {
    // Fail silently — không crash job vì lỗi lưu cache
  }
}

type ChartAnalysisCacheRow = {
  candle_key: string;
  result: unknown;
  created_at?: string | null;
};

/** Schema-driven field checks for TradeSetup fields. */
export const SETUP_FIELD_CHECKS: Array<{
  field: keyof TradeSetup;
  check: (v: unknown) => boolean;
}> = [
  { field: "pair", check: (v): v is string => typeof v === "string" },
  { field: "direction", check: (v) => v === "LONG" || v === "SHORT" },
  { field: "setup", check: (v) => typeof v === "string" },
  { field: "entry", check: (v) => typeof v === "string" },
  { field: "stopLoss", check: (v) => typeof v === "string" },
  { field: "takeProfit1", check: (v) => typeof v === "string" },
  { field: "takeProfit2", check: (v) => typeof v === "string" },
  { field: "confidence", check: (v) => typeof v === "number" },
  { field: "reasons", check: (v) => Array.isArray(v) },
  { field: "risks", check: (v) => Array.isArray(v) },
  { field: "riskReward", check: (v) => typeof v === "string" },
  { field: "summary", check: (v) => typeof v === "string" },
];

function isValidAnalysisStats(obj: unknown): obj is AnalysisStats {
  if (typeof obj !== "object" || obj === null) return false;
  const stats = obj as Record<string, unknown>;
  return (
    Number.isFinite(stats.attemptedPairs) &&
    Number.isFinite(stats.okPairs) &&
    Number.isFinite(stats.noSetupPairs) &&
    Number.isFinite(stats.skippedPairs) &&
    Number.isFinite(stats.setupCount)
  );
}

/**
 * Validate một cached result có đúng shape AnalysisResult không.
 * Check cả field top-level lẫn shape từng TradeSetup.
 */
export function isValidAnalysisResult(obj: unknown): obj is AnalysisResult {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (!Array.isArray(r.summaries) || !Array.isArray(r.setups)) return false;
  if (typeof r.noSetupReason !== "string" && r.noSetupReason !== undefined) return false;
  if (r.analysisStats !== undefined && !isValidAnalysisStats(r.analysisStats)) return false;
  // Validate each TradeSetup has required fields via schema-driven checks
  for (const s of r.setups) {
    if (typeof s !== "object" || s === null) return false;
    const setup = s as Record<string, unknown>;
    for (const { field, check } of SETUP_FIELD_CHECKS) {
      if (!check(setup[field])) return false;
    }
  }
  return true;
}

async function toCachedAnalysisResult(raw: unknown, candleKey: string): Promise<AnalysisResult | null> {
  if (!isValidAnalysisResult(raw)) {
    return null;
  }

  const r = raw as AnalysisResult;
  return {
    summaries: r.summaries ?? [],
    setups: r.setups ?? [],
    noSetupReason: r.noSetupReason ?? "",
    ...(r.analysisStats ? { analysisStats: r.analysisStats } : {}),
  };
}

async function loadChartAnalysisCacheRow(
  query: (db: ReturnType<typeof getDb>) => Promise<{ data: ChartAnalysisCacheRow | null; error: unknown }>,
): Promise<ChartAnalysisCacheRow | null> {
  try {
    const { data, error } = await query(getDb());
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/** Đọc kết quả phân tích chart theo candle_key. Trả null nếu không có hoặc lỗi DB. */
export async function loadChartAnalysisCache(
  candleKey: string,
): Promise<AnalysisResult | null> {
  const row = await loadChartAnalysisCacheRow(async (db) => {
    const response = await (db.from("analysis_cache_smc") as any)
      .select("result")
      .eq("candle_key", candleKey)
      .maybeSingle();
    return response;
  });

  if (!row?.result) return null;

  const result = await toCachedAnalysisResult(row.result, candleKey);
  if (!result) {
    logger.warn("Cache schema invalid, treating as miss", { candleKey });
    return null;
  }
  return result;
}

export async function loadLatestChartAnalysisCache(
  engineMode: ChartEngineMode,
  timeframeMode: ChartTimeframeMode = "multi",
  primaryTimeframe?: ChartTimeframe,
): Promise<{ candleKey: string; result: AnalysisResult } | null> {
  const suffix =
    timeframeMode === "single"
      ? `:${engineMode}:${timeframeMode}:${primaryTimeframe ?? "M15"}`
      : `:${engineMode}:${timeframeMode}`;
  const row = await loadChartAnalysisCacheRow(async (db) => {
    const response = await (db.from("analysis_cache_smc") as any)
      .select("candle_key, result, created_at")
      .ilike("candle_key", `%${suffix}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return response;
  });

  if (!row?.result || typeof row.candle_key !== "string") return null;

  const result = await toCachedAnalysisResult(row.result, row.candle_key);
  if (!result) {
    logger.warn("Latest cache schema invalid, treating as miss", {
      candleKey: row.candle_key,
      engineMode,
    });
    return null;
  }

  return {
    candleKey: row.candle_key,
    result,
  };
}
