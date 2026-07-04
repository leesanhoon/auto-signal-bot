import { describe, expect, test } from "vitest";
import {
  formatBettingPlanMessage,
  formatCachedAnalysisMessage,
  formatCombinedOddsMessage,
  formatFullOddsAnalysisInput,
  formatMainOddsSummary,
  formatOddsAnalysisInput,
  formatOddsDataMessage,
  formatOddsFallbackMessage,
  formatOddsText,
  formatPicksSummaryBlock,
  sortMatchOddsByKickoff,
} from "../../src/betting/odds-text-format.js";
import type {
  BettingPlan,
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

describe("summary and betting plan blocks", () => {
  const payloads: MatchOddsPayload[] = [
    {
      gameId: "1",
      home: "Tây Ban Nha",
      away: "Áo",
      kickoffUnix: 1000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    },
    {
      gameId: "2",
      home: "Bồ Đào Nha",
      away: "Croatia",
      kickoffUnix: 2000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    },
    {
      gameId: "3",
      home: "Thụy Sĩ",
      away: "Algeria",
      kickoffUnix: 3000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    },
  ];

  test("formatPicksSummaryBlock renders compact selected-picks rows", () => {
    const plan: CombinedAnalysisPlan = {
      summary: "3 kèo chính",
      matches: [
        {
          matchIndex: 0,
          matchLabel: "TBN vs Áo",
          kickoff: "06:00",
          analysis: "Main",
          preferredScoreline: "2:0",
          scoreConfidence: 61,
          topPicks: [
            { market: "Tài/Xỉu EU", selection: "Under 2.5 EU", odds: 2.19, reason: "gọn" },
          ],
          keyPoints: ["A"],
          risks: ["B"],
        },
        {
          matchIndex: 2,
          matchLabel: "Thụy Sĩ vs Algeria",
          kickoff: "08:00",
          analysis: "Main",
          preferredScoreline: "1:1",
          scoreConfidence: 58,
          topPicks: [
            { market: "Chấp Châu Á", selection: "Algeria +0.25 AH", odds: 2.17, reason: "gọn" },
          ],
          keyPoints: ["A"],
          risks: ["B"],
        },
      ],
      parlays: [],
      remainingSingles: [],
    };

    const message = formatPicksSummaryBlock(payloads, plan);

    expect(message).toContain("🎯 *Các kèo được chọn*");
    expect(message).toContain("🏆 *Khuyến nghị chính:*");
    expect(message).toContain("TBN vs Áo");
    expect(message).toContain("*TBN vs Áo* | Under 2.5 EU @2.19 | TS: 2:0");
    expect(message).toContain("(TT 61%)");
    expect(message).toContain("*Thụy Sĩ vs Algeria* | Algeria +0.25 AH @2.17 | TS: 1:1");
  });

  test("formatPicksSummaryBlock prefers a single-eligible top pick over the first array item", () => {
    const plan: CombinedAnalysisPlan = {
      summary: "Chọn kèo phù hợp nhất.",
      matches: [
        {
          matchIndex: 0,
          matchLabel: "TBN vs Áo",
          kickoff: "06:00",
          analysis: "Main",
          preferredScoreline: "2:0",
          scoreConfidence: 61,
          topPicks: [
            { market: "1X2", selection: "TBN thắng", odds: 1.72, reason: "parlay first", suitability: "parlay" },
            { market: "Tỷ số chính xác", selection: "2:0", odds: 6.0, reason: "single preferred", suitability: "single" },
          ],
          keyPoints: ["A"],
          risks: ["B"],
        },
      ],
      parlays: [],
      remainingSingles: [],
    };

    const message = formatPicksSummaryBlock(payloads, plan);

    expect(message).toContain("*TBN vs Áo* | 2:0 @6 | TS: 2:0");
    expect(message).not.toContain("TBN thắng @1.72");
  });

  test("formatBettingPlanMessage trims stake detail and keeps compact lines", () => {
    const plan: BettingPlan = {
      summary: "Giữ 3 xiên, 1 kèo đơn.",
      parlays: [
        {
          type: "Xiên 3 (main)",
          combinedOdds: 10.07,
          stake: 50_000,
          potentialWin: 503_500,
          legs: [
            {
              matchIndex: 0,
              matchLabel: "TBN vs Áo",
              pick: { market: "EU", selection: "Under 2.5 EU", odds: 2.19, reason: "A" },
            },
            {
              matchIndex: 1,
              matchLabel: "Bồ Đào Nha vs Croatia",
              pick: { market: "EU", selection: "Under 2.5 EU", odds: 2.12, reason: "B" },
            },
            {
              matchIndex: 2,
              matchLabel: "Thụy Sĩ vs Algeria",
              pick: { market: "AH", selection: "Algeria +0.25 AH", odds: 2.17, reason: "C" },
            },
          ],
        },
        {
          type: "Xiên 2 (main)",
          combinedOdds: 4.64,
          stake: 50_000,
          potentialWin: 232_000,
          legs: [
            {
              matchIndex: 0,
              matchLabel: "TBN vs Áo",
              pick: { market: "EU", selection: "Under 2.5 EU", odds: 2.19, reason: "A" },
            },
            {
              matchIndex: 1,
              matchLabel: "Bồ Đào Nha vs Croatia",
              pick: { market: "EU", selection: "Under 2.5 EU", odds: 2.12, reason: "B" },
            },
          ],
        },
      ],
      remainingSingles: [
        {
          matchIndex: 0,
          matchLabel: "TBN vs Áo",
          betType: "Tỷ số chính xác",
          pick: { market: "CS", selection: "2:0", odds: 6, reason: "D" },
          stake: 250_000,
          potentialWin: 1_500_000,
        },
      ],
    };

    const message = formatBettingPlanMessage(plan);

    expect(message).toContain("⛓️ *Xiên 3 (main)* — x10.07");
    expect(message).toContain("② 🔗 *Xiên 2 (main)* — x4.64");
    expect(message).toContain("🔴 Mạo hiểm");
    expect(message).toContain("🟡 Vừa");
    expect(message).toContain("TBN vs Áo: Under 2.5 EU @2.19");
    expect(message).toContain("BĐN vs Croa: Under 2.5 EU @2.12");
    expect(message).toContain("TS vs Alge: Algeria +0.25 AH @2.17");
    expect(message).toContain(" | ");
    expect(message).toContain("📌 *KÈO ĐƠN*");
    expect(message).toContain("① TBN vs Áo: 2:0 @6");
    expect(message).not.toContain("250_000");
    expect(message).not.toContain("→");
    expect(message).not.toContain(" × ");
    expect(message).not.toContain("Giữ 3 xiên, 1 kèo đơn.");
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
  test("renders full snapshot with summary, keyPoints, risks, picks", () => {
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
        preferredScoreline: "2-1",
        scoreConfidence: 70,
        recommendation: "Home win",
        confidence: 0.7,
        keyPoints: ["Home team strong form", "Away team missing key players"],
        risks: ["Home defense vulnerable"],
        summary: "Home team expected to win comfortably.",
        picks: [
          { market: "1X2", selection: "Home", odds: 1.8, reason: "Strong form" },
          { market: "Tài/Xỉu", selection: "Over 2.5", odds: 1.9 },
        ],
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
    // Key points with bullet prefix
    expect(text).toContain("• Home team strong form");
    expect(text).toContain("• Away team missing key players");
    // Risks with warning emoji
    expect(text).toContain("⚠️ Home defense vulnerable");
    // Picks with arrow emoji and @odds format
    expect(text).toContain("🎯 *Các kèo được chọn (từ cache)*");
    expect(text).toContain("🎯 Home @1.8 — Strong form");
    expect(text).toContain("🎯 Over 2.5 @1.9");
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
        preferredScoreline: "1-0",
        scoreConfidence: 60,
        recommendation: "Match win",
        confidence: 0.6,
        keyPoints: ["Matching is strong"],
        risks: [],
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
