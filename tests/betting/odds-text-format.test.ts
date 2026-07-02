import { describe, expect, test } from "vitest";
import { formatMainOddsSummary, formatMatchAnalysisMessage, formatOddsAnalysisInput, formatFullOddsAnalysisInput, formatOddsFallbackMessage, formatOddsDataMessage } from "../../src/betting/odds-text-format.js";
import type { MatchAiAnalysis, MatchOddsPayload } from "../../src/betting/betting-types.js";

describe("formatMatchAnalysisMessage", () => {
  test("highlights the revised recommendation and limits supporting detail", () => {
    const payload: MatchOddsPayload = {
      gameId: "1",
      home: "Belgium",
      away: "Senegal",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    };
    const analysis: MatchAiAnalysis = {
      match: "Belgium vs Senegal",
      preferredScoreline: "1-0",
      scoreConfidence: 36,
      recommendation: "Belgium -0.25",
      confidence: 33,
      picks: [{ market: "Chap Chau A", selection: "Belgium -0.25", odds: 1.81, reason: "Kèo nghiêng theo dữ liệu odds" }],
      marketViews: [
        { market: "Chap Chau A", assessment: "Nghieng Belgium -0.25", odds: 1.81 },
        { market: "GG/NG", assessment: "Nghieng GG", odds: 1.69 },
      ],
      verificationStatus: "revised",
      keyPoints: ["Điểm chính 1", "Điểm chính 2", "Điểm thừa"],
      risks: ["Rủi ro 1", "Rủi ro 2", "Rủi ro thừa"],
      summary: "Phần tóm tắt dài và trùng lặp.",
      verifiedConfirmed: false,
      verifiedConfidence: 62,
      verifiedComment: "Lời từ chối cũ rất dài và không cần hiển thị.",
      revisedAfterReject: true,
    };

    const message = formatMatchAnalysisMessage(payload, analysis);

    expect(message).toContain("🏟 *Belgium (H) vs Senegal (A)*");
    expect(message).toContain("1. *Belgium -0.25*  [@1.81]");
    expect(message).toContain("_Chap Chau A_");
    expect(message).toContain("Lý do");
    expect(message).toContain("⚽ *Tỷ số dự đoán:* 1-0 _(36%)_");
    expect(message).not.toContain("⭐ *Độ tin cậy:");
    expect(message).not.toContain("Thẩm định:");
    expect(message).not.toContain("🔎 *Nhận định:");
    expect(message).not.toContain("⚠️ *Rủi ro:");
    expect(message).not.toContain("Điểm chính 1");
    expect(message).not.toContain("Rủi ro thừa");
    expect(message).not.toContain("Lời từ chối cũ");
    expect(message).not.toContain("Phần tóm tắt");
    expect(message).not.toContain("Kèo chính:");
  });

  test("hides no-bet recommendation and internal verification state", () => {
    const message = formatMatchAnalysisMessage(
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
      {
        match: "Belgium vs Senegal",
        preferredScoreline: "2-1",
        scoreConfidence: 45,
        recommendation: "Đứng ngoài",
        confidence: 38,
        keyPoints: ["Odds chu nha nhinh hon.", "Tong ban chua ro."],
        risks: ["Tin hieu xung dot.", "Ti so phan tan."],
        summary: "Khong co lua chon.",
        verifiedConfirmed: false,
        verifiedConfidence: 0,
        verifiedComment: "Internal",
        revisedAfterReject: true,
        verificationStatus: "failed",
      },
    );

    expect(message).not.toContain("KÈO ĐỀ XUẤT");
    expect(message).not.toContain("Thẩm định:");
    expect(message).not.toContain("Internal");
    expect(message).toContain("⚽ *Tỷ số dự đoán:*");
  });

  test("formatFullOddsAnalysisInput includes all markets and correct score", () => {
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
