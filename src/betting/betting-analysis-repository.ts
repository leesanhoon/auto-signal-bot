import { getDb } from "../shared/db.js";
import type { MatchAiAnalysis, MatchOddsPayload, CombinedAnalysisPlan } from "./betting-types.js";

export type BettingAnalysisSnapshot = {
  id?: number;
  gameId: string;
  date: string;
  home: string;
  away: string;
  kickoffUnix: number;
  odds: MatchOddsPayload["odds"];
  correctScore: MatchOddsPayload["correctScore"] | null;
  analysis: MatchAiAnalysis;
  verifiedConfirmed: boolean | null;
  verifiedConfidence: number | null;
  verifiedComment: string | null;
  revisedAfterReject: boolean;
  createdAt?: string;
};

/** Tái dùng cho cả loadBettingAnalysisSnapshots và loadRecentSnapshotsByGameIds. */
function mapSnapshotRow(row: {
  id: number;
  game_id: string;
  date: string;
  home: string;
  away: string;
  kickoff_unix: number;
  odds: MatchOddsPayload["odds"];
  correct_score: MatchOddsPayload["correctScore"] | null;
  analysis: MatchAiAnalysis;
  verified_confirmed: boolean | null;
  verified_confidence: number | null;
  verified_comment: string | null;
  revised_after_reject: boolean;
  created_at: string;
}): BettingAnalysisSnapshot {
  return {
    id: row.id,
    gameId: row.game_id,
    date: row.date,
    home: row.home,
    away: row.away,
    kickoffUnix: row.kickoff_unix,
    odds: row.odds,
    correctScore: row.correct_score,
    analysis: row.analysis,
    verifiedConfirmed: row.verified_confirmed,
    verifiedConfidence: row.verified_confidence,
    verifiedComment: row.verified_comment,
    revisedAfterReject: row.revised_after_reject,
    createdAt: row.created_at,
  };
}

export async function saveBettingAnalysisSnapshot(
  snapshot: BettingAnalysisSnapshot,
): Promise<void> {
  const { error } = await (
    getDb().from("betting_analysis_snapshots") as any
  ).upsert(
    {
      game_id: snapshot.gameId,
      date: snapshot.date,
      home: snapshot.home,
      away: snapshot.away,
      kickoff_unix: snapshot.kickoffUnix,
      odds: snapshot.odds,
      correct_score: snapshot.correctScore ?? null,
      analysis: snapshot.analysis,
      verified_confirmed: snapshot.verifiedConfirmed,
      verified_confidence: snapshot.verifiedConfidence,
      verified_comment: snapshot.verifiedComment,
      revised_after_reject: snapshot.revisedAfterReject,
            created_at: new Date().toISOString(),
          },
    { onConflict: "game_id" },
  );

  if (error)
    throw new Error(`saveBettingAnalysisSnapshot failed: ${error.message}`);
}

export async function loadBettingAnalysisSnapshots(
  sinceDate?: string,
): Promise<BettingAnalysisSnapshot[]> {
  let query = (getDb().from("betting_analysis_snapshots") as any)
    .select(
      "id, game_id, date, home, away, kickoff_unix, odds, correct_score, analysis, verified_confirmed, verified_confidence, verified_comment, revised_after_reject, created_at",
    )
    .order("kickoff_unix", { ascending: true });

  if (sinceDate) {
    query = query.gte("date", sinceDate);
  }

  const { data, error } = await query;
  if (error)
    throw new Error(`loadBettingAnalysisSnapshots failed: ${error.message}`);

  return ((data ?? []) as Parameters<typeof mapSnapshotRow>[0][]).map(mapSnapshotRow);
}

/**
 * Đọc các snapshot đã lưu cho đúng tập gameId, chỉ lấy những cái tạo trong vòng `withinMs` gần đây.
 * Dùng làm cache 30 phút — tránh gọi lại AI nếu tất cả trận đều đã được phân tích gần đây.
 * Nếu gameIds rỗng hoặc lỗi DB, trả mảng rỗng (coi như cache miss) — KHÔNG throw.
 */
export async function loadRecentSnapshotsByGameIds(
  gameIds: string[],
  withinMs: number,
): Promise<BettingAnalysisSnapshot[]> {
  if (gameIds.length === 0) return [];
  try {
    const sinceIso = new Date(Date.now() - withinMs).toISOString();
    const { data, error } = await (getDb().from("betting_analysis_snapshots") as any)
      .select("id, game_id, date, home, away, kickoff_unix, odds, correct_score, analysis, verified_confirmed, verified_confidence, verified_comment, revised_after_reject, created_at")
      .in("game_id", gameIds)
      .gte("created_at", sinceIso);
    if (error || !data) return [];
    return (data as Parameters<typeof mapSnapshotRow>[0][]).map(mapSnapshotRow);
  } catch {
    return [];
  }
}

/**
 * Lưu kế hoạch đặt cược (parlay + kèo đơn) cho ngày cụ thể.
 * Dùng `date` làm primary key — chỉ 1 plan per ngày.
 * Luôn refresh `created_at` mỗi lần lưu (kể cả upsert) để theo dõi khi nào plan được cập nhật lần cuối.
 */
export async function savePlanCache(
  date: string,
  gameIds: string[],
  plan: CombinedAnalysisPlan,
): Promise<void> {
  const { error } = await (getDb().from("betting_plan_cache") as any).upsert(
    {
      date,
      game_ids: gameIds,
      plan,
      created_at: new Date().toISOString(),
    },
    { onConflict: "date" },
  );

  if (error) throw new Error(`savePlanCache failed: ${error.message}`);
}

/**
 * Đọc plan cache cho ngày hôm nay (hoặc ngày vừa chỉ định), nếu:
 * - Tồn tại trong DB
 * - Được tạo trong vòng `withinMs` gần đây
 * - Tập gameIds khớp hoàn toàn với tập đang cần (cùng số lượng, cùng các id)
 * Nếu lỗi DB, gameIds không khớp, hoặc hết hạn → trả null (coi như cache miss) — KHÔNG throw.
 */
export async function loadRecentPlanCache(
  date: string,
  gameIds: string[],
  withinMs: number,
): Promise<CombinedAnalysisPlan | null> {
  if (gameIds.length === 0) return null;
  try {
    const sinceIso = new Date(Date.now() - withinMs).toISOString();
    const { data, error } = await (getDb().from("betting_plan_cache") as any)
      .select("plan, game_ids, created_at")
      .eq("date", date)
      .gte("created_at", sinceIso);

    if (error || !data || data.length === 0) return null;

    const row = data[0];
    const cachedGameIds = row.game_ids ?? [];
    const sortedCached = [...cachedGameIds].sort();
    const sortedNeeded = [...gameIds].sort();

    // Kiểm tra tập gameIds khớp nhau
    if (
      sortedCached.length !== sortedNeeded.length ||
      !sortedCached.every((id, i) => id === sortedNeeded[i])
    ) {
      return null; // gameIds không khớp → cache miss
    }

    return row.plan as CombinedAnalysisPlan;
  } catch {
    return null;
  }
}
