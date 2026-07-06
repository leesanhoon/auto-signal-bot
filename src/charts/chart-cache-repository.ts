import { getDb } from "../shared/db.js";
import { createLogger } from "../shared/logger.js";
import type { AnalysisResult, TradeSetup } from "./chart-types.js";

const logger = createLogger("chart-cache-repository");

/** Lưu kết quả phân tích chart theo candle_key (upsert). */
export async function saveChartAnalysisCache(
  candleKey: string,
  result: AnalysisResult,
): Promise<void> {
  try {
    // Loại bỏ buffer (binary) khỏi screenshots trước khi lưu JSONB
    const serializable = {
      summaries: result.summaries,
      setups: result.setups,
      noSetupReason: result.noSetupReason,
      screenshots: result.screenshots.map((s) => ({
        chart: s.chart,
        filepath: s.filepath,
        lastPrice: s.lastPrice,
      })),
    };

    await (getDb().from("chart_analysis_cache") as any).upsert(
      { candle_key: candleKey, result: serializable, created_at: new Date().toISOString() },
      { onConflict: "candle_key" },
    );
  } catch {
    // Fail silently — không crash job vì lỗi lưu cache
  }
}

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

/**
 * Validate một cached result có đúng shape AnalysisResult không.
 * Check cả field top-level lẫn shape từng TradeSetup.
 */
export function isValidAnalysisResult(obj: unknown): obj is AnalysisResult {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (!Array.isArray(r.summaries) || !Array.isArray(r.setups) || !Array.isArray(r.screenshots)) return false;
  if (typeof r.noSetupReason !== "string" && r.noSetupReason !== undefined) return false;
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

/** Đọc kết quả phân tích chart theo candle_key. Trả null nếu không có hoặc lỗi DB. */
export async function loadChartAnalysisCache(
  candleKey: string,
): Promise<AnalysisResult | null> {
  try {
    const { data, error } = await (getDb().from("chart_analysis_cache") as any)
      .select("result")
      .eq("candle_key", candleKey)
      .maybeSingle();
    if (error || !data || !data.result) return null;

    const raw = data.result as Record<string, unknown>;
    if (!isValidAnalysisResult(raw)) {
      logger.warn("Cache schema invalid, treating as miss", { candleKey });
      return null;
    }

    const r = raw as AnalysisResult;
    return {
      summaries: r.summaries ?? [],
      setups: r.setups ?? [],
      noSetupReason: r.noSetupReason ?? "",
      screenshots: [], // Không có buffer thật — sendAllAnalyses sẽ skip gửi ảnh
    };
  } catch {
    return null;
  }
}