import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchInfo } from "../model/betting-types.js";
import { vnDateStr } from "../../shared/vn-time.js";

export function createMatchRepository(db: SupabaseClient) {
  return {
    async saveMatches(matches: MatchInfo[], now: number = Date.now()): Promise<void> {
      if (matches.length > 0) {
        const rows = matches.map((m) => ({
          game_id: m.gameId,
          date: m.date,
          home: m.home,
          away: m.away,
          kickoff_unix: m.kickoffUnix,
          kickoff_time: m.kickoffTime,
        }));
        const { error } = await (db.from("matches") as any).upsert(rows, { onConflict: "game_id" });
        if (error) throw new Error(`saveMatches upsert failed: ${error.message}`);
      }

      const { error: pruneError } = await (db.from("matches") as any).delete().lt("date", vnDateStr(now));
      if (pruneError) throw new Error(`saveMatches prune failed: ${pruneError.message}`);
    },

    async loadUpcomingMatches(now: number = Date.now()): Promise<MatchInfo[]> {
      const { data, error } = await (db.from("matches") as any)
        .select("game_id, date, home, away, kickoff_unix, kickoff_time")
        .gt("kickoff_unix", Math.floor(now / 1000));
      if (error || !data) return [];
      return (
        data as Array<{ game_id: string; date: string; home: string; away: string; kickoff_unix: number; kickoff_time: string }>
      )
        .sort((a, b) => a.kickoff_unix - b.kickoff_unix)
        .map((r) => ({
          gameId: r.game_id,
          date: r.date,
          home: r.home,
          away: r.away,
          kickoffUnix: r.kickoff_unix,
          kickoffTime: r.kickoff_time,
        }));
    },
  };
}

export type MatchRepository = ReturnType<typeof createMatchRepository>;
