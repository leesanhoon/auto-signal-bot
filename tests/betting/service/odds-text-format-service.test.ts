import { describe, expect, test } from "vitest";

import {
  formatCachedAnalysisMessage,
  formatCombinedAnalysisMessage,
  formatCombinedOddsMessage,
  formatFullOddsAnalysisInput,
  formatMainOddsSummary,
  formatOddsAnalysisInput,
  formatOddsDataMessage,
  formatOddsFallbackMessage,
  formatOddsText,
  sortMatchOddsByKickoff,
} from "../../../src/betting/service/odds-text-format-service.js";
import type { MatchOddsPayload } from "../../../src/betting/model/betting-types.js";
import type { BettingAnalysisSnapshot } from "../../../src/betting/repository/betting-analysis-repository.js";

describe("betting/service/odds-text-format-service", () => {
  test("includes all markets and correct score", () => {
    const payload: MatchOddsPayload = {
      gameId: "1",
      home: "Belgium",
      away: "Senegal",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "long legend", markets: [{ key: "h2h", outcomes: [{ name: "H", price: 2.16 }, { name: "A", price: 3.76 }] }] },
      correctScore: [{ score: "1-0", price: 8.5 }],
    };

    const text = formatFullOddsAnalysisInput(payload);
    expect(text).toContain('"markets"');
    expect(text).toContain('"correctScore"');
    expect(text).toContain('"h2h"');
  });

  test("formatMainOddsSummary uses accented labels", () => {
    const payload: MatchOddsPayload = {
      gameId: "1",
      home: "Việt Nam",
      away: "Thái Lan",
      kickoffUnix: 0,
      odds: {
        updatedUnix: 0,
        legend: "",
        markets: [
          { key: "asia_handicap", outcomes: [{ name: "H", point: -0.25, price: 1.91 }, { name: "A", point: -0.25, price: 1.99 }] },
          { key: "asia_totals", outcomes: [{ name: "Over", point: 2.5, price: 1.87 }, { name: "Under", point: 2.5, price: 2.01 }] },
        ],
      },
    };

    const summary = formatMainOddsSummary(payload);
    expect(summary).toContain("Chấp -0.25");
    expect(summary).toContain("Tài/Xỉu 2.5");
  });

  test("formatOddsFallbackMessage uses accented fallback text", () => {
    const payload: MatchOddsPayload = {
      gameId: "1",
      home: "Việt Nam",
      away: "Thái Lan",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    };

    const fallback = formatOddsFallbackMessage(payload, "thiếu OPENROUTER_API_KEY");
    expect(fallback).toContain("AI tạm thời chưa phân tích được trận này");
  });

  test("formatOddsDataMessage uses current compact output", () => {
    const payload: MatchOddsPayload = {
      gameId: "1",
      home: "Việt Nam",
      away: "Thái Lan",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    };

    const dataMessage = formatOddsDataMessage(payload);
    expect(dataMessage).not.toContain("Dữ liệu odds thô");
  });

  test("sortMatchOddsByKickoff sorts and does not mutate input", () => {
    const unsorted: MatchOddsPayload[] = [
      { gameId: "3", home: "C", away: "c", kickoffUnix: 3000, odds: { updatedUnix: 0, legend: "", markets: [] } },
      { gameId: "1", home: "A", away: "a", kickoffUnix: 1000, odds: { updatedUnix: 0, legend: "", markets: [] } },
      { gameId: "2", home: "B", away: "b", kickoffUnix: 2000, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ];
    const original = [...unsorted];
    const result = sortMatchOddsByKickoff(unsorted);

    expect(result.map((item) => item.gameId)).toEqual(["1", "2", "3"]);
    expect(unsorted).toEqual(original);
    expect(result).not.toBe(unsorted);
  });

  test("sortMatchOddsByKickoff returns empty array for empty input", () => {
    expect(sortMatchOddsByKickoff([])).toEqual([]);
  });

  test("formatOddsText renders all available markets and correct score", () => {
    const payload: MatchOddsPayload = {
      gameId: "full",
      home: "Man City",
      away: "Liverpool",
      kickoffUnix: 0,
      odds: {
        updatedUnix: 0,
        legend: "",
        markets: [
          { key: "h2h", outcomes: [{ name: "H", price: 1.8 }, { name: "D", price: 3.6 }, { name: "A", price: 4.2 }] },
          { key: "asia_handicap", outcomes: [{ name: "H", point: -0.25, price: 1.91 }, { name: "A", point: -0.25, price: 1.99 }] },
          { key: "asia_totals", outcomes: [{ name: "Over", point: 2.5, price: 1.87 }, { name: "Under", point: 2.5, price: 2.01 }] },
          { key: "eu_totals", outcomes: [{ name: "Over", point: 2.5, price: 1.85 }, { name: "Under", point: 2.5, price: 2.05 }] },
          { key: "result_total_goals", outcomes: [{ name: "HO", point: 2.5, price: 3.5 }, { name: "DO", point: 2.5, price: 4 }, { name: "AO", point: 2.5, price: 3.8 }, { name: "HU", point: 2.5, price: 2.5 }, { name: "DU", point: 2.5, price: 3 }, { name: "AU", point: 2.5, price: 2.8 }] },
          { key: "btts", outcomes: [{ name: "GG", price: 1.9 }, { name: "NG", price: 1.95 }] },
          { key: "team_goals_home", outcomes: [{ name: "Over", point: 1.5, price: 2.1 }, { name: "Under", point: 1.5, price: 1.75 }] },
          { key: "team_goals_away", outcomes: [{ name: "Over", point: 1.5, price: 2.5 }, { name: "Under", point: 1.5, price: 1.55 }] },
          { key: "corners_1x2", outcomes: [{ name: "H", price: 2.2 }, { name: "D", price: 3.5 }, { name: "A", price: 3 }] },
          { key: "corners_handicap", outcomes: [{ name: "H", point: -1.5, price: 1.85 }, { name: "A", point: -1.5, price: 2.05 }] },
          { key: "corners_totals", outcomes: [{ name: "Over", point: 9.5, price: 1.9 }, { name: "Under", point: 9.5, price: 1.95 }] },
          { key: "corners_totals_eu", outcomes: [{ name: "Over", point: 9.5, price: 1.88 }, { name: "Under", point: 9.5, price: 2 }] },
        ],
      },
      correctScore: [{ score: "1-0", price: 8.5 }, { score: "2-0", price: 12 }, { score: "2-1", price: 15 }],
    };

    const text = formatOddsText(payload);
    expect(text).toContain("Man City(H) vs Liverpool(A) |");
    expect(text).toContain("H2H: H=1.8 D=3.6 A=4.2");
    expect(text).toContain("ASIA-HCP: H-0.25=1.91 A+0.25=1.99");
    expect(text).toContain("ASIA-TOT: O2.5=1.87 U2.5=2.01");
    expect(text).toContain("EU-TOT: O2.5=1.85 U2.5=2.05");
    expect(text).toContain("KQ-TOT:");
    expect(text).toContain("CS: 1-0=8.5 2-0=12 2-1=15");
    expect(text).toContain("GG/NG: GG=1.9 NG=1.95");
    expect(text).toContain("TEAM-GOALS-H:");
    expect(text).toContain("TEAM-GOALS-A:");
    expect(text).toContain("CORNERS-H2H:");
    expect(text).toContain("CORNERS-HCP:");
    expect(text).toContain("CORNERS-TOT:");
    expect(text).toContain("CORNERS-TOT-EU:");
  });

  test("formatOddsText renders only header and H2H line when only h2h market is present", () => {
    const payload: MatchOddsPayload = {
      gameId: "h2h-only",
      home: "Arsenal",
      away: "Chelsea",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [{ key: "h2h", outcomes: [{ name: "H", price: 2 }, { name: "D", price: 3.3 }, { name: "A", price: 3.8 }] }] },
    };

    const text = formatOddsText(payload);
    expect(text).toContain("Arsenal(H) vs Chelsea(A) |");
    expect(text).toContain("H2H: H=2 D=3.3 A=3.8");
    expect(text).not.toContain("ASIA-HCP:");
    expect(text).not.toContain("CS:");
  });

  test("formatOddsAnalysisInput formats h2h, handicap, and correct score top", () => {
    const payload: MatchOddsPayload = {
      gameId: "analysis-1",
      home: "A",
      away: "B",
      kickoffUnix: 0,
      odds: {
        updatedUnix: 0,
        legend: "",
        markets: [
          { key: "h2h", outcomes: [{ name: "H", price: 2.1 }, { name: "D", price: 3.4 }, { name: "A", price: 3.8 }] },
          { key: "asia_handicap", outcomes: [{ name: "H", point: -0.25, price: 1.9 }, { name: "A", point: -0.25, price: 2 }] },
        ],
      },
      correctScore: [{ score: "1-0", price: 5 }, { score: "2-0", price: 8 }, { score: "2-1", price: 9 }, { score: "3-0", price: 12 }, { score: "1-1", price: 6.5 }, { score: "3-1", price: 15 }, { score: "0-0", price: 10 }, { score: "0-1", price: 7 }, { score: "2-2", price: 18 }, { score: "3-2", price: 25 }],
    };

    const text = formatOddsAnalysisInput(payload);
    expect(text).toContain("h2h:H=2.1,D=3.4,A=3.8");
    expect(text).toContain("asia_handicap:H@-0.25=1.9,A@+0.25=2");
    expect(text).toContain("correct_score_top:");
    const csLine = text.split("\n").find((line) => line.startsWith("correct_score_top:"));
    expect(csLine?.split(",")).toHaveLength(8);
  });

  test("formatOddsAnalysisInput returns empty string when payload has no markets and no correctScore", () => {
    const payload: MatchOddsPayload = { gameId: "empty", home: "X", away: "Y", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } };
    expect(formatOddsAnalysisInput(payload)).toBe("");
  });

  test("formatOddsAnalysisInput filters out outcomes with invalid price", () => {
    const payload: MatchOddsPayload = {
      gameId: "filter",
      home: "A",
      away: "B",
      kickoffUnix: 0,
      odds: {
        updatedUnix: 0,
        legend: "",
        markets: [
          { key: "h2h", outcomes: [{ name: "H", price: 2.1 }, { name: "D", price: 0 }, { name: "A", price: Number.NaN as any }] },
          { key: "asia_totals", outcomes: [{ name: "Over", point: 2.5, price: -1 }, { name: "Under", point: 2.5, price: 1.8 }] },
        ],
      },
      correctScore: [{ score: "0-0", price: 0 }, { score: "1-0", price: 7 }, { score: "2-0", price: Number.NaN as any }],
    };

    const text = formatOddsAnalysisInput(payload);
    expect(text).toContain("h2h:H=2.1");
    expect(text).toContain("asia_totals:Under@+2.5=1.8");
    expect(text).toContain("correct_score_top:1-0=7");
  });

  test("formatCombinedOddsMessage returns fallback string for empty payloads array", () => {
    expect(formatCombinedOddsMessage([])).toBe("Không có dữ liệu odds.");
  });

  test("formatCombinedOddsMessage sorts matches and adds separator", () => {
    const text = formatCombinedOddsMessage([
      { gameId: "late", home: "LateTeam", away: "LateOpp", kickoffUnix: 2000, odds: { updatedUnix: 0, legend: "", markets: [{ key: "h2h", outcomes: [{ name: "H", price: 2 }, { name: "D", price: 3.3 }, { name: "A", price: 3.8 }] }] } },
      { gameId: "early", home: "EarlyTeam", away: "EarlyOpp", kickoffUnix: 1000, odds: { updatedUnix: 0, legend: "", markets: [{ key: "h2h", outcomes: [{ name: "H", price: 1.9 }, { name: "D", price: 3.5 }, { name: "A", price: 4 }] }] } },
    ]);

    expect(text).toContain("━━━━━━ DỮ LIỆU ODDS");
    expect(text.indexOf("EarlyTeam(H)")).toBeLessThan(text.indexOf("LateTeam(H)"));
    expect((text.match(/──────────────/g) || []).length).toBe(1);
  });

  test("formatCachedAnalysisMessage renders full snapshot with summary and predictions", () => {
    const payload: MatchOddsPayload = { gameId: "g1", home: "Home", away: "Away", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } };
    const snapshot: BettingAnalysisSnapshot = {
      gameId: "g1",
      date: "2024-01-01",
      home: "Home",
      away: "Away",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
      correctScore: null,
      analysis: {
        match: "Home vs Away",
        totalGoalsPick: null,
        handicapPick: null,
        predictedScore: { score: "2-1", confidence: 70 },
        summary: "Home team expected to win comfortably.",
        preferredScoreline: "2-1",
        scoreConfidence: 70,
        recommendation: "Home win",
        confidence: 70,
        keyPoints: [],
        risks: [],
        picks: [{ market: "eu_totals", selection: "Over 2.5", odds: 1.9, confidence: 75, reason: "Strong form" }],
      },
      verifiedConfirmed: null,
      verifiedConfidence: null,
      verifiedComment: null,
      revisedAfterReject: false,
    };

    const text = formatCachedAnalysisMessage([payload], [snapshot]);
    expect(text).toContain("💡 *TỔNG QUAN (TỪ CACHE)*");
    expect(text).toContain("Home team expected to win comfortably.");
    expect(text).toContain("🏟️  *Home vs Away*");
    expect(text).toContain("DỰ ĐOÁN TỈ SỐ");
    expect(text).toContain("2-1");
  });

  test("formatCachedAnalysisMessage shows fallback summary when snapshots array is empty", () => {
    const payload: MatchOddsPayload = { gameId: "g2", home: "X", away: "Y", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } };
    const text = formatCachedAnalysisMessage([payload], []);
    expect(text).toContain("💡 *TỔNG QUAN (TỪ CACHE)*");
    expect(text).toContain("Không có tóm tắt.");
    expect(text).not.toContain("🏟️  *X vs Y*");
  });

  test("formatCachedAnalysisMessage skips payload when no snapshot matches its gameId", () => {
    const matchingPayload: MatchOddsPayload = { gameId: "match", home: "Matching", away: "Team", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } };
    const nonMatchingPayload: MatchOddsPayload = { gameId: "other", home: "Other", away: "Team", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } };
    const snapshot: BettingAnalysisSnapshot = {
      gameId: "match",
      date: "2024-01-01",
      home: "Matching",
      away: "Team",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
      correctScore: null,
      analysis: {
        match: "Matching vs Team",
        totalGoalsPick: { market: "Tài/Xỉu", selection: "Tài 2.5", odds: 1.8 } as any,
        predictedScore: { score: "1-0", confidence: 60 },
        preferredScoreline: "1-0",
        scoreConfidence: 60,
        recommendation: "Match win",
        confidence: 60,
        keyPoints: [],
        risks: [],
        picks: [],
        summary: "Matching should win.",
      },
      verifiedConfirmed: null,
      verifiedConfidence: null,
      verifiedComment: null,
      revisedAfterReject: false,
    };

    const text = formatCachedAnalysisMessage([matchingPayload, nonMatchingPayload], [snapshot]);
    expect(text).toContain("*Matching vs Team*");
    expect(text).not.toContain("*Other vs Team*");
  });

  test("formatCombinedAnalysisMessage keeps Vietnamese betting labels", () => {
    const payload: MatchOddsPayload = {
      gameId: "g1",
      home: "Home",
      away: "Away",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [{ key: "eu_totals", outcomes: [{ name: "Over", point: 2.5, price: 1.9 }, { name: "Under", point: 2.5, price: 1.95 }] }] },
    };

    const text = formatCombinedAnalysisMessage([payload], {
      summary: "Tổng quan",
      matches: [{ matchIndex: 0, matchLabel: "Home vs Away", kickoff: "12:00", handicapPick: null, totalGoalsPick: null, picks: [], predictedScore: { score: "1-0", confidence: 60 } }],
    });

    expect(text).toContain("💡 *TỔNG QUAN*");
    expect(text).toContain("Tài/Xỉu");
    expect(text).toContain("DỰ ĐOÁN TỈ SỐ");
  });
});
