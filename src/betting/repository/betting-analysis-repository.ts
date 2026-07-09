import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchAiAnalysis, MatchOddsPayload } from "../model/betting-types.js";

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

export function createBettingAnalysisRepository(db: SupabaseClient) {
  return {
    async saveBettingAnalysisSnapshot(
      snapshot: BettingAnalysisSnapshot,
    ): Promise<void> {
      const { error } = await (
        db.from("betting_analysis_snapshots") as any
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

      if (error) {
        throw new Error(`saveBettingAnalysisSnapshot failed: ${error.message}`);
      }
    },

    async loadBettingAnalysisSnapshots(
      sinceDate?: string,
    ): Promise<BettingAnalysisSnapshot[]> {
      let query = (db.from("betting_analysis_snapshots") as any)
        .select(
          "id, game_id, date, home, away, kickoff_unix, odds, correct_score, analysis, verified_confirmed, verified_confidence, verified_comment, revised_after_reject, created_at",
        )
        .order("kickoff_unix", { ascending: true });

      if (sinceDate) {
        query = query.gte("date", sinceDate);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`loadBettingAnalysisSnapshots failed: ${error.message}`);
      }

      return ((data ?? []) as Parameters<typeof mapSnapshotRow>[0][]).map(mapSnapshotRow);
    },

    async loadRecentSnapshotsByGameIds(
      gameIds: string[],
      withinMs: number,
    ): Promise<BettingAnalysisSnapshot[]> {
      if (gameIds.length === 0) return [];
      try {
        const sinceIso = new Date(Date.now() - withinMs).toISOString();
        const { data, error } = await (db.from("betting_analysis_snapshots") as any)
          .select("id, game_id, date, home, away, kickoff_unix, odds, correct_score, analysis, verified_confirmed, verified_confidence, verified_comment, revised_after_reject, created_at")
          .in("game_id", gameIds)
          .gte("created_at", sinceIso);
        if (error || !data) return [];
        return (data as Parameters<typeof mapSnapshotRow>[0][]).map(mapSnapshotRow);
      } catch {
        return [];
      }
    },
  };
}

export type BettingAnalysisRepository = ReturnType<typeof createBettingAnalysisRepository>;
