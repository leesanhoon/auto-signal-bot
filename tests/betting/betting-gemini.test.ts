import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/shared/openrouter.js", () => ({ callOpenRouter: vi.fn() }));
vi.mock("../../src/shared/ai-usage.js", () => ({ recordOpenRouterUsage: vi.fn() }));
const bettingGemini = await import("../../src/betting/betting-gemini.js");
const openrouter = await import("../../src/shared/openrouter.js");
const aiUsage = await import("../../src/shared/ai-usage.js");
const recordOpenRouterUsage = vi.mocked(aiUsage.recordOpenRouterUsage);

beforeEach(() => {
  recordOpenRouterUsage.mockReset();
  vi.mocked(openrouter.callOpenRouter).mockReset();
});

describe("parseMatchAnalysisResponse", () => {
  test("falls back to flash when analyze pro times out", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          match: "Belgium vs Senegal",
          preferredScoreline: "1-0",
          scoreConfidence: 36,
          recommendation: "Đứng ngoài.",
          confidence: 33,
          picks: [],
          keyPoints: ["Mot", "Hai"],
          risks: ["Bon", "Nam"],
          summary: "Tin hieu yeu.",
        }),
        usage: { promptTokens: 10, completionTokens: 5 },
      });

    const result = await bettingGemini.analyzeMatchOdds({
      gameId: "1",
      home: "Belgium",
      away: "Senegal",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });

    expect(callOpenRouter).toHaveBeenCalledTimes(2);
    expect(callOpenRouter.mock.calls[0][0].model).toBe("deepseek/deepseek-v4-pro");
    expect(callOpenRouter.mock.calls[0][0].plugins).toEqual([{ id: "web", max_results: 3 }]);
    expect(callOpenRouter.mock.calls[1][0].model).toBe("deepseek/deepseek-v4-flash");
    expect(callOpenRouter.mock.calls[1][0].plugins).toBeUndefined();
    expect(result.recommendation).toBe("Đứng ngoài.");
    expect(recordOpenRouterUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          requestCount: 2,
          fallbackUsed: true,
        }),
      }),
    );
  });

  test("falls back to flash immediately when analyze pro returns empty content", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter
      .mockRejectedValueOnce(new Error("empty content"))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          match: "Belgium vs Senegal",
          preferredScoreline: "1-0",
          scoreConfidence: 36,
          recommendation: "Đứng ngoài.",
          confidence: 33,
          picks: [],
          keyPoints: ["Mot", "Hai"],
          risks: ["Bon", "Nam"],
          summary: "Tin hieu yeu.",
        }),
        usage: { promptTokens: 10, completionTokens: 5 },
      });

    await bettingGemini.analyzeMatchOdds({
      gameId: "1",
      home: "Belgium",
      away: "Senegal",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });

    expect(callOpenRouter).toHaveBeenCalledTimes(2);
    expect(callOpenRouter.mock.calls[0][0].model).toBe("deepseek/deepseek-v4-pro");
    expect(callOpenRouter.mock.calls[1][0].model).toBe("deepseek/deepseek-v4-flash");
    expect(recordOpenRouterUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          requestCount: 2,
          fallbackUsed: true,
        }),
      }),
    );
  });

  test("records total request count when the primary analyze request retries", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter
      .mockRejectedValueOnce(new Error("OpenRouter request failed (503): upstream overloaded"))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          match: "Belgium vs Senegal",
          preferredScoreline: "1-0",
          scoreConfidence: 36,
          recommendation: "Đứng ngoài.",
          confidence: 33,
          picks: [],
          keyPoints: ["Mot", "Hai"],
          risks: ["Bon", "Nam"],
          summary: "Tin hieu yeu.",
        }),
        usage: { promptTokens: 10, completionTokens: 5 },
      });

    await bettingGemini.analyzeMatchOdds({
      gameId: "1",
      home: "Belgium",
      away: "Senegal",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });

    expect(recordOpenRouterUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          requestCount: 2,
          fallbackUsed: false,
        }),
      }),
    );
  });

  test("buildAnalyzeMatchOddsRequest uses web once, no reasoning, and reduced token budget", () => {
    const request = bettingGemini.buildAnalyzeMatchOddsRequest({
      gameId: "1",
      home: "Belgium",
      away: "Senegal",
      kickoffUnix: 0,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });

    expect(request.timeoutMs).toBe(75_000);
    expect(request.model).toBe("deepseek/deepseek-v4-pro");
    expect(request.plugins).toEqual([{ id: "web", max_results: 3 }]);
    expect(request.reasoning).toEqual({ effort: "none", exclude: true });
    expect(request.maxTokens).toBe(1400);
    const firstContent = request.userContent[0] as { type: "text"; text: string };
    expect(firstContent.text).toContain('"odds"');
    expect(firstContent.text).toContain('"markets"');
    expect(firstContent.text).not.toContain("CANDIDATES:");
  });

  test("generateCombinedAnalysis records real usage on primary success", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            analysis: "Phan tich",
            preferredScoreline: "1-0",
            scoreConfidence: 51,
            topPicks: [
              { market: "1X2", selection: "Belgium thắng", odds: 2.1, reason: "Ngon", suitability: "parlay" },
            ],
          },
        ],
        parlays: [],
        remainingSingles: [],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    });

    const result = await bettingGemini.generateCombinedAnalysis([
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    ]);

    expect(result?.summary).toBe("Tong quan");
    expect(callOpenRouter).toHaveBeenCalledTimes(1);
    expect(callOpenRouter.mock.calls[0][0].plugins).toEqual([{ id: "web", max_results: 3 }]);
    expect(callOpenRouter.mock.calls[0][0].reasoning).toEqual({ effort: "high" });
    expect(recordOpenRouterUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          stage: "combined",
          requestCount: 1,
          fallbackUsed: false,
          timeoutMs: 240_000,
          inputTokens: 12,
          outputTokens: 34,
          finishReason: "stop",
        }),
      }),
    );
  });

  test("generateCombinedAnalysis records real usage on fallback success", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Tong quan",
          matches: [
            {
              matchIndex: 0,
              matchLabel: "Belgium vs Senegal",
              kickoff: "12:00",
              analysis: "Phan tich",
              preferredScoreline: "1-0",
              scoreConfidence: 51,
              topPicks: [
                { market: "1X2", selection: "Belgium thắng", odds: 2.1, reason: "Ngon", suitability: "parlay" },
              ],
            },
          ],
          parlays: [],
          remainingSingles: [],
        }),
        usage: { promptTokens: 8, completionTokens: 16 },
        finishReason: "stop",
      });

    const result = await bettingGemini.generateCombinedAnalysis([
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    ]);

    expect(result?.summary).toBe("Tong quan");
    expect(callOpenRouter).toHaveBeenCalledTimes(3);
    expect(callOpenRouter.mock.calls[0][0].plugins).toEqual([{ id: "web", max_results: 3 }]);
    expect(callOpenRouter.mock.calls[1][0].plugins).toEqual([{ id: "web", max_results: 3 }]);
    expect(callOpenRouter.mock.calls[2][0].plugins).toBeUndefined();
    expect(callOpenRouter.mock.calls[0][0].reasoning).toEqual({ effort: "high" });
    expect(callOpenRouter.mock.calls[2][0].reasoning).toEqual({ effort: "high" });
    expect(recordOpenRouterUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          stage: "combined",
          requestCount: 3,
          fallbackUsed: true,
          timeoutMs: 240_000,
          inputTokens: 8,
          outputTokens: 16,
          finishReason: "stop",
        }),
      }),
    );
  });

  test("generateCombinedAnalysis falls back when the primary response is truncated", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Tong quan",
          matches: [
            {
              matchIndex: 0,
              matchLabel: "Belgium vs Senegal",
              kickoff: "12:00",
              analysis: "Phan tich",
              preferredScoreline: "1-0",
              scoreConfidence: 51,
              topPicks: [
                { market: "1X2", selection: "Belgium thắng", odds: 2.1, reason: "Ngon", suitability: "parlay" },
              ],
            },
          ],
          parlays: [],
          remainingSingles: [],
        }),
        usage: { promptTokens: 12, completionTokens: 16_000 },
        finishReason: "length",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Tong quan",
          matches: [
            {
              matchIndex: 0,
              matchLabel: "Belgium vs Senegal",
              kickoff: "12:00",
              analysis: "Phan tich",
              preferredScoreline: "1-0",
              scoreConfidence: 51,
              topPicks: [
                { market: "1X2", selection: "Belgium thắng", odds: 2.1, reason: "Ngon", suitability: "parlay" },
              ],
            },
          ],
          parlays: [],
          remainingSingles: [],
        }),
        usage: { promptTokens: 8, completionTokens: 16 },
        finishReason: "stop",
      });

    const result = await bettingGemini.generateCombinedAnalysis([
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    ]);

    expect(result?.summary).toBe("Tong quan");
    expect(callOpenRouter).toHaveBeenCalledTimes(2);
    expect(callOpenRouter.mock.calls[0][0].reasoning).toEqual({ effort: "high" });
    expect(callOpenRouter.mock.calls[1][0].reasoning).toEqual({ effort: "high" });
    expect(recordOpenRouterUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          stage: "combined",
          requestCount: 2,
          fallbackUsed: true,
          timeoutMs: 240_000,
          inputTokens: 8,
          outputTokens: 16,
          finishReason: "stop",
        }),
      }),
    );
  });

  test("hydrates picks by candidateId and filters invalid or duplicate picks", () => {
    const parsed = bettingGemini.parseMatchAnalysisResponse(
      JSON.stringify({
        match: "Belgium vs Senegal",
        preferredScoreline: "1-0",
        scoreConfidence: 36,
        recommendation: "Dat Belgium -0.25",
        confidence: 33,
        picks: [
          { candidateId: "P01" },
          { candidateId: "P04" },
          { candidateId: "P05" },
          { candidateId: "P99" },
        ],
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
        odds: {
          updatedUnix: 0,
          legend: "",
          markets: [
            { key: "h2h", outcomes: [
              { name: "H", price: 2.16 },
              { name: "D", price: 3.2 },
              { name: "A", price: 3.76 },
            ] },
            { key: "asia_handicap", outcomes: [
              { name: "H", point: -0.25, price: 1.81 },
              { name: "A", point: -0.25, price: 2.06 },
            ] },
          ],
        },
      },
    );

    expect(parsed?.recommendation).toBe("Dat Belgium -0.25");
    expect(parsed?.picks).toHaveLength(3);
    expect(parsed?.picks?.[0]).toMatchObject({ candidateId: "P01", market: "1X2", selection: "Belgium thắng", odds: 2.16 });
    expect(parsed?.picks?.[1]).toMatchObject({ candidateId: "P04", market: "Chấp Châu Á", selection: "Belgium -0.25", odds: 1.81 });
    expect(parsed?.picks?.[2]).toMatchObject({ candidateId: "P05", market: "Chấp Châu Á", selection: "Senegal +0.25", odds: 2.06 });
    expect(parsed?.marketViews).toEqual([
      { market: "Chap Chau A", assessment: "Nghieng Belgium -0.25", odds: 1.81 },
    ]);
    expect(parsed?.keyPoints).toHaveLength(2);
    expect(parsed?.risks).toHaveLength(2);
  });

  test("keeps direct picks below the old odds threshold", () => {
    const parsed = bettingGemini.parseMatchAnalysisResponse(
      JSON.stringify({
        match: "Belgium vs Senegal",
        preferredScoreline: "1-0",
        scoreConfidence: 36,
        recommendation: "Theo dõi kèo này",
        confidence: 33,
        picks: [{ market: "1X2", selection: "Belgium thắng", odds: 1.79, reason: "Edge nhẹ" }],
        keyPoints: ["Mot", "Hai"],
        risks: ["Bon", "Nam"],
        summary: "Tin hieu yeu.",
      }),
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: {
          updatedUnix: 0,
          legend: "",
          markets: [
            { key: "h2h", outcomes: [
              { name: "H", price: 1.79 },
              { name: "D", price: 3.2 },
              { name: "A", price: 4.0 },
            ] },
          ],
        },
      },
    );

    expect(parsed?.picks).toHaveLength(1);
    expect(parsed?.picks?.[0]).toMatchObject({
      market: "1X2",
      selection: "Belgium thắng",
      odds: 1.79,
      reason: "Edge nhẹ",
    });
  });

  test("caps hydrated picks at three unique valid selections", () => {
    const parsed = bettingGemini.parseMatchAnalysisResponse(
      JSON.stringify({
        match: "Belgium vs Senegal",
        preferredScoreline: "2-1",
        scoreConfidence: 55,
        recommendation: "Theo dõi kèo này",
        confidence: 61,
        picks: [
          { candidateId: "P01" },
          { candidateId: "P02" },
          { candidateId: "P03" },
          { candidateId: "P04" },
        ],
        keyPoints: ["Mot", "Hai"],
        risks: ["Bon", "Nam"],
        summary: "Tin hieu yeu.",
      }),
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: {
          updatedUnix: 0,
          legend: "",
          markets: [
            { key: "h2h", outcomes: [
              { name: "H", price: 2.16 },
              { name: "D", price: 3.2 },
              { name: "A", price: 3.76 },
            ] },
            { key: "asia_handicap", outcomes: [
              { name: "H", point: -0.25, price: 1.81 },
              { name: "A", point: -0.25, price: 2.06 },
            ] },
          ],
        },
      },
    );

    expect(parsed?.picks).toHaveLength(3);
    expect(parsed?.picks?.map((pick) => pick.candidateId)).toEqual(["P01", "P02", "P03"]);
  });

  test("hydrates revise candidate IDs from the provided catalog", () => {
    const parsed = bettingGemini.parseMatchAnalysisResponse(
      JSON.stringify({
        match: "Belgium vs Senegal",
        preferredScoreline: "2-1",
        scoreConfidence: 55,
        recommendation: "Theo dõi kèo này",
        confidence: 61,
        picks: [{ candidateId: "P05" }],
        keyPoints: ["Mot", "Hai"],
        risks: ["Bon", "Nam"],
        summary: "Tin hieu yeu.",
      }),
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: {
          updatedUnix: 0,
          legend: "",
          markets: [
            { key: "h2h", outcomes: [
              { name: "H", price: 2.16 },
              { name: "D", price: 3.2 },
              { name: "A", price: 3.76 },
            ] },
            { key: "asia_handicap", outcomes: [
              { name: "H", point: -0.25, price: 1.81 },
              { name: "A", point: -0.25, price: 2.06 },
            ] },
          ],
        },
      },
    );

    expect(parsed?.picks).toEqual([
      { candidateId: "P05", market: "Chấp Châu Á", selection: "Senegal +0.25", odds: 2.06 },
    ]);
  });

  test("preserves recommendation when no picks survive validation", () => {
    const parsed = bettingGemini.parseMatchAnalysisResponse(
      JSON.stringify({
        match: "Belgium vs Senegal",
        preferredScoreline: "1-0",
        scoreConfidence: 36,
        recommendation: "Theo dõi kèo này",
        confidence: 33,
        picks: [{ candidateId: "P04" }],
        keyPoints: ["Mot", "Hai"],
        risks: ["Bon", "Nam"],
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

    expect(parsed?.recommendation).toBe("Theo dõi kèo này");
    expect(parsed?.picks).toEqual([]);
  });

  test("falls back to stand aside when recommendation is empty and no valid picks", () => {
    const parsed = bettingGemini.parseMatchAnalysisResponse(
      JSON.stringify({
        match: "Belgium vs Senegal",
        preferredScoreline: "1-0",
        scoreConfidence: 36,
        recommendation: "",
        confidence: 33,
        picks: [{ candidateId: "P04" }],
        keyPoints: ["Mot", "Hai"],
        risks: ["Bon", "Nam"],
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

    expect(parsed?.recommendation).toBe("Đứng ngoài.");
    expect(parsed?.picks).toEqual([]);
  });
});
