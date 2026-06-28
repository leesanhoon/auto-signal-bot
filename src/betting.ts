import { fetchFixtureOdds } from "./betting-api.js";
import { extractCorrectScore } from "./correct-score-api.js";
import type { ApiFootballFixture, MatchInfo, MatchOddsPayload } from "./betting-types.js";
import { compactOdds } from "./odds-compact.js";

export function extractMatches(raw: unknown): MatchInfo[] {
  const fixtures = (raw as { response?: ApiFootballFixture[] } | undefined)?.response ?? [];
  return fixtures
    .filter((f) => f.teams.home.name && f.teams.away.name)
    .map((f) => ({
      gameId: String(f.fixture.id),
      home: f.teams.home.name as string,
      away: f.teams.away.name as string,
      kickoffUnix: Math.floor(new Date(f.fixture.date).getTime() / 1000),
    }));
}

export function filterUpcomingWithin(
  matches: MatchInfo[],
  minutes: number,
  now: number = Date.now(),
): MatchInfo[] {
  const windowMs = minutes * 60 * 1000;
  return matches.filter((m) => {
    const diff = m.kickoffUnix * 1000 - now;
    return diff > 0 && diff <= windowMs;
  });
}

export function formatWindowLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} giờ` : `${hours.toFixed(2)} giờ`;
}

export type OddsFailure = { match: MatchInfo; message: string };

export async function buildOddsPayload(
  matches: MatchInfo[],
): Promise<{ payload: MatchOddsPayload[]; failures: OddsFailure[] }> {
  const payload: MatchOddsPayload[] = [];
  const failures: OddsFailure[] = [];

  for (const match of matches) {
    try {
      const fixtureOdds = await fetchFixtureOdds(match.gameId);
      if (!fixtureOdds || fixtureOdds.bets.length === 0) {
        throw new Error("Không có bookmaker nào cung cấp odds cho trận này");
      }

      const odds = compactOdds(fixtureOdds.bets, fixtureOdds.updateIso, match);
      const correctScore = extractCorrectScore(fixtureOdds.bets);

      payload.push({ ...match, odds, ...(correctScore.length > 0 ? { correctScore } : {}) });
      console.log(
        `  ✓ Lấy kèo (${odds.markets.length} market${correctScore.length > 0 ? " + Correct Score" : ""}) ` +
          `từ ${fixtureOdds.bookmakerName}: ${match.home} vs ${match.away}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ⚠ Lỗi lấy kèo cho ${match.home} vs ${match.away}: ${message}`);
      failures.push({ match, message });
    }
  }

  return { payload, failures };
}
