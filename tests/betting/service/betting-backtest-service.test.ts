import { describe, expect, test } from "vitest";
import { runBettingBacktest } from "../../../src/betting/service/betting-backtest-service.js";

describe("betting/betting-backtest", () => {
  test("computes exact-score hit rate from snapshots and results", () => {
    const report = runBettingBacktest(
      [
        {
          gameId: "1",
          date: "2026-07-01",
          home: "Arsenal",
          away: "Chelsea",
          kickoffUnix: 1760000000,
          odds: { updatedUnix: 1760000000, legend: "demo", markets: [] },
          correctScore: null,
          analysis: {
            match: "Arsenal vs Chelsea",
            preferredScoreline: "2-1",
            scoreConfidence: 80,
            recommendation: "Theo Arsenal",
            confidence: 70,
            keyPoints: ["Edge"],
            risks: ["Risk"],
            summary: "Demo",
          },
          verifiedConfirmed: true,
          verifiedConfidence: 88,
          verifiedComment: "OK",
          revisedAfterReject: false,
        },
        {
          gameId: "2",
          date: "2026-07-02",
          home: "Liverpool",
          away: "City",
          kickoffUnix: 1760086400,
          odds: { updatedUnix: 1760086400, legend: "demo", markets: [] },
          correctScore: null,
          analysis: {
            match: "Liverpool vs City",
            preferredScoreline: "1-0",
            scoreConfidence: 65,
            recommendation: "Theo Liverpool",
            confidence: 60,
            keyPoints: ["Edge"],
            risks: ["Risk"],
            summary: "Demo",
          },
          verifiedConfirmed: false,
          verifiedConfidence: 55,
          verifiedComment: "Too weak",
          revisedAfterReject: true,
        },
      ],
      [
        { fixtureId: "1", home: "Arsenal", away: "Chelsea", kickoffUnix: 1760000000, date: "2026-07-01", statusShort: "FT", goalsHome: 2, goalsAway: 1 },
        { fixtureId: "2", home: "Liverpool", away: "City", kickoffUnix: 1760086400, date: "2026-07-02", statusShort: "FT", goalsHome: 1, goalsAway: 2 },
      ],
    );

    expect(report.evaluated).toBe(2);
    expect(report.hits).toBe(1);
    expect(report.hitRate).toBe(50);
    expect(report.averageScoreConfidence).toBe(72.5);
  });
});
