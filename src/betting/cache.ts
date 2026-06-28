import { getDb } from "../shared/db.js";
import type { MatchInfo } from "./betting-types.js";

/** Coi như trận đã đá xong, có thể xóa khỏi danh sách "đã gửi". */
const SENT_MARKER_GRACE_SECONDS = 2 * 60 * 60;

/** Danh sách trận chỉ refetch tối đa 1 lần mỗi ngày. */
const MATCHES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type MatchesCache = { fetchedAtUnix: number; matches: MatchInfo[] };

export async function loadDailyMatchesCache(): Promise<MatchesCache | null> {
  const { data, error } = await (getDb().from("matches_cache") as any)
    .select("fetched_at, matches")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { fetchedAtUnix: Math.floor(new Date(data.fetched_at as string).getTime() / 1000), matches: data.matches as MatchInfo[] };
}

/** Bảng chỉ giữ đúng 1 dòng (lần fetch mới nhất) — xoá hết dòng cũ trước khi ghi dòng mới. */
export async function saveDailyMatchesCache(matches: MatchInfo[], now: number = Date.now()): Promise<void> {
  const db = getDb();
  const { error: deleteError } = await (db.from("matches_cache") as any).delete().gte("id", 0);
  if (deleteError) throw new Error(`saveDailyMatchesCache cleanup failed: ${deleteError.message}`);

  const { error } = await (db.from("matches_cache") as any).insert({ fetched_at: new Date(now).toISOString(), matches });
  if (error) throw new Error(`saveDailyMatchesCache failed: ${error.message}`);
}

export function isDailyCacheValid(cache: MatchesCache | null, now: number = Date.now()): boolean {
  return cache !== null && now - cache.fetchedAtUnix * 1000 < MATCHES_CACHE_TTL_MS;
}

/**
 * Đánh dấu nhẹ — chỉ gameId + kickoffUnix + stage, không lưu odds — để biết 1 trận
 * đã gửi ở giai đoạn nào rồi: "periodic" (lấy sớm, mỗi 5h, trận trong 24h tới) và
 * "final" (lấy cuối, ngay trước kickoff) là 2 giai đoạn độc lập, mỗi trận gửi tối đa
 * 1 lần/giai đoạn — tổng cộng tối đa 2 lần gửi Telegram/trận.
 */
export type SentStage = "periodic" | "final";

export async function hasBeenSent(gameId: string, stage: SentStage): Promise<boolean> {
  const { data, error } = await getDb()
    .from("sent_matches")
    .select("game_id")
    .eq("game_id", gameId)
    .eq("stage", stage)
    .maybeSingle();
  return !error && data !== null;
}

export async function markMatchesSent(matches: MatchInfo[], stage: SentStage, now: number = Date.now()): Promise<void> {
  const db = getDb();
  const nowSeconds = now / 1000;

  // Tự dọn dần mỗi lần gọi — xoá dòng đã qua grace period, tránh bảng phình vô hạn.
  const { error: pruneError } = await (db.from("sent_matches") as any).delete().lt("kickoff_unix", nowSeconds - SENT_MARKER_GRACE_SECONDS);
  if (pruneError) throw new Error(`markMatchesSent prune failed: ${pruneError.message}`);

  if (matches.length === 0) return;
  const rows = matches
    .filter((m) => m.kickoffUnix + SENT_MARKER_GRACE_SECONDS >= nowSeconds)
    .map((m) => ({ game_id: m.gameId, kickoff_unix: m.kickoffUnix, stage, sent_at: new Date(now).toISOString() }));
  if (rows.length === 0) return;

  const { error } = await (db.from("sent_matches") as any).upsert(rows, { onConflict: "game_id,stage" });
  if (error) throw new Error(`markMatchesSent failed: ${error.message}`);
}
