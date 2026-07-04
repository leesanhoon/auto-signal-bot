import { fetchFixtureOdds, fetchPredictions } from "./betting-api.js";
import { extractCorrectScore } from "./correct-score-api.js";
import type { ApiFootballFixture, MatchInfo, MatchOddsPayload, MatchPrediction } from "./betting-types.js";
import { compactOdds } from "./odds-compact.js";
import { vnDateStr, vnTimeStr } from "../shared/vn-time.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("betting:betting");
export function extractMatches(raw: unknown): MatchInfo[] {
  const fixtures = (raw as { response?: ApiFootballFixture[] } | undefined)?.response ?? [];
  return fixtures
    .filter((f) => f.teams.home.name && f.teams.away.name)
    .map((f) => {
      const kickoffUnix = Math.floor(new Date(f.fixture.date).getTime() / 1000);
      return {
        gameId: String(f.fixture.id),
        home: f.teams.home.name as string,
        away: f.teams.away.name as string,
        kickoffUnix,
        date: vnDateStr(kickoffUnix * 1000),
        kickoffTime: vnTimeStr(kickoffUnix * 1000),
      };
    });
}

/** Trong các trận CHƯA ĐÁ, lấy nhóm trận của ngày gần nhất sắp tới (ưu tiên hôm nay nếu còn trận). Lấy ít nhất 3 trận */
export function pickNearestUpcomingDateMatches(matches: MatchInfo[]): MatchInfo[] {
  if (matches.length === 0) return [];
  const nearestDate = matches.slice().sort((a, b) => a.kickoffUnix - b.kickoffUnix)[0].date;
  const filteredMatches = matches.filter((m) => m.date === nearestDate);
  return filteredMatches.length >= 3 ? filteredMatches : matches.slice(0, 3);
}

export type OddsFailure = { match: MatchInfo; message: string };

export async function buildOddsPayload(
  matches: MatchInfo[],
): Promise<{ payload: MatchOddsPayload[]; failures: OddsFailure[] }> {
  const results = await Promise.allSettled(
    matches.map(async (match) => {
      // Run API calls in parallel: odds + predictions
      const [fixtureOdds, prediction] = await Promise.all([
        fetchFixtureOdds(match.gameId),
        fetchPredictions(match.gameId),
      ]);

      if (!fixtureOdds || fixtureOdds.bets.length === 0) {
        throw new Error("Không có bookmaker nào cung cấp odds cho trận này");
      }

      const odds = compactOdds(fixtureOdds.bets, fixtureOdds.updateIso, match);
      const correctScore = extractCorrectScore(fixtureOdds.bets);

      logger.info(
        `  ✓ Lấy kèo (${odds.markets.length} market${correctScore.length > 0 ? " + Correct Score" : ""}${prediction ? " + Predictions" : ""}) ` +
          `từ ${fixtureOdds.bookmakerName}: ${match.home} vs ${match.away}`,
      );
      const payload: MatchOddsPayload = { ...match, odds };
      if (correctScore.length > 0) payload.correctScore = correctScore;
      if (prediction) payload.prediction = prediction as MatchPrediction;
      return payload;
    }),
  );

  const payload: MatchOddsPayload[] = [];
  const failures: OddsFailure[] = [];
  for (let i = 0; i < results.length; i++) {
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
}

