import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/shared/openrouter.js", () => ({ callOpenRouter: vi.fn() }));
vi.mock("../../src/shared/ai-usage.js", () => ({
  recordOpenRouterUsage: vi.fn(),
}));
const bettingGemini = await import("../../src/betting/betting-gemini.js");
const openrouter = await import("../../src/shared/openrouter.js");
const aiUsage = await import("../../src/shared/ai-usage.js");
const recordOpenRouterUsage = vi.mocked(aiUsage.recordOpenRouterUsage);

beforeEach(() => {
  recordOpenRouterUsage.mockReset();
  vi.mocked(openrouter.callOpenRouter).mockReset();
  delete process.env.AI_REASONING_EFFORT;
  delete process.env.BETTING_PICKS_MARKET_SCOPE;
});

afterEach(() => {
  delete process.env.BETTING_PICKS_MARKET_SCOPE;
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
    expect(callOpenRouter.mock.calls[0][0].model).toBe(
      "deepseek/deepseek-v4-pro",
    );
    expect(callOpenRouter.mock.calls[0][0].plugins).toEqual([
      { id: "web", max_results: 3 },
    ]);
    expect(callOpenRouter.mock.calls[1][0].model).toBe(
      "deepseek/deepseek-v4-flash",
    );
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
    expect(callOpenRouter.mock.calls[0][0].model).toBe(
      "deepseek/deepseek-v4-pro",
    );
    expect(callOpenRouter.mock.calls[1][0].model).toBe(
      "deepseek/deepseek-v4-flash",
    );
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
      .mockRejectedValueOnce(
        new Error("OpenRouter request failed (503): upstream overloaded"),
      )
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
    const firstContent = request.userContent[0] as {
      type: "text";
      text: string;
    };
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
              {
                market: "Tổng bàn châu Âu",
                selection: "Tài 2.5",
                odds: 1.85,
                reason: "Ngon",
                suitability: "single",
              },
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
    expect(callOpenRouter.mock.calls[0][0].plugins).toEqual([
      { id: "web", max_results: 3 },
    ]);
    expect(callOpenRouter.mock.calls[0][0].reasoning).toEqual({
      effort: "medium",
    });
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
                {
                  market: "Tổng bàn châu Âu",
                  selection: "Tài 2.5",
                  odds: 1.85,
                  reason: "Ngon",
                  suitability: "single",
                },
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
    expect(callOpenRouter.mock.calls[0][0].plugins).toEqual([
      { id: "web", max_results: 3 },
    ]);
    expect(callOpenRouter.mock.calls[1][0].plugins).toEqual([
      { id: "web", max_results: 3 },
    ]);
    expect(callOpenRouter.mock.calls[2][0].plugins).toBeUndefined();
    expect(callOpenRouter.mock.calls[0][0].reasoning).toEqual({
      effort: "medium",
    });
    expect(callOpenRouter.mock.calls[2][0].reasoning).toEqual({
      effort: "medium",
    });
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
                {
                  market: "Tổng bàn châu Âu",
                  selection: "Tài 2.5",
                  odds: 1.85,
                  reason: "Ngon",
                  suitability: "single",
                },
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
                {
                  market: "Tổng bàn châu Âu",
                  selection: "Tài 2.5",
                  odds: 1.85,
                  reason: "Ngon",
                  suitability: "single",
                },
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
    expect(callOpenRouter.mock.calls[0][0].reasoning).toEqual({
      effort: "medium",
    });
    expect(callOpenRouter.mock.calls[1][0].reasoning).toEqual({
      effort: "medium",
    });
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
        marketViews: [
          {
            market: "Chap Chau A",
            assessment: "Nghieng Belgium -0.25",
            odds: 1.81,
          },
        ],
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
            {
              key: "h2h",
              outcomes: [
                { name: "H", price: 2.16 },
                { name: "D", price: 3.2 },
                { name: "A", price: 3.76 },
              ],
            },
            {
              key: "asia_handicap",
              outcomes: [
                { name: "H", point: -0.25, price: 1.81 },
                { name: "A", point: -0.25, price: 2.06 },
              ],
            },
          ],
        },
      },
    );

    expect(parsed?.recommendation).toBe("Dat Belgium -0.25");
    expect(parsed?.picks).toHaveLength(3);
    expect(parsed?.picks?.[0]).toMatchObject({
      candidateId: "P01",
      market: "1X2",
      selection: "Belgium thắng",
      odds: 2.16,
    });
    expect(parsed?.picks?.[1]).toMatchObject({
      candidateId: "P04",
      market: "Chấp Châu Á",
      selection: "Belgium -0.25",
      odds: 1.81,
    });
    expect(parsed?.picks?.[2]).toMatchObject({
      candidateId: "P05",
      market: "Chấp Châu Á",
      selection: "Senegal +0.25",
      odds: 2.06,
    });
    expect(parsed?.marketViews).toEqual([
      {
        market: "Chap Chau A",
        assessment: "Nghieng Belgium -0.25",
        odds: 1.81,
      },
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
        picks: [
          {
            market: "1X2",
            selection: "Belgium thắng",
            odds: 1.79,
            reason: "Edge nhẹ",
          },
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
            {
              key: "h2h",
              outcomes: [
                { name: "H", price: 1.79 },
                { name: "D", price: 3.2 },
                { name: "A", price: 4.0 },
              ],
            },
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
            {
              key: "h2h",
              outcomes: [
                { name: "H", price: 2.16 },
                { name: "D", price: 3.2 },
                { name: "A", price: 3.76 },
              ],
            },
            {
              key: "asia_handicap",
              outcomes: [
                { name: "H", point: -0.25, price: 1.81 },
                { name: "A", point: -0.25, price: 2.06 },
              ],
            },
          ],
        },
      },
    );

    expect(parsed?.picks).toHaveLength(3);
    expect(parsed?.picks?.map((pick) => pick.candidateId)).toEqual([
      "P01",
      "P02",
      "P03",
    ]);
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
            {
              key: "h2h",
              outcomes: [
                { name: "H", price: 2.16 },
                { name: "D", price: 3.2 },
                { name: "A", price: 3.76 },
              ],
            },
            {
              key: "asia_handicap",
              outcomes: [
                { name: "H", point: -0.25, price: 1.81 },
                { name: "A", point: -0.25, price: 2.06 },
              ],
            },
          ],
        },
      },
    );

    expect(parsed?.picks).toEqual([
      {
        candidateId: "P05",
        market: "Chấp Châu Á",
        selection: "Senegal +0.25",
        odds: 2.06,
      },
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

  test("generateCombinedAnalysis respects AI_REASONING_EFFORT env var", async () => {
    process.env.AI_REASONING_EFFORT = "high";
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [],
        parlays: [],
        remainingSingles: [],
      }),
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    await bettingGemini.generateCombinedAnalysis([
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    ]);

    expect(callOpenRouter.mock.calls[0][0].reasoning).toEqual({
      effort: "high",
    });
  });

  test("generateBettingPlan respects AI_REASONING_EFFORT env var", async () => {
    process.env.AI_REASONING_EFFORT = "low";
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Plan summary",
        matches: [],
        parlays: [],
        remainingSingles: [],
      }),
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    await bettingGemini.generateBettingPlan(
      [
        {
          gameId: "1",
          home: "Belgium",
          away: "Senegal",
          kickoffUnix: 0,
          odds: { updatedUnix: 0, legend: "", markets: [] },
        },
      ],
      [
        {
          match: "Belgium vs Senegal",
          preferredScoreline: "1-0",
          scoreConfidence: 50,
          recommendation: "Bet Belgium",
          confidence: 75,
          picks: [],
          keyPoints: [],
          risks: [],
          summary: "Summary",
        },
      ],
    );

    expect(callOpenRouter.mock.calls[0][0].reasoning).toEqual({
      effort: "low",
    });
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

describe("combined analysis — totals-only picks filter", () => {
  test("a. Lọc bỏ pick không phải tài/xỉu", async () => {
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
              {
                market: "1X2",
                selection: "Belgium thắng",
                odds: 2.1,
                reason: "Strong team",
                suitability: "parlay",
              },
              {
                market: "Tổng bàn châu Âu",
                selection: "Tài 2.5",
                odds: 1.85,
                reason: "Ngon",
                suitability: "single",
              },
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

    expect(result?.matches[0].topPicks).toHaveLength(1);
    expect(result?.matches[0].topPicks[0].market).toBe("Tổng bàn châu Âu");
    expect(result?.matches[0].topPicks[0].selection).toBe("Tài 2.5");
  });

  test("b. Không lọc nhầm tổng góc", async () => {
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
              {
                market: "Tổng góc",
                selection: "Tài 9.5",
                odds: 1.9,
                reason: "Corner-related",
                suitability: "single",
              },
              {
                market: "Tổng bàn châu Âu",
                selection: "Tài 2.5",
                odds: 1.85,
                reason: "Goals estimate",
                suitability: "single",
              },
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

    expect(result?.matches[0].topPicks).toHaveLength(1);
    expect(result?.matches[0].topPicks[0].market).toBe("Tổng bàn châu Âu");
    expect(result?.matches[0].topPicks[0].selection).toBe("Tài 2.5");
  });

  test("c. topPicks toàn bộ hợp lệ tài/xỉu → giữ nguyên", async () => {
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
              {
                market: "Tổng bàn châu Á",
                selection: "Tài 2.25",
                odds: 1.9,
                reason: "Reason 1",
                suitability: "single",
              },
              {
                market: "Tổng bàn châu Âu",
                selection: "Xỉu 2.5",
                odds: 1.95,
                reason: "Reason 2",
                suitability: "single",
              },
              {
                market: "KQ+Tổng",
                selection: "Home & Tài 2.5",
                odds: 2.05,
                reason: "Reason 3",
                suitability: "single",
              },
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

    expect(result?.matches[0].topPicks).toHaveLength(3);
    expect(result?.matches[0].topPicks[0].market).toBe("Tổng bàn châu Á");
    expect(result?.matches[0].topPicks[1].market).toBe("Tổng bàn châu Âu");
    expect(result?.matches[0].topPicks[2].market).toBe("KQ+Tổng");
  });

  test("d. topPicks rỗng sau khi lọc → không throw, trả mảng rỗng", async () => {
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
              {
                market: "1X2",
                selection: "Belgium thắng",
                odds: 2.1,
                reason: "Strong team",
                suitability: "parlay",
              },
              {
                market: "Chấp Châu Á",
                selection: "Belgium -0.5",
                odds: 1.9,
                reason: "Handicap",
                suitability: "single",
              },
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

    expect(result?.matches[0].topPicks).toEqual([]);
  });

  test("e. Rollback qua env BETTING_PICKS_MARKET_SCOPE=all", async () => {
    // Set env var before reloading modules
    process.env.BETTING_PICKS_MARKET_SCOPE = "all";

    // Reset all modules to force reimport with new env var
    vi.resetModules();

    // Reimport modules with env var set
    const bettingGeminiReloaded = await import("../../src/betting/betting-gemini.js");

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
              {
                market: "1X2",
                selection: "Belgium thắng",
                odds: 2.1,
                reason: "Strong team",
                suitability: "parlay",
              },
            ],
          },
        ],
        parlays: [],
        remainingSingles: [],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    });

    const result = await bettingGeminiReloaded.generateCombinedAnalysis([
      {
        gameId: "1",
        home: "Belgium",
        away: "Senegal",
        kickoffUnix: 0,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    ]);

    expect(result?.matches[0].topPicks).toHaveLength(1);
    expect(result?.matches[0].topPicks[0].market).toBe("1X2");
    expect(result?.matches[0].topPicks[0].selection).toBe("Belgium thắng");
  });
});

describe("generateCombinedAnalysis — match coverage validation", () => {
  test("Test 1: Detects missing matches in primary and triggers fallback", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    // Primary response: only 1 match (missing matchIndex 1)
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
                {
                  market: "Tổng bàn châu Âu",
                  selection: "Tài 2.5",
                  odds: 1.85,
                  reason: "Ngon",
                  suitability: "single",
                },
              ],
            },
          ],
          parlays: [],
          remainingSingles: [],
        }),
        usage: { promptTokens: 12, completionTokens: 34 },
        finishReason: "stop",
      })
      // Fallback response: 2 matches (complete coverage)
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
                {
                  market: "Tổng bàn châu Âu",
                  selection: "Tài 2.5",
                  odds: 1.85,
                  reason: "Ngon",
                  suitability: "single",
                },
              ],
            },
            {
              matchIndex: 1,
              matchLabel: "Spain vs Austria",
              kickoff: "14:00",
              analysis: "Analysis for Spain",
              preferredScoreline: "2-0",
              scoreConfidence: 60,
              topPicks: [
                {
                  market: "Tổng bàn châu Âu",
                  selection: "Xỉu 2.5",
                  odds: 1.90,
                  reason: "Defensive",
                  suitability: "single",
                },
              ],
            },
          ],
          parlays: [],
          remainingSingles: [],
        }),
        usage: { promptTokens: 8, completionTokens: 40 },
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
      {
        gameId: "2",
        home: "Spain",
        away: "Austria",
        kickoffUnix: 3600,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    ]);

    // Verify callOpenRouter was called exactly 2 times (primary + fallback)
    expect(callOpenRouter).toHaveBeenCalledTimes(2);

    // Verify fallback model was used (second call)
    expect(callOpenRouter.mock.calls[1][0].model).toBe(
      "deepseek/deepseek-v4-flash",
    );

    // Verify result has full coverage (2 matches)
    expect(result?.matches).toHaveLength(2);
    expect(result?.matches[0].matchIndex).toBe(0);
    expect(result?.matches[1].matchIndex).toBe(1);
    expect(result?.summary).toBe("Tong quan");
  });

  test("Test 2: Graceful degradation when both primary and fallback are missing matches", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    // Primary response: only 1 match (missing matchIndex 1)
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
                {
                  market: "Tổng bàn châu Âu",
                  selection: "Tài 2.5",
                  odds: 1.85,
                  reason: "Ngon",
                  suitability: "single",
                },
              ],
            },
          ],
          parlays: [],
          remainingSingles: [],
        }),
        usage: { promptTokens: 12, completionTokens: 34 },
        finishReason: "stop",
      })
      // Fallback response: also only 1 match (missing matchIndex 1)
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
                {
                  market: "Tổng bàn châu Âu",
                  selection: "Tài 2.5",
                  odds: 1.85,
                  reason: "Ngon",
                  suitability: "single",
                },
              ],
            },
          ],
          parlays: [],
          remainingSingles: [],
        }),
        usage: { promptTokens: 8, completionTokens: 30 },
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
      {
        gameId: "2",
        home: "Spain",
        away: "Austria",
        kickoffUnix: 3600,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    ]);

    // Verify callOpenRouter was called exactly 2 times (primary + fallback attempt)
    expect(callOpenRouter).toHaveBeenCalledTimes(2);

    // Verify result is NOT null (graceful degradation)
    expect(result).not.toBeNull();
    expect(result?.matches).toHaveLength(1);
    expect(result?.matches[0].matchIndex).toBe(0);
    expect(result?.summary).toBe("Tong quan");
  });

  test("Test 3: Full coverage from primary doesn't trigger fallback (regression test)", async () => {
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
              {
                market: "Tổng bàn châu Âu",
                selection: "Tài 2.5",
                odds: 1.85,
                reason: "Ngon",
                suitability: "single",
              },
            ],
          },
          {
            matchIndex: 1,
            matchLabel: "Spain vs Austria",
            kickoff: "14:00",
            analysis: "Analysis for Spain",
            preferredScoreline: "2-0",
            scoreConfidence: 60,
            topPicks: [
              {
                market: "Tổng bàn châu Âu",
                selection: "Xỉu 2.5",
                odds: 1.90,
                reason: "Defensive",
                suitability: "single",
              },
            ],
          },
        ],
        parlays: [],
        remainingSingles: [],
      }),
      usage: { promptTokens: 12, completionTokens: 40 },
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
      {
        gameId: "2",
        home: "Spain",
        away: "Austria",
        kickoffUnix: 3600,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    ]);

    // Verify callOpenRouter was called only once (no fallback needed)
    expect(callOpenRouter).toHaveBeenCalledTimes(1);

    // Verify result has full coverage
    expect(result?.matches).toHaveLength(2);
    expect(result?.summary).toBe("Tong quan");
  });
});

describe("findMissingMatchIndexesForTest", () => {
  test("Test 4a: Empty matches array returns all indexes as missing", () => {
    const missing = bettingGemini.findMissingMatchIndexesForTest([], 3);
    expect(missing).toEqual([0, 1, 2]);
  });

  test("Test 4b: Missing middle index is detected", () => {
    const missing = bettingGemini.findMissingMatchIndexesForTest(
      [
        { matchIndex: 0, matchLabel: "A vs B", kickoff: "", analysis: "", topPicks: [] },
        { matchIndex: 2, matchLabel: "C vs D", kickoff: "", analysis: "", topPicks: [] },
      ],
      3,
    );
    expect(missing).toEqual([1]);
  });

  test("Test 4c: Missing last index is detected", () => {
    const missing = bettingGemini.findMissingMatchIndexesForTest(
      [
        { matchIndex: 0, matchLabel: "A vs B", kickoff: "", analysis: "", topPicks: [] },
        { matchIndex: 1, matchLabel: "B vs C", kickoff: "", analysis: "", topPicks: [] },
      ],
      3,
    );
    expect(missing).toEqual([2]);
  });

  test("Test 4d: Full coverage returns empty array", () => {
    const missing = bettingGemini.findMissingMatchIndexesForTest(
      [
        { matchIndex: 0, matchLabel: "A vs B", kickoff: "", analysis: "", topPicks: [] },
        { matchIndex: 1, matchLabel: "B vs C", kickoff: "", analysis: "", topPicks: [] },
        { matchIndex: 2, matchLabel: "C vs D", kickoff: "", analysis: "", topPicks: [] },
      ],
      3,
    );
    expect(missing).toEqual([]);
  });

  test("Test 4e: Duplicate matchIndex is not counted as missing", () => {
    const missing = bettingGemini.findMissingMatchIndexesForTest(
      [
        { matchIndex: 0, matchLabel: "A vs B", kickoff: "", analysis: "", topPicks: [] },
        { matchIndex: 1, matchLabel: "B vs C", kickoff: "", analysis: "", topPicks: [] },
        { matchIndex: 1, matchLabel: "B vs C dup", kickoff: "", analysis: "", topPicks: [] },
      ],
      3,
    );
    expect(missing).toEqual([2]);
  });

  test("Test 4f: Zero payloadCount returns empty array", () => {
    const missing = bettingGemini.findMissingMatchIndexesForTest(
      [
        { matchIndex: 0, matchLabel: "A vs B", kickoff: "", analysis: "", topPicks: [] },
      ],
      0,
    );
    expect(missing).toEqual([]);
  });
});

describe("combined analysis prompt — xiên 3 correct score spec", () => {
  const testPayloads = [
    {
      gameId: "1",
      home: "Portugal",
      away: "Croatia",
      kickoffUnix: Math.floor(Date.now() / 1000) + 86400,
      odds: {
        updatedUnix: Math.floor(Date.now() / 1000),
        legend: "1 = Home | 2 = Away",
        markets: [
          {
            name: "1X2",
            outcomes: [
              { name: "1", price: 2.1 },
              { name: "X", price: 3.3 },
              { name: "2", price: 3.8 },
            ],
          },
          {
            name: "GG/NG (Both teams score)",
            outcomes: [
              { name: "GG", price: 1.8 },
              { name: "NG", price: 2.0 },
            ],
          },
          {
            name: "Tổng bàn châu Âu",
            outcomes: [
              { name: "Tài 2.5", price: 1.85 },
              { name: "Xỉu 2.5", price: 1.95 },
            ],
          },
        ],
      },
      correctScore: [
        { score: "1-0", price: 6.0 },
        { score: "2-0", price: 8.5 },
        { score: "2-1", price: 7.5 },
        { score: "1-1", price: 6.5 },
      ],
    },
    {
      gameId: "2",
      home: "Spain",
      away: "Italy",
      kickoffUnix: Math.floor(Date.now() / 1000) + 86400,
      odds: {
        updatedUnix: Math.floor(Date.now() / 1000),
        legend: "1 = Home | 2 = Away",
        markets: [
          {
            name: "1X2",
            outcomes: [
              { name: "1", price: 2.0 },
              { name: "X", price: 3.2 },
              { name: "2", price: 4.0 },
            ],
          },
          {
            name: "GG/NG (Both teams score)",
            outcomes: [
              { name: "GG", price: 1.7 },
              { name: "NG", price: 2.1 },
            ],
          },
        ],
      },
      correctScore: [
        { score: "1-0", price: 6.5 },
        { score: "2-1", price: 7.0 },
      ],
    },
    {
      gameId: "3",
      home: "Germany",
      away: "France",
      kickoffUnix: Math.floor(Date.now() / 1000) + 86400,
      odds: {
        updatedUnix: Math.floor(Date.now() / 1000),
        legend: "1 = Home | 2 = Away",
        markets: [
          {
            name: "1X2",
            outcomes: [
              { name: "1", price: 2.5 },
              { name: "X", price: 3.1 },
              { name: "2", price: 2.8 },
            ],
          },
          {
            name: "Tổng bàn châu Âu",
            outcomes: [
              { name: "Tài 2.5", price: 1.9 },
              { name: "Xỉu 2.5", price: 1.9 },
            ],
          },
        ],
      },
      correctScore: [
        { score: "1-1", price: 6.0 },
        { score: "2-1", price: 7.5 },
      ],
    },
  ];

  test("buildCombinedSystemPrompt(3) must contain 'xiên 3' spec with correct score context", () => {
    const prompt = bettingGemini.buildCombinedSystemPrompt(3);
    expect(prompt).toContain("Xiên 3:");
    expect(prompt).toContain("Tỷ số chính xác");
    expect(prompt).toContain("MỖI xiên 3 phải có ĐÚNG 3 chân");
    expect(prompt).toContain("ít nhất 1 chân");
  });

  test("buildCombinedUserPrompt(3 payloads) must contain xiên 3 JSON example with correct score leg", () => {
    const prompt = bettingGemini.buildCombinedUserPrompt(testPayloads as any);
    expect(prompt).toContain('"type": "xiên 3"');
    expect(prompt).toContain('"market": "Tỷ số chính xác"');
    expect(prompt).toContain('"combinedOdds": 16.32');
    expect(prompt).toContain('"potentialWin": 816000');
  });

  test("Prompt must contain constraint sentence with BẮT BUỘC related to xiên 3", () => {
    const prompt = bettingGemini.buildCombinedSystemPrompt(3);
    expect(prompt).toContain("BẮT BUỘC");
    expect(prompt).toContain("xiên 3");
  });
});


describe("parseCombinedAnalysisResponse — score fields normalization", () => {
  test("Test 1: AI trả preferredScoreline empty-String cho 1/2 match — match đó default", async () => {
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
            preferredScoreline: "2-1",
            scoreConfidence: 80,
            topPicks: [{ market: "Tổng bàn châu Âu", selection: "Tài 2.5", odds: 1.85, reason: "OK", suitability: "single" }],
          },
          {
            matchIndex: 1,
            matchLabel: "Brazil vs Argentina",
            kickoff: "18:00",
            analysis: "Phan tich 2",
            preferredScoreline: "",
            scoreConfidence: 70,
            topPicks: [{ market: "Tổng bàn châu Âu", selection: "Xỉu 2.5", odds: 1.9, reason: "OK", suitability: "single" }],
          },
        ],
        parlays: [],
        remainingSingles: [],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    });

    const result = await bettingGemini.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
      { gameId: "2", home: "Brazil", away: "Argentina", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].preferredScoreline).toBe("2-1");
    expect(result?.matches[1].preferredScoreline).toBe("Chưa có tỷ số ưu tiên");
  });

  test("Test 2: AI thiếu scoreConfidence — default 0", async () => {
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
            // scoreConfidence intentionally missing
            topPicks: [{ market: "Tổng bàn châu Âu", selection: "Tài 2.5", odds: 1.85, reason: "OK", suitability: "single" }],
          },
        ],
        parlays: [],
        remainingSingles: [],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    });

    const result = await bettingGemini.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].scoreConfidence).toBe(0);
  });

  test("Test 3: AI trả scoreConfidence: 150 — clamp về 100", async () => {
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
            scoreConfidence: 150,
            topPicks: [{ market: "Tổng bàn châu Âu", selection: "Tài 2.5", odds: 1.85, reason: "OK", suitability: "single" }],
          },
        ],
        parlays: [],
        remainingSingles: [],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    });

    const result = await bettingGemini.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].scoreConfidence).toBe(100);
  });

  test("Test 4: Unit test normalizeCombinedMatchForTest", () => {
    const fullMatch = {
      matchIndex: 0,
      matchLabel: "Belgium vs Senegal",
      kickoff: "12:00",
      analysis: "Phan tich",
      preferredScoreline: "2-1",
      scoreConfidence: 85,
      topPicks: [{ market: "1X2", selection: "1", odds: 2.0, reason: "OK", suitability: "single" }],
      keyPoints: ["Point 1"],
      risks: ["Risk 1"],
    };
    const resultFull = bettingGemini.normalizeCombinedMatchForTest(fullMatch, "Trận 0");
    expect(resultFull.matchLabel).toBe("Belgium vs Senegal");
    expect(resultFull.kickoff).toBe("12:00");
    expect(resultFull.preferredScoreline).toBe("2-1");
    expect(resultFull.scoreConfidence).toBe(85);
    expect(resultFull.keyPoints).toEqual(["Point 1"]);
    expect(resultFull.risks).toEqual(["Risk 1"]);

    const partialMatch = {
      matchIndex: 1,
      analysis: "Phan tich 2",
      scoreConfidence: undefined,
      topPicks: [{ market: "1X2", selection: "1", odds: 2.0, reason: "OK", suitability: "single" }],
    };
    const resultPartial = bettingGemini.normalizeCombinedMatchForTest(partialMatch, "Trận 1");
    expect(resultPartial.matchLabel).toBe("Trận 1");
    expect(resultPartial.kickoff).toBe("");
    expect(resultPartial.preferredScoreline).toBe("Chưa có tỷ số ưu tiên");
        expect(resultPartial.scoreConfidence).toBe(0);
        expect(resultPartial.keyPoints).toEqual([]);
        expect(resultPartial.risks).toEqual([]);
      });
    });

    describe("remainingSingles — validation & coverage", () => {
      const validSingle = {
        matchIndex: 0,
        matchLabel: "Belgium vs Senegal",
        betType: "Tỷ số chính xác",
        pick: { market: "Tỷ số chính xác", selection: "2-0", odds: 6.5, reason: "ngắn" },
        stake: 800000,
        potentialWin: 5200000,
      };

      test("sanitizeRemainingSingles — all valid items kept", () => {
        const input = [validSingle];
        const result = bettingGemini.sanitizeRemainingSinglesForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].matchIndex).toBe(0);
        expect(result[0].pick.market).toBe("Tỷ số chính xác");
        expect(result[0].pick.odds).toBe(6.5);
        expect(result[0].stake).toBe(800000);
      });

      test("sanitizeRemainingSingles — item missing pick.odds or odds <= 0 is removed", () => {
        const input = [
          validSingle,
          {
            matchIndex: 1,
            matchLabel: "Brazil vs Argentina",
            betType: "Tỷ số chính xác",
            pick: { market: "Tỷ số chính xác", selection: "1-0", odds: 0, reason: "ngắn" },
            stake: 500000,
            potentialWin: 5000000,
          },
        ];
        const result = bettingGemini.sanitizeRemainingSinglesForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].matchIndex).toBe(0);
      });

      test("sanitizeRemainingSingles — item with matchIndex out of range is removed", () => {
        const input = [
          validSingle,
          { ...validSingle, matchIndex: 99 },
        ];
        const result = bettingGemini.sanitizeRemainingSinglesForTest(input, 2);
        expect(result).toHaveLength(1);
        expect(result[0].matchIndex).toBe(0);
      });

      test("sanitizeRemainingSingles — input not array returns []", () => {
        expect(bettingGemini.sanitizeRemainingSinglesForTest(null, 2)).toEqual([]);
        expect(bettingGemini.sanitizeRemainingSinglesForTest(undefined, 2)).toEqual([]);
        expect(bettingGemini.sanitizeRemainingSinglesForTest({}, 2)).toEqual([]);
      });

      test("findMissingSingleMatchIndexes — singles only cover index 0 with payloadCount=3 returns [1, 2]", () => {
        const singles = [validSingle];
        const missing = bettingGemini.findMissingSingleMatchIndexesForTest(singles, 3);
        expect(missing).toEqual([1, 2]);
      });

      test("sanitizeRemainingSingles — item with missing stake is removed", () => {
        const input = [
          validSingle,
          {
            matchIndex: 1,
            matchLabel: "Brazil vs Argentina",
            betType: "Tỷ số chính xác",
            pick: { market: "Tỷ số chính xác", selection: "1-0", odds: 6.0, reason: "ngắn" },
            // stake missing
            potentialWin: 5000000,
          },
        ];
        const result = bettingGemini.sanitizeRemainingSinglesForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].matchIndex).toBe(0);
      });

      test("sanitizeRemainingSingles — item with invalid potentialWin is removed", () => {
        const input = [
          validSingle,
          {
            matchIndex: 1,
            matchLabel: "Brazil vs Argentina",
            betType: "Tỷ số chính xác",
            pick: { market: "Tỷ số chính xác", selection: "1-0", odds: 6.0, reason: "ngắn" },
            stake: 500000,
            potentialWin: "invalid",
          },
        ];
        const result = bettingGemini.sanitizeRemainingSinglesForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].matchIndex).toBe(0);
      });

      test("Integration: generateCombinedAnalysis removes invalid single but does not trigger fallback", async () => {
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
                preferredScoreline: "2-1",
                scoreConfidence: 80,
                topPicks: [{ market: "Tổng bàn châu Âu", selection: "Tài 2.5", odds: 1.85, reason: "OK", suitability: "single" }],
              },
              {
                matchIndex: 1,
                matchLabel: "Brazil vs Argentina",
                kickoff: "15:00",
                analysis: "Phan tich",
                preferredScoreline: "1-0",
                scoreConfidence: 70,
                topPicks: [{ market: "Tổng bàn châu Âu", selection: "Xỉu 2.5", odds: 1.9, reason: "OK", suitability: "single" }],
              },
            ],
            parlays: [],
            remainingSingles: [
              {
                matchIndex: 0,
                matchLabel: "Belgium vs Senegal",
                betType: "Tỷ số chính xác",
                pick: { market: "Tỷ số chính xác", selection: "2-0", odds: 6.5, reason: "ngắn" },
                stake: 800000,
                potentialWin: 5200000,
              },
              {
                matchIndex: 1,
                matchLabel: "Brazil vs Argentina",
                betType: "Tỷ số chính xác",
                pick: { market: "Tỷ số chính xác", selection: "1-0", odds: 6.0, reason: "ngắn" },
                // stake missing — should be removed
              },
            ],
          }),
          usage: { promptTokens: 12, completionTokens: 34 },
          finishReason: "stop",
        });

        const result = await bettingGemini.generateCombinedAnalysis([
          { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
          { gameId: "2", home: "Brazil", away: "Argentina", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
        ]);

        // Result should be non-null with 1 valid single (the invalid one removed)
        expect(result).not.toBeNull();
        expect(result!.remainingSingles).toHaveLength(1);
        expect(result!.remainingSingles[0].matchIndex).toBe(0);

        // Verify callOpenRouter was NOT called again (no fallback triggered)
        expect(callOpenRouter).toHaveBeenCalledTimes(1);
      });

      // Edge-case 1: parseDirectPicks — dedupe on market+selection when resolvedId is undefined
      test("parseDirectPicks — dedupes picks with same market+selection when no candidateId", () => {
        const payload: MatchOddsPayload = {
          gameId: "1",
          home: "Belgium",
          away: "Senegal",
          kickoffUnix: 0,
          odds: { updatedUnix: 0, legend: "", markets: [] },
        };
        const rawPicks = [
          {
            market: "Tỷ số chính xác",
            selection: "2-0",
            odds: 6.5,
            reason: "Đội nhà mạnh",
          },
          {
            // Same market+selection, no candidateId, should be deduplicated
            market: "Tỷ số chính xác",
            selection: "2-0",
            odds: 6.5,
            reason: "Đội nhà chiếm ưu thế",
          },
          {
            market: "Tổng bàn châu Âu",
            selection: "Tài 2.5",
            odds: 1.8,
            reason: "Tấn công mạnh",
          },
        ];
        const result = bettingGemini.parseDirectPicksForTest(rawPicks, payload);
        // Only 2 picks should remain (duplicate market+selection removed)
        expect(result).toHaveLength(2);
        expect(result[0].market).toBe("Tỷ số chính xác");
        expect(result[0].selection).toBe("2-0");
        expect(result[1].market).toBe("Tổng bàn châu Âu");
        expect(result[1].selection).toBe("Tài 2.5");
      });

      test("parseDirectPicks — respects case-insensitive and whitespace-trimmed dedupe for market+selection", () => {
        const payload: MatchOddsPayload = {
          gameId: "1",
          home: "Belgium",
          away: "Senegal",
          kickoffUnix: 0,
          odds: { updatedUnix: 0, legend: "", markets: [] },
        };
        const rawPicks = [
          {
            market: "Tỷ Số Chính Xác",
            selection: "2-0",
            odds: 6.5,
            reason: "Đội nhà mạnh",
          },
          {
            // Same market+selection (different casing + extra whitespace), no candidateId
            market: "  tỷ số chính xác  ",
            selection: "  2-0  ",
            odds: 6.5,
            reason: "Đội nhà chiếm ưu thế",
          },
        ];
        const result = bettingGemini.parseDirectPicksForTest(rawPicks, payload);
        // Only 1 pick should remain
        expect(result).toHaveLength(1);
        expect(result[0].market).toBe("Tỷ Số Chính Xác");
        expect(result[0].selection).toBe("2-0");
      });

      test("parseDirectPicks — does not dedupe on market+selection when both have candidateId with id", () => {
        const payload: MatchOddsPayload = {
          gameId: "1",
          home: "Belgium",
          away: "Senegal",
          kickoffUnix: 0,
          odds: { updatedUnix: 0, legend: "", markets: [] },
        };
        const rawPicks = [
          {
            market: "Tỷ số chính xác",
            selection: "2-0",
            odds: 6.5,
            reason: "Đội nhà mạnh",
            // no candidateId
          },
          {
            // Same market+selection BUT has candidateId (which won't match anything in this empty payload)
            candidateId: "some-id",
            market: "Tỷ số chính xác",
            selection: "2-0",
            odds: 6.5,
            reason: "Đội nhà chiếm ưu thế",
          },
        ];
        const result = bettingGemini.parseDirectPicksForTest(rawPicks, payload);
        // Both should remain (one via market+selection dedupe, one via candidateId)
        // Since the candidateId doesn't exist in payload, it won't match, so both stay
        expect(result).toHaveLength(2);
      });

      // Edge-case 2: sanitizeRemainingSingles — dedupe on (matchIndex, betType) pair
      test("sanitizeRemainingSingles — dedupes singles with same matchIndex and betType", () => {
        const input = [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            betType: "Main",
            pick: { market: "Tỷ số chính xác", selection: "2-0", odds: 6.5, reason: "ngắn" },
            stake: 800000,
            potentialWin: 5200000,
          },
          {
            // Same matchIndex and betType, should be deduplicated
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            betType: "Main",
            pick: { market: "Tỷ số chính xác", selection: "2-0", odds: 6.5, reason: "ngắn" },
            stake: 500000,
            potentialWin: 3250000,
          },
          {
            matchIndex: 1,
            matchLabel: "Brazil vs Argentina",
            betType: "Tỷ số chính xác",
            pick: { market: "Tỷ số chính xác", selection: "1-0", odds: 6.0, reason: "ngắn" },
            stake: 600000,
            potentialWin: 3600000,
          },
        ];
        const result = bettingGemini.sanitizeRemainingSinglesForTest(input, 3);
        // Only 2 singles should remain (duplicate matchIndex+betType removed)
        expect(result).toHaveLength(2);
        expect(result[0].matchIndex).toBe(0);
        expect(result[0].betType).toBe("Main");
        expect(result[1].matchIndex).toBe(1);
        expect(result[1].betType).toBe("Tỷ số chính xác");
      });

      test("sanitizeRemainingSingles — respects case-insensitive betType dedupe", () => {
        const input = [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            betType: "Main",
            pick: { market: "Tỷ số chính xác", selection: "2-0", odds: 6.5, reason: "ngắn" },
            stake: 800000,
            potentialWin: 5200000,
          },
          {
            // Same matchIndex, betType with different casing and whitespace
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            betType: "  MAIN  ",
            pick: { market: "Tỷ số chính xác", selection: "2-0", odds: 6.5, reason: "ngắn" },
            stake: 500000,
            potentialWin: 3250000,
          },
        ];
        const result = bettingGemini.sanitizeRemainingSinglesForTest(input, 3);
        // Only 1 single should remain
        expect(result).toHaveLength(1);
        expect(result[0].matchIndex).toBe(0);
        expect(result[0].betType).toBe("Main");
      });

      test("sanitizeRemainingSingles — keeps both when same matchIndex but different betType", () => {
        const input = [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            betType: "Main",
            pick: { market: "Tổng bàn châu Âu", selection: "Tài 2.5", odds: 1.85, reason: "OK" },
            stake: 800000,
            potentialWin: 1480000,
          },
          {
            // Same matchIndex but different betType — should NOT be deduplicated
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            betType: "Tỷ số chính xác",
            pick: { market: "Tỷ số chính xác", selection: "2-0", odds: 6.5, reason: "ngắn" },
            stake: 500000,
            potentialWin: 3250000,
          },
        ];
        const result = bettingGemini.sanitizeRemainingSinglesForTest(input, 3);
        // Both should remain (different betType)
        expect(result).toHaveLength(2);
        expect(result[0].matchIndex).toBe(0);
        expect(result[0].betType).toBe("Main");
        expect(result[1].matchIndex).toBe(0);
        expect(result[1].betType).toBe("Tỷ số chính xác");
      });

      test("sanitizeRemainingSingles — keeps both when different matchIndex but same betType", () => {
        const input = [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            betType: "Main",
            pick: { market: "Tổng bàn châu Âu", selection: "Tài 2.5", odds: 1.85, reason: "OK" },
            stake: 800000,
            potentialWin: 1480000,
          },
          {
            // Different matchIndex, same betType — should NOT be deduplicated
            matchIndex: 1,
            matchLabel: "Brazil vs Argentina",
            betType: "Main",
            pick: { market: "Tổng bàn châu Âu", selection: "Xỉu 2.5", odds: 1.9, reason: "OK" },
            stake: 700000,
            potentialWin: 1330000,
          },
        ];
        const result = bettingGemini.sanitizeRemainingSinglesForTest(input, 3);
        // Both should remain (different matchIndex)
        expect(result).toHaveLength(2);
        expect(result[0].matchIndex).toBe(0);
        expect(result[0].betType).toBe("Main");
        expect(result[1].matchIndex).toBe(1);
        expect(result[1].betType).toBe("Main");
      });
    });

    describe("parlays — validation & coverage", () => {
      const validParlay = {
        type: "xiên 3",
        legs: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            pick: { market: "Tỷ số chính xác", selection: "1-0", odds: 6.5, reason: "ngắn" },
          },
          {
            matchIndex: 1,
            matchLabel: "Brazil vs Argentina",
            pick: { market: "Tài 2.5", selection: "Tài", odds: 1.85, reason: "OK" },
          },
          {
            matchIndex: 2,
            matchLabel: "France vs Germany",
            pick: { market: "1X2", selection: "1", odds: 2.0, reason: "yếu" },
          },
        ],
        combinedOdds: 24.205,
        stake: 1000000,
        potentialWin: 24205000,
      };

      test("sanitizeParlays — valid parlay with all required fields is kept", () => {
        const input = [validParlay];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
        expect(result[0].combinedOdds).toBe(24.205);
        expect(result[0].stake).toBe(1000000);
      });

      test("sanitizeParlays — parlay missing combinedOdds is dropped", () => {
        const input = [
          validParlay,
          {
            type: "xiên 3",
            legs: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", pick: { market: "1X2", selection: "1", odds: 2.0, reason: "OK" } }],
            // combinedOdds missing
            stake: 500000,
            potentialWin: 1000000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — parlay with combinedOdds <= 0 is dropped", () => {
        const input = [
          validParlay,
          {
            type: "xiên 2",
            legs: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", pick: { market: "1X2", selection: "1", odds: 2.0, reason: "OK" } }],
            combinedOdds: 0,
            stake: 500000,
            potentialWin: 1000000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — parlay missing stake is dropped", () => {
        const input = [
          validParlay,
          {
            type: "xiên 2",
            legs: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", pick: { market: "1X2", selection: "1", odds: 2.0, reason: "OK" } }],
            combinedOdds: 2.0,
            // stake missing
            potentialWin: 1000000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — parlay with invalid potentialWin is dropped", () => {
        const input = [
          validParlay,
          {
            type: "xiên 2",
            legs: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", pick: { market: "1X2", selection: "1", odds: 2.0, reason: "OK" } }],
            combinedOdds: 2.0,
            stake: 500000,
            potentialWin: "invalid",
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — parlay with leg matchIndex out of range is dropped", () => {
        const input = [
          validParlay,
          {
            type: "xiên 2",
            legs: [{ matchIndex: 99, matchLabel: "Unknown", pick: { market: "1X2", selection: "1", odds: 2.0, reason: "OK" } }],
            combinedOdds: 2.0,
            stake: 500000,
            potentialWin: 1000000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — parlay with leg missing pick.market is dropped", () => {
        const input = [
          validParlay,
          {
            type: "xiên 2",
            legs: [
              {
                matchIndex: 0,
                matchLabel: "Belgium vs Senegal",
                pick: { market: "", selection: "1", odds: 2.0, reason: "OK" },
              },
            ],
            combinedOdds: 2.0,
            stake: 500000,
            potentialWin: 1000000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — parlay with leg missing pick.selection is dropped", () => {
        const input = [
          validParlay,
          {
            type: "xiên 2",
            legs: [
              {
                matchIndex: 0,
                matchLabel: "Belgium vs Senegal",
                pick: { market: "1X2", selection: "", odds: 2.0, reason: "OK" },
              },
            ],
            combinedOdds: 2.0,
            stake: 500000,
            potentialWin: 1000000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — parlay with leg pick.odds <= 0 is dropped", () => {
        const input = [
          validParlay,
          {
            type: "xiên 2",
            legs: [
              {
                matchIndex: 0,
                matchLabel: "Belgium vs Senegal",
                pick: { market: "1X2", selection: "1", odds: 0, reason: "OK" },
              },
            ],
            combinedOdds: 2.0,
            stake: 500000,
            potentialWin: 1000000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — xiên 3 with only 2 legs is kept but logged", () => {
        const input = [
          {
            type: "xiên 3",
            legs: [
              {
                matchIndex: 0,
                matchLabel: "Belgium vs Senegal",
                pick: { market: "Tỷ số chính xác", selection: "1-0", odds: 6.5, reason: "ngắn" },
              },
              {
                matchIndex: 1,
                matchLabel: "Brazil vs Argentina",
                pick: { market: "Tài 2.5", selection: "Tài", odds: 1.85, reason: "OK" },
              },
            ],
            combinedOdds: 12.025,
            stake: 1000000,
            potentialWin: 12025000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].legs).toHaveLength(2);
      });

      test("sanitizeParlays — xiên 3 without correct score leg is kept but logged", () => {
        const input = [
          {
            type: "xiên 3",
            legs: [
              {
                matchIndex: 0,
                matchLabel: "Belgium vs Senegal",
                pick: { market: "Tài 2.5", selection: "Tài", odds: 1.85, reason: "OK" },
              },
              {
                matchIndex: 1,
                matchLabel: "Brazil vs Argentina",
                pick: { market: "Tài 2.5", selection: "Tài", odds: 1.9, reason: "OK" },
              },
              {
                matchIndex: 2,
                matchLabel: "France vs Germany",
                pick: { market: "1X2", selection: "1", odds: 2.0, reason: "yếu" },
              },
            ],
            combinedOdds: 7.039,
            stake: 1000000,
            potentialWin: 7039000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — xiên 3 with 3 legs and correct score leg is kept without warning", () => {
        const input = [validParlay];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].legs).toHaveLength(3);
        // Should have correct score leg in first position
        expect(result[0].legs[0].pick.market).toBe("Tỷ số chính xác");
      });

      test("sanitizeParlays — input not array returns []", () => {
        expect(bettingGemini.sanitizeParlaysForTest(null, 3)).toEqual([]);
        expect(bettingGemini.sanitizeParlaysForTest(undefined, 3)).toEqual([]);
        expect(bettingGemini.sanitizeParlaysForTest({}, 3)).toEqual([]);
      });

      test("sanitizeParlays — empty parlays array returns []", () => {
        const input: unknown[] = [];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toEqual([]);
      });

      test("sanitizeParlays — parlay with empty legs array is dropped", () => {
        const input = [
          validParlay,
          {
            type: "xiên 2",
            legs: [],
            combinedOdds: 2.0,
            stake: 500000,
            potentialWin: 1000000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });

      test("sanitizeParlays — parlay missing type is dropped", () => {
        const input = [
          validParlay,
          {
            // type missing
            legs: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", pick: { market: "1X2", selection: "1", odds: 2.0, reason: "OK" } }],
            combinedOdds: 2.0,
            stake: 500000,
            potentialWin: 1000000,
          },
        ];
        const result = bettingGemini.sanitizeParlaysForTest(input, 3);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("xiên 3");
      });
    });