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
} from "../../src/betting/odds-text-format.js";
import type {
  CombinedAnalysisPlan,
  MatchOddsPayload,
} from "../../src/betting/betting-types.js";
import type { BettingAnalysisSnapshot } from "../../src/betting/betting-analysis-repository.js";

describe("formatFullOddsAnalysisInput", () => {
  test("includes all markets and correct score", () => {
    const payload: MatchOddsPayload = {
      gameId: "1",
      home: "Belgium",
      away: "Senegal",
      kickoffUnix: 0,
      odds: {
        updatedUnix: 0,
        legend: "long legend",
        markets: [
          { key: "h2h", outcomes: [{ name: "H", price: 2.16 }, { name: "A", price: 3.76 }] },
        ],
      },
      correctScore: [{ score: "1-0", price: 8.5 }],
    };

    const text = formatFullOddsAnalysisInput(payload);

    expect(text).toContain('"markets"');
    expect(text).toContain('"correctScore"');
    expect(text).toContain('"h2h"');
  });

});

describe("odds Telegram messages Vietnamese output", () => {
  const payload: MatchOddsPayload = {
    gameId: "1",
    home: "Việt Nam",
    away: "Thái Lan",
    kickoffUnix: 0,
    odds: {
      updatedUnix: 0,
      legend: "",
      markets: [
        {
          key: "asia_handicap",
          outcomes: [
            { name: "H", point: -0.25, price: 1.91 },
            { name: "A", point: -0.25, price: 1.99 },
          ],
        },
        {
          key: "asia_totals",
          outcomes: [
            { name: "Over", point: 2.5, price: 1.87 },
            { name: "Under", point: 2.5, price: 2.01 },
          ],
        },
      ],
    },
  };

  test("formatMainOddsSummary uses accented labels", () => {
    const summary = formatMainOddsSummary(payload);
    expect(summary).toContain("Chấp -0.25");
    expect(summary).toContain("Tài/Xỉu 2.5");
  });

  test("formatOddsFallbackMessage uses accented fallback text", () => {
    const fallback = formatOddsFallbackMessage(payload, "thiếu OPENROUTER_API_KEY");
    expect(fallback).toContain("AI tạm thời chưa phân tích được trận này");
    expect(fallback).not.toContain("tam thoi");
    expect(fallback).not.toContain("tran nay");
  });

  test("formatOddsDataMessage uses current compact output", () => {
    const dataMessage = formatOddsDataMessage(payload);
    expect(dataMessage).toContain("Asian Handicap");
    expect(dataMessage).not.toContain("Dữ liệu odds thô");
  });
});


describe("sortMatchOddsByKickoff", () => {
  test("sorts payloads by kickoffUnix ascending and does not mutate input array", () => {
    const unsorted: MatchOddsPayload[] = [
      { gameId: "3", home: "C", away: "c", kickoffUnix: 3000, odds: { updatedUnix: 0, legend: "", markets: [] } },
      { gameId: "1", home: "A", away: "a", kickoffUnix: 1000, odds: { updatedUnix: 0, legend: "", markets: [] } },
      { gameId: "2", home: "B", away: "b", kickoffUnix: 2000, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ];
    const original = [...unsorted];
    const result = sortMatchOddsByKickoff(unsorted);

    expect(result[0].gameId).toBe("1");
    expect(result[1].gameId).toBe("2");
    expect(result[2].gameId).toBe("3");
    // Verify immutability — original array unchanged
    expect(unsorted).toEqual(original);
    expect(result).not.toBe(unsorted);
  });

  test("returns empty array for empty input", () => {
    expect(sortMatchOddsByKickoff([])).toEqual([]);
  });
});

describe("formatOddsText", () => {
  test("renders all available markets and correct score in compact lines", () => {
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
          { key: "result_total_goals", outcomes: [
            { name: "HO", point: 2.5, price: 3.5 }, { name: "DO", point: 2.5, price: 4.0 },
            { name: "AO", point: 2.5, price: 3.8 }, { name: "HU", point: 2.5, price: 2.5 },
            { name: "DU", point: 2.5, price: 3.0 }, { name: "AU", point: 2.5, price: 2.8 },
          ] },
          { key: "btts", outcomes: [{ name: "GG", price: 1.9 }, { name: "NG", price: 1.95 }] },
          { key: "team_goals_home", outcomes: [{ name: "Over", point: 1.5, price: 2.1 }, { name: "Under", point: 1.5, price: 1.75 }] },
          { key: "team_goals_away", outcomes: [{ name: "Over", point: 1.5, price: 2.5 }, { name: "Under", point: 1.5, price: 1.55 }] },
          { key: "corners_1x2", outcomes: [{ name: "H", price: 2.2 }, { name: "D", price: 3.5 }, { name: "A", price: 3.0 }] },
          { key: "corners_handicap", outcomes: [{ name: "H", point: -1.5, price: 1.85 }, { name: "A", point: -1.5, price: 2.05 }] },
          { key: "corners_totals", outcomes: [{ name: "Over", point: 9.5, price: 1.9 }, { name: "Under", point: 9.5, price: 1.95 }] },
          { key: "corners_totals_eu", outcomes: [{ name: "Over", point: 9.5, price: 1.88 }, { name: "Under", point: 9.5, price: 2.0 }] },
        ],
      },
      correctScore: [
        { score: "1-0", price: 8.5 },
        { score: "2-0", price: 12 },
        { score: "2-1", price: 15 },
      ],
    };

    const text = formatOddsText(payload);

    // Header line
    expect(text).toContain("Man City(H) vs Liverpool(A) |");
    // 3-way markets
    expect(text).toContain("H2H: H=1.8 D=3.6 A=4.2");
    expect(text).toContain("CORNERS-H2H: H=2.2 D=3.5 A=3");
    // Asia handicap (A point negated to positive)
    expect(text).toContain("ASIA-HCP: H-0.25=1.91 A+0.25=1.99");
    expect(text).toContain("CORNERS-HCP: H-1.5=1.85 A+1.5=2.05");
    // Asia totals
    expect(text).toContain("ASIA-TOT: O2.5=1.87 U2.5=2.01");
    expect(text).toContain("CORNERS-TOT: O9.5=1.9 U9.5=1.95");
    // EU totals
    expect(text).toContain("EU-TOT: O2.5=1.85 U2.5=2.05");
    expect(text).toContain("CORNERS-TOT-EU: O9.5=1.88 U9.5=2");
    // Result total goals
    expect(text).toContain("KQ-TOT: H-O2.5=3.5 D-O2.5=4 A-O2.5=3.8 H-U2.5=2.5 D-U2.5=3 A-U2.5=2.8");
    // Correct score
    expect(text).toContain("CS: 1-0=8.5 2-0=12 2-1=15");
    // BTTS
    expect(text).toContain("GG/NG: GG=1.9 NG=1.95");
    // Team goals
    expect(text).toContain("TEAM-GOALS-H: O1.5=2.1 U1.5=1.75");
    expect(text).toContain("TEAM-GOALS-A: O1.5=2.5 U1.5=1.55");
  });

  test("renders only header and H2H line when only h2h market is present", () => {
    const payload: MatchOddsPayload = {
      gameId: "h2h-only",
      home: "Arsenal",
      away: "Chelsea",
      kickoffUnix: 0,
      odds: {
        updatedUnix: 0,
        legend: "",
        markets: [
          { key: "h2h", outcomes: [{ name: "H", price: 2.0 }, { name: "D", price: 3.3 }, { name: "A", price: 3.8 }] },
        ],
      },
    };

    const text = formatOddsText(payload);

    expect(text).toContain("Arsenal(H) vs Chelsea(A) |");
    expect(text).toContain("H2H: H=2 D=3.3 A=3.8");
    // None of the other section labels should appear
    expect(text).not.toContain("ASIA-HCP:");
    expect(text).not.toContain("ASIA-TOT:");
    expect(text).not.toContain("EU-TOT:");
    expect(text).not.toContain("KQ-TOT:");
    expect(text).not.toContain("CS:");
    expect(text).not.toContain("GG/NG:");
    expect(text).not.toContain("TEAM-GOALS-H:");
    expect(text).not.toContain("TEAM-GOALS-A:");
    expect(text).not.toContain("CORNERS-H2H:");
    expect(text).not.toContain("CORNERS-HCP:");
    expect(text).not.toContain("CORNERS-TOT:");
    expect(text).not.toContain("CORNERS-TOT-EU:");
  });
});

describe("formatOddsAnalysisInput", () => {
  test("formats h2h, asia_handicap with negated A point, and correctScore sorted by price asc (max 8)", () => {
    const payload: MatchOddsPayload = {
      gameId: "analysis-1",
      home: "A",
      away: "B",
      kickoffUnix: 0,
      odds: {
        updatedUnix: 0,
        legend: "",
        markets: [
          { key: "h2h", outcomes: [
            { name: "H", price: 2.1 },
            { name: "D", price: 3.4 },
            { name: "A", price: 3.8 },
          ] },
          { key: "asia_handicap", outcomes: [
            { name: "H", point: -0.25, price: 1.9 },
            { name: "A", point: -0.25, price: 2.0 },
          ] },
        ],
      },
      // 10 correctScore items to verify 8-item limit
      correctScore: [
        { score: "1-0", price: 5 }, { score: "2-0", price: 8 },
        { score: "2-1", price: 9 }, { score: "3-0", price: 12 },
        { score: "1-1", price: 6.5 }, { score: "3-1", price: 15 },
        { score: "0-0", price: 10 }, { score: "0-1", price: 7 },
        { score: "2-2", price: 18 }, { score: "3-2", price: 25 },
      ],
    };

    const text = formatOddsAnalysisInput(payload);

    // h2h outcomes have no point → bare name=price
    expect(text).toContain("h2h:H=2.1,D=3.4,A=3.8");
    // asia_handicap negates point for A outcome → A@+0.25
    expect(text).toContain("asia_handicap:H@-0.25=1.9,A@+0.25=2");
    // correct_score_top: sorted by price asc, max 8 items
    expect(text).toContain("correct_score_top:");
    const csLine = text.split("\n").find((l) => l.startsWith("correct_score_top:"));
    const csItems = csLine!.replace("correct_score_top:", "").split(",");
    expect(csItems).toHaveLength(8);
    // Prices ascending: 5, 6.5, 7, 8, 9, 10, 12, 15 — 18 and 25 are cut
    expect(csItems[0]).toBe("1-0=5");
    expect(csItems[1]).toBe("1-1=6.5");
    expect(csItems[2]).toBe("0-1=7");
    expect(csItems[6]).toBe("3-0=12");
    expect(csItems[7]).toBe("3-1=15");
  });

  test("returns empty string when payload has no markets and no correctScore", () => {
    const payload: MatchOddsPayload = {
      gameId: "empty",
      home: "X",
      away: "Y",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    };
    expect(formatOddsAnalysisInput(payload)).toBe("");
  });

  test("filters out outcomes with price <= 0 or NaN", () => {
    const payload: MatchOddsPayload = {
      gameId: "filter",
      home: "A",
      away: "B",
      kickoffUnix: 0,
      odds: {
        updatedUnix: 0,
        legend: "",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "H", price: 2.1 },
              { name: "D", price: 0 },       // <= 0 → filtered
              { name: "A", price: NaN as any }, // NaN → filtered
            ],
          },
          {
            key: "asia_totals",
            outcomes: [
              { name: "Over", point: 2.5, price: -1 },  // negative → filtered
              { name: "Under", point: 2.5, price: 1.8 },
            ],
          },
        ],
      },
      correctScore: [
        { score: "0-0", price: 0 },
        { score: "1-0", price: 7 },
        { score: "2-0", price: NaN as any },
      ],
    };

    const text = formatOddsAnalysisInput(payload);

    // Only H=2.1 from h2h survives
    expect(text).toContain("h2h:H=2.1");
    expect(text).not.toContain("D=0");
    expect(text).not.toContain("A=");
    // Only Under from asia_totals survives (fmtSignedPoint for positive point)
    expect(text).toContain("asia_totals:Under@+2.5=1.8");
    expect(text).not.toContain("Over");
    // Only 1-0=7 from correctScore survives
    expect(text).toContain("correct_score_top:1-0=7");
    expect(text).not.toContain("0-0=0");
  });
});

describe("formatCombinedOddsMessage", () => {
  test("returns fallback string for empty payloads array", () => {
    expect(formatCombinedOddsMessage([])).toBe("Không có dữ liệu odds.");
  });

  test("sorts matches by kickoffUnix ascending, adds separator between but not after last", () => {
    const lateMatch: MatchOddsPayload = {
      gameId: "late",
      home: "LateTeam",
      away: "LateOpp",
      kickoffUnix: 2000,
      odds: {
        updatedUnix: 0,
        legend: "",
        markets: [
          { key: "h2h", outcomes: [{ name: "H", price: 2.0 }, { name: "D", price: 3.3 }, { name: "A", price: 3.8 }] },
        ],
      },
    };
    const earlyMatch: MatchOddsPayload = {
      gameId: "early",
      home: "EarlyTeam",
      away: "EarlyOpp",
      kickoffUnix: 1000,
      odds: {
        updatedUnix: 0,
        legend: "",
        markets: [
          { key: "h2h", outcomes: [{ name: "H", price: 1.9 }, { name: "D", price: 3.5 }, { name: "A", price: 4.0 }] },
        ],
      },
    };

    const text = formatCombinedOddsMessage([lateMatch, earlyMatch]);

    // Header
    expect(text).toContain("━━━━━━ DỮ LIỆU ODDS");
    // Sorted by kickoffUnix: earlyMatch (1000) before lateMatch (2000)
    const earlyPos = text.indexOf("EarlyTeam(H)");
    const latePos = text.indexOf("LateTeam(H)");
    expect(earlyPos).toBeLessThan(latePos);
    // Has separator between matches
    expect(text).toContain("──────────────");
    // Only one separator (between, not after last)
    const sepCount = (text.match(/──────────────/g) || []).length;
    expect(sepCount).toBe(1);
  });
});

describe("formatCachedAnalysisMessage", () => {
  test("renders full snapshot with summary and predictions", () => {
    const payload: MatchOddsPayload = {
      gameId: "g1",
      home: "Home",
      away: "Away",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    };
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
        totalGoalsPick: { market: "Tài/Xỉu", selection: "Tài 2.5", odds: 1.9, reason: "Strong form" },
        predictedScore: { score: "2-1", confidence: 70 },
        summary: "Home team expected to win comfortably.",
        preferredScoreline: "2-1",
        scoreConfidence: 70,
        recommendation: "Home win",
        confidence: 70,
        keyPoints: [],
        risks: [],
        picks: [],
      },
      verifiedConfirmed: null,
      verifiedConfidence: null,
      verifiedComment: null,
      revisedAfterReject: false,
    };

    const text = formatCachedAnalysisMessage([payload], [snapshot]);

    // Overview from summary
    expect(text).toContain("💡 *Tổng quan:* Home team expected to win comfortably.");
    // Match analysis block
    expect(text).toContain("*Home vs Away*");
    // Tài/Xỉu pick
    expect(text).toContain("🎯 Tài 2.5 @1.9 — Strong form");
    // Predicted score
    expect(text).toContain("⚽ Tỉ số dự đoán: 2-1 (70%)");
  });

  test("shows fallback summary and omits picks section when snapshots array is empty", () => {
    const payload: MatchOddsPayload = {
      gameId: "g2",
      home: "X",
      away: "Y",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    };

    const text = formatCachedAnalysisMessage([payload], []);

    // Fallback summary
    expect(text).toContain("💡 *Tổng quan:* Không có tóm tắt.");
    // No match picks section
    expect(text).not.toContain("🎯 *Các kèo được chọn (từ cache)*");
  });

  test("skips payload when no snapshot matches its gameId", () => {
    const matchingPayload: MatchOddsPayload = {
      gameId: "match",
      home: "Matching",
      away: "Team",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    };
    const nonMatchingPayload: MatchOddsPayload = {
      gameId: "other",
      home: "Other",
      away: "Team",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    };
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
        totalGoalsPick: { market: "Tài/Xỉu", selection: "Tài 2.5", odds: 1.8 },
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

    const text = formatCachedAnalysisMessage(
      [matchingPayload, nonMatchingPayload],
      [snapshot],
    );

    // Matching payload appears
    expect(text).toContain("*Matching vs Team*");
    // Non-matching payload is skipped
    expect(text).not.toContain("*Other vs Team*");
  });
});
