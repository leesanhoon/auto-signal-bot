import type { FixtureResult } from "../client/betting-api-client.js";
import type { BettingAnalysisSnapshot } from "../repository/betting-analysis-repository.js";

export type BettingBacktestRow = {
  gameId: string;
  home: string;
  away: string;
  preferredScoreline: string;
  actualScoreline: string;
  hit: boolean;
  scoreConfidence: number;
};

export type BettingBacktestReport = {
  evaluated: number;
  hits: number;
  hitRate: number;
  averageScoreConfidence: number;
  rows: BettingBacktestRow[];
};

function normalizeScoreline(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, "");
  const match = trimmed.match(/^(\d+)[-:](\d+)$/);
  if (!match) return null;
  return `${Number(match[1])}-${Number(match[2])}`;
}

function actualScoreline(result: FixtureResult): string | null {
  if (result.goalsHome === null || result.goalsAway === null) return null;
  return `${result.goalsHome}-${result.goalsAway}`;
}

export function runBettingBacktest(
  snapshots: BettingAnalysisSnapshot[],
  results: FixtureResult[],
): BettingBacktestReport {
  const resultByGameId = new Map(results.map((result) => [result.fixtureId, result]));
  const rows: BettingBacktestRow[] = [];

  for (const snapshot of snapshots) {
    const scoreline = normalizeScoreline(snapshot.analysis.preferredScoreline);
    const result = resultByGameId.get(snapshot.gameId);
    const actual = result ? actualScoreline(result) : null;
    if (!scoreline || !actual) continue;

    rows.push({
      gameId: snapshot.gameId,
      home: snapshot.home,
      away: snapshot.away,
      preferredScoreline: scoreline,
      actualScoreline: actual,
      hit: scoreline === actual,
      scoreConfidence: snapshot.analysis.scoreConfidence,
    });
  }

  const evaluated = rows.length;
  const hits = rows.filter((row) => row.hit).length;
  const averageScoreConfidence =
    evaluated === 0 ? 0 : Math.round((rows.reduce((sum, row) => sum + row.scoreConfidence, 0) / evaluated) * 100) / 100;

  return {
    evaluated,
    hits,
    hitRate: evaluated === 0 ? 0 : Math.round((hits / evaluated) * 10000) / 100,
    averageScoreConfidence,
    rows,
  };
}
