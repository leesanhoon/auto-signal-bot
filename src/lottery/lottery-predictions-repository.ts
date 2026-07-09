import { getDb } from "../shared/db.js";
import { ENSEMBLE_METHOD_VERSION } from "./lottery-ensemble-predict.js";
import type { EnsembleNumberPrediction, MethodBreakdown } from "./lottery-ensemble-predict.js";
import type { LotteryRegion } from "./lottery-types.js";

export type PredictionRow = {
  date: string;
  weekday: number;
  region: LotteryRegion;
  number: string;
  rank: number;
};

export type CachedPrediction = {
  number: string;
  confidence: number;
  reason: string;
  rank: number;
  breakdown: MethodBreakdown;
};

/**
 * Lưu lại top N dự đoán của 1 miền/ngày vào `lottery_predictions` (upsert, dedup theo date+region+number).
 * Xoá trước các số CŨ của đúng date+region mà không còn nằm trong top N lần này — tránh sót rác/rank
 * trùng nếu chạy lại nhiều lần trong ngày và bộ số top-N thay đổi giữa các lần chạy.
 */
export async function savePredictions(
  date: string,
  weekday: number,
  region: LotteryRegion,
  predictions: EnsembleNumberPrediction[],
): Promise<void> {
  if (predictions.length === 0) return;

  const numbers = predictions.map((p) => p.number);
  const { error: deleteError } = await (getDb().from("lottery_predictions") as any)
    .delete()
    .eq("date", date)
    .eq("region", region)
    .not("number", "in", `(${numbers.join(",")})`);
  if (deleteError) throw new Error(`savePredictions cleanup failed: ${deleteError.message}`);

  const rows = predictions.map((p, i) => ({
    date,
    weekday,
    region,
    number: p.number,
    rank: i + 1,
    reason: p.reason,
    freq: null,
    weighted_freq: null,
    gap: null,
    overdue_ratio: null,
    score: p.confidence,
    method_scores: p.breakdown,
    method_version: ENSEMBLE_METHOD_VERSION,
  }));

  const { error } = await (getDb().from("lottery_predictions") as any).upsert(rows, { onConflict: "date,region,number" });
  if (error) throw new Error(`savePredictions upsert failed: ${error.message}`);
}

/** Lấy các dự đoán chưa được xác minh (`verified_at is null`) của đúng ngày + miền. */
export async function loadUnverifiedPredictions(date: string, region: LotteryRegion): Promise<PredictionRow[]> {
  const { data, error } = await (getDb().from("lottery_predictions") as any)
    .select("date, weekday, region, number, rank")
    .eq("date", date)
    .eq("region", region)
    .is("verified_at", null)
    .order("rank", { ascending: true });
  if (error || !data) return [];
  return data as PredictionRow[];
}

/** Đọc dự đoán đã lưu cho đúng date+region — dùng để tái sử dụng thay vì tính lại trong cùng ngày. */
export async function loadCachedPredictions(
  date: string,
  region: LotteryRegion,
): Promise<CachedPrediction[]> {
  try {
    const { data, error } = await (getDb().from("lottery_predictions") as any)
      .select("number, score, reason, rank, method_scores")
      .eq("date", date)
      .eq("region", region)
      .eq("method_version", ENSEMBLE_METHOD_VERSION)
      .order("rank", { ascending: true });
    if (error || !data || data.length === 0) return [];

    return (data as Array<{
      number: string;
      score: number | null;
      reason: string | null;
      rank: number | null;
      method_scores: unknown;
    }>)
      .filter((row) => row.reason != null && row.score != null && row.rank != null)
      .map((row) => {
        // Parse method_scores from jsonb column; fallback to {} if missing/invalid
        let breakdown: MethodBreakdown = {};
        if (row.method_scores && typeof row.method_scores === "object") {
          breakdown = row.method_scores as MethodBreakdown;
        }

        return {
          number: row.number,
          confidence: Number(row.score),
          reason: String(row.reason),
          rank: Number(row.rank),
          breakdown,
        };
      });
  } catch {
    return [];
  }
}

/** Đánh dấu 1 dự đoán đã được xác minh, kèm kết quả trúng/không trúng. */
export async function markPredictionVerified(
  date: string,
  region: LotteryRegion,
  number: string,
  hit: boolean,
  matchedProvince?: string,
  matchedPrize?: string,
  hit2?: boolean,
  matchedProvince2?: string,
  matchedPrize2?: string,
): Promise<void> {
  const { error } = await (getDb().from("lottery_predictions") as any)
    .update({
      verified_at: new Date().toISOString(),
      hit,
      matched_province: matchedProvince ?? null,
      matched_prize: matchedPrize ?? null,
      hit2: hit2 ?? null,
      matched_province_2: matchedProvince2 ?? null,
      matched_prize_2: matchedPrize2 ?? null,
    })
    .eq("date", date)
    .eq("region", region)
    .eq("number", number);
  if (error) throw new Error(`markPredictionVerified update failed: ${error.message}`);
}
