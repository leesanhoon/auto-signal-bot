import { describe, expect, test } from "vitest";
import { formatMatchAnalysisMessage, formatOddsAnalysisInput } from "../../src/betting/odds-text-format.js";
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
      picks: [{ market: "Chap Chau A", selection: "Belgium -0.25", odds: 1.81 }],
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

    expect(message).toContain("⭐ *Độ tin cậy: THẤP* ⭐");
    expect(message).toContain("1. *Belgium -0.25*  `@1.81`");
    expect(message).toContain("_Chap Chau A_");
    expect(message).toContain("🔄 *Verify:* đã hiệu chỉnh");
    expect(message).toContain("*GG/NG:* Nghieng GG  `@1.69`");
    expect(message).toContain("Điểm chính 1");
    expect(message).not.toContain("Điểm chính 2");
    expect(message).not.toContain("Điểm thừa");
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
        recommendation: "Dung ngoai",
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

    expect(message).not.toContain("KHUYẾN NGHỊ");
    expect(message).toContain("⚠️ *Verify:* lỗi model");
    expect(message).not.toContain("Internal");
    expect(message).toContain("⚽ *Tỷ số dự đoán:*");
  });

  test("builds a compact decision snapshot with main and corners markets", () => {
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
          { key: "asia_handicap", outcomes: [
            { name: "H", point: -0.25, price: 1.81 },
            { name: "A", point: -0.25, price: 2.06 },
          ] },
          { key: "corners_totals", outcomes: [{ name: "Over", point: 9.5, price: 1.9 }] },
          { key: "result_total_goals", outcomes: [{ name: "HO", point: 2.5, price: 4.2 }] },
        ],
      },
      correctScore: Array.from({ length: 10 }, (_, index) => ({
        score: `${index}-0`,
        price: 20 - index,
      })),
    };

    const input = formatOddsAnalysisInput(payload);

    expect(input).toContain("h2h:H=2.16,A=3.76");
    expect(input).toContain("asia_handicap:H@-0.25=1.81,A@+0.25=2.06");
    expect(input).toContain("corners_totals:Over@+9.5=1.9");
    expect(input).not.toContain("result_total_goals");
    expect(input).not.toContain("long legend");
    expect(input.match(/=1[0-9]/g)).toHaveLength(8);
  });
});
