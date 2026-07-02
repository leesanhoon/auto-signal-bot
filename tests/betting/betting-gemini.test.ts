import { describe, expect, test, vi } from "vitest";

vi.mock("../../src/shared/openrouter.js", () => ({ callOpenRouter: vi.fn() }));
const { parseMatchAnalysisResponse } = await import("../../src/betting/betting-gemini.js");

describe("parseMatchAnalysisResponse", () => {
  test("preserves qualifying recommendations even when confidence is conservative", () => {
    const parsed = parseMatchAnalysisResponse(
      JSON.stringify({
        match: "Belgium vs Senegal",
        preferredScoreline: "1-0",
        scoreConfidence: 36,
        recommendation: "Dat Belgium -0.25",
        confidence: 33,
        picks: [{ market: "Chap Chau A", selection: "Belgium -0.25", odds: 1.81 }],
        marketViews: [{ market: "Chap Chau A", assessment: "Nghieng Belgium -0.25", odds: 1.81 }],
        keyPoints: ["Mot", "Hai", "Ba"],
        risks: ["Bon", "Nam", "Sau"],
        summary: "Tin hieu yeu.",
      }),
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    );

    expect(parsed?.recommendation).toBe("Dat Belgium -0.25");
    expect(parsed?.picks).toEqual([
      { market: "Chap Chau A", selection: "Belgium -0.25", odds: 1.81 },
    ]);
    expect(parsed?.marketViews).toEqual([
      { market: "Chap Chau A", assessment: "Nghieng Belgium -0.25", odds: 1.81 },
    ]);
    expect(parsed?.keyPoints).toHaveLength(2);
    expect(parsed?.risks).toHaveLength(2);
  });
});
