import { fetchEventMarketKeys, fetchEventFullOdds } from "./betting-api.js";
import type { MatchInfo, MatchOddsPayload, OddsApiEvent } from "./betting-types.js";

/**
 * Market không cần thiết cho phân tích S1: h2h_3_way trùng hoàn toàn với h2h;
 * các market player_* là kèo cầu thủ (ngoài phạm vi), trong đó player_shots/
 * player_shots_on_target chiếm nhiều outcomes nhất (~295) nhưng không liên quan.
 */
const EXCLUDED_MARKETS = new Set([
  "h2h_3_way",
  "player_first_goal_scorer",
  "player_last_goal_scorer",
  "player_goal_scorer_anytime",
  "player_goals_alternate",
  "player_goalie_saves_alternate",
  "player_shots",
  "player_shots_on_target",
]);

export function extractMatches(raw: unknown): MatchInfo[] {
  const events = (raw as OddsApiEvent[] | undefined) ?? [];
  return events.map((e) => ({
    gameId: e.id,
    home: e.home_team,
    away: e.away_team,
    kickoffUnix: Math.floor(new Date(e.commence_time).getTime() / 1000),
  }));
}

export function filterUpcomingWithin(
  matches: MatchInfo[],
  hours: number,
  now: number = Date.now(),
): MatchInfo[] {
  const windowMs = hours * 60 * 60 * 1000;
  return matches.filter((m) => {
    const diff = m.kickoffUnix * 1000 - now;
    return diff > 0 && diff <= windowMs;
  });
}

export type OddsFailure = { match: MatchInfo; message: string };

export async function buildOddsPayload(
  matches: MatchInfo[],
): Promise<{ payload: MatchOddsPayload[]; failures: OddsFailure[] }> {
  const payload: MatchOddsPayload[] = [];
  const failures: OddsFailure[] = [];

  for (const match of matches) {
    try {
      const allMarketKeys = await fetchEventMarketKeys(match.gameId);
      const marketKeys = allMarketKeys.filter((key) => !EXCLUDED_MARKETS.has(key));
      if (marketKeys.length === 0) {
        throw new Error("Không dò được market nào từ bookmaker");
      }

      const odds = (await fetchEventFullOdds(match.gameId, marketKeys)) as OddsApiEvent;
      payload.push({ ...match, odds });
      console.log(`  ✓ Lấy kèo (${marketKeys.length} market): ${match.home} vs ${match.away}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ⚠ Lỗi lấy kèo cho ${match.home} vs ${match.away}: ${message}`);
      failures.push({ match, message });
    }
  }

  return { payload, failures };
}
