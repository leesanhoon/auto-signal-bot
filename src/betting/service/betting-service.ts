import { extractCorrectScore } from "./correct-score-service.js";
import type { ApiFootballFixture, MatchInfo, MatchOddsPayload } from "../model/betting-types.js";
import { compactOdds } from "./odds-compact-service.js";
import { vnDateStr, vnTimeStr } from "../../shared/vn-time.js";
import { createLogger } from "../../shared/logger.js";
import type { BettingApiClient } from "../client/betting-api-client.js";

const logger = createLogger("betting:betting");

export function extractMatches(raw: unknown): MatchInfo[] {
  const fixtures = (raw as { response?: ApiFootballFixture[] } | undefined)?.response ?? [];
  return fixtures
    .filter((fixture) => fixture.teams.home.name && fixture.teams.away.name)
    .map((fixture) => {
      const kickoffUnix = Math.floor(new Date(fixture.fixture.date).getTime() / 1000);
      return {
        gameId: String(fixture.fixture.id),
        home: fixture.teams.home.name as string,
        away: fixture.teams.away.name as string,
        kickoffUnix,
        date: vnDateStr(kickoffUnix * 1000),
        kickoffTime: vnTimeStr(kickoffUnix * 1000),
      };
    });
}

export function pickNearestUpcomingDateMatches(matches: MatchInfo[]): MatchInfo[] {
  if (matches.length === 0) return [];
  const nearestDate = matches.slice().sort((left, right) => left.kickoffUnix - right.kickoffUnix)[0].date;
  const filteredMatches = matches.filter((match) => match.date === nearestDate);
  return filteredMatches.length >= 3 ? filteredMatches : matches.slice(0, 3);
}

export function pickNearestUpcomingMatch(matches: MatchInfo[]): MatchInfo | null {
  if (matches.length === 0) return null;
  return matches.reduce((nearest, match) => (match.kickoffUnix < nearest.kickoffUnix ? match : nearest));
}

export function pickNearestUpcomingMatches(matches: MatchInfo[]): MatchInfo[] {
  if (matches.length === 0) return [];
  const sorted = matches.slice().sort((left, right) => left.kickoffUnix - right.kickoffUnix);
  const nearest = sorted[0];
  return matches.filter((match) => match.date === nearest.date && match.kickoffTime === nearest.kickoffTime);
}

export type OddsFailure = { match: MatchInfo; message: string };

export function createBettingService(deps: { bettingApiClient: Pick<BettingApiClient, "fetchFixtureOdds"> }) {
  return {
    extractMatches,
    pickNearestUpcomingDateMatches,
    pickNearestUpcomingMatch,
    pickNearestUpcomingMatches,
    async buildOddsPayload(
      matches: MatchInfo[],
    ): Promise<{ payload: MatchOddsPayload[]; failures: OddsFailure[] }> {
      const results = await Promise.allSettled(
        matches.map(async (match) => {
          const fixtureOdds = await deps.bettingApiClient.fetchFixtureOdds(match.gameId);

          if (!fixtureOdds || fixtureOdds.bets.length === 0) {
            throw new Error("Không có bookmaker nào cung cấp odds cho trận này");
          }

          const odds = compactOdds(fixtureOdds.bets, fixtureOdds.updateIso, match);
          const correctScore = extractCorrectScore(fixtureOdds.bets);

          logger.info(
            `  ✓ Lấy kèo (${odds.markets.length} market${correctScore.length > 0 ? " + Correct Score" : ""}) ` +
              `từ ${fixtureOdds.bookmakerName}: ${match.home} vs ${match.away}`,
          );
          const payload: MatchOddsPayload = { ...match, odds };
          if (correctScore.length > 0) payload.correctScore = correctScore;
          return payload;
        }),
      );

      const payload: MatchOddsPayload[] = [];
      const failures: OddsFailure[] = [];
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        if (result.status === "fulfilled") {
          payload.push(result.value);
        } else {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          logger.warn(`  ⚠ Lỗi lấy kèo cho ${matches[i].home} vs ${matches[i].away}: ${message}`);
          failures.push({ match: matches[i], message });
        }
      }

      return { payload, failures };
    },
  };
}

export type BettingService = ReturnType<typeof createBettingService>;
