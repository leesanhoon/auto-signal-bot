import { describe, expect, test } from "vitest";
import {
  formatBettingPlanMessage,
  formatFullOddsAnalysisInput,
  formatMainOddsSummary,
  formatOddsAnalysisInput,
  formatOddsDataMessage,
  formatOddsFallbackMessage,
  formatPicksSummaryBlock,
} from "../../src/betting/odds-text-format.js";
import type {
  BettingPlan,
  CombinedAnalysisPlan,
  MatchOddsPayload,
} from "../../src/betting/betting-types.js";

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
