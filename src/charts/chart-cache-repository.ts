import { getDb } from "../shared/db.js";
import type { AnalysisResult } from "./chart-types.js";

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

    const raw = data.result as {
      summaries: AnalysisResult["summaries"];
      setups: AnalysisResult["setups"];
      noSetupReason: string;
      screenshots: Array<{
        chart: AnalysisResult["screenshots"][number]["chart"];
        filepath: string;
        lastPrice: number | null;
      }>;
    };

    return {
      summaries: raw.summaries ?? [],
      setups: raw.setups ?? [],
      noSetupReason: raw.noSetupReason ?? "",
      screenshots: [], // Không có buffer thật — sendAllAnalyses sẽ skip gửi ảnh
    };
  } catch {
    return null;
  }
}