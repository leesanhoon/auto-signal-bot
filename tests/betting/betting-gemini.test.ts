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

describe("combined analysis — flexible picks", () => {
  test("a. Picks array có thể chứa các market khác nhau (không giới hạn tài/xỉu)", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            picks: [
              {
                market: "eu_totals",
                selection: "Over 2.5",
                odds: 1.85,
                confidence: 75,
                reason: "Strong attacking play",
              },
            ],
            predictedScore: { score: "2-1", confidence: 65 },
          },
        ],
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

    expect(result?.matches[0].picks).not.toBeNull();
    expect(result?.matches[0].picks[0].market).toBe("eu_totals");
    expect(result?.matches[0].picks[0].selection).toBe("Over 2.5");
  });

  test("b. Picks array có thể chứa multiple picks đã xếp hạng theo confidence", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            picks: [
              {
                market: "eu_totals",
                selection: "Over 2.5",
                odds: 1.85,
                confidence: 75,
                reason: "Goals estimate",
              },
            ],
            predictedScore: { score: "2-0", confidence: 70 },
          },
        ],
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

    expect(result?.matches[0].picks[0].market).toBe("eu_totals");
    expect(result?.matches[0].picks[0].selection).toBe("Over 2.5");
  });

  test("c. picks có thể là từ các market khác nhau (eu_totals, asia_totals, result_total_goals, v.v.)", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            picks: [
              {
                market: "result_total_goals",
                selection: "H-O2.5",
                odds: 2.05,
                confidence: 80,
                reason: "Strong home advantage with goals",
              },
            ],
            predictedScore: { score: "2-0", confidence: 75 },
          },
        ],
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

    expect(result?.matches[0].picks[0].market).toBe("result_total_goals");
    expect(result?.matches[0].picks[0].selection).toBe("H-O2.5");
  });

  test("d. totalGoalsPick có thể null nếu không rõ edge", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            totalGoalsPick: null,
            predictedScore: { score: "1-1", confidence: 45 },
            note: "Balanced teams, uncertain",
          },
        ],
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

    expect(result?.matches[0].totalGoalsPick).toBeNull();
    expect(result?.matches[0].note).toBe("Balanced teams, uncertain");
  });

  test("e. Picks array có thể chứa market bất kỳ (không giới hạn như system cũ)", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            picks: [
              {
                market: "h2h",
                selection: "Belgium",
                odds: 2.1,
                confidence: 80,
                reason: "Strong team",
              },
            ],
            predictedScore: { score: "2-0", confidence: 72 },
          },
        ],
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

    expect(result?.matches[0].picks[0].market).toBe("h2h");
    expect(result?.matches[0].picks[0].selection).toBe("Belgium");
  });
});

describe("generateCombinedAnalysis — match coverage validation", () => {
  test("Test 1: Detects missing matches and returns null (no fallback for parse failures)", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    // Primary response: only 1 match (missing matchIndex 1) — will fail validation
    callOpenRouter
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Tong quan",
          matches: [
            {
              matchIndex: 0,
              matchLabel: "Belgium vs Senegal",
              kickoff: "12:00",
              totalGoalsPick: {
                market: "Tổng bàn châu Âu",
                selection: "Tài 2.5",
                odds: 1.85,
                reason: "Strong attack",
              },
              predictedScore: { score: "2-1", confidence: 70 },
            },
          ],
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
      {
        gameId: "2",
        home: "Spain",
        away: "Austria",
        kickoffUnix: 3600,
        odds: { updatedUnix: 0, legend: "", markets: [] },
      },
    ]);

    // Verify callOpenRouter was called only once (parse failure doesn't trigger fallback)
    expect(callOpenRouter).toHaveBeenCalledTimes(1);

    // Since parse failed (missing matchIndex 1), result should be null
    expect(result).toBeNull();
  });

  test("Test 2: Single match response with complete data is accepted", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    // Response with 1 valid match (for 1 payload)
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            totalGoalsPick: {
              market: "Tổng bàn châu Âu",
              selection: "Tài 2.5",
              odds: 1.85,
              reason: "Strong attack",
            },
            predictedScore: { score: "2-1", confidence: 70 },
          },
        ],
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

    // Verify callOpenRouter was called once
    expect(callOpenRouter).toHaveBeenCalledTimes(1);

    // Verify result has the match data
    expect(result).not.toBeNull();
    expect(result?.matches).toHaveLength(1);
    expect(result?.matches[0].matchIndex).toBe(0);
    expect(result?.summary).toBe("Tong quan");
  });

  test("Test 3: Full coverage from primary returns all matches correctly", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            picks: [
              {
                market: "eu_totals",
                selection: "Over 2.5",
                odds: 1.85,
                confidence: 75,
                reason: "Strong attack",
              },
            ],
            predictedScore: { score: "2-1", confidence: 70 },
          },
          {
            matchIndex: 1,
            matchLabel: "Spain vs Austria",
            kickoff: "14:00",
            picks: [
              {
                market: "eu_totals",
                selection: "Under 2.5",
                odds: 1.90,
                confidence: 65,
                reason: "Defensive match",
              },
            ],
            predictedScore: { score: "1-0", confidence: 65 },
          },
        ],
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

    // Verify callOpenRouter was called only once
    expect(callOpenRouter).toHaveBeenCalledTimes(1);

    // Verify result has full coverage with correct data
    expect(result?.matches).toHaveLength(2);
    expect(result?.matches[0].picks[0].selection).toBe("Over 2.5");
    expect(result?.matches[1].picks[0].selection).toBe("Under 2.5");
    expect(result?.matches[0].predictedScore.confidence).toBe(70);
    expect(result?.matches[1].predictedScore.confidence).toBe(65);
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

  test("buildCombinedSystemPrompt() must contain key requirements for simplified betting", () => {
    const prompt = bettingGemini.buildCombinedSystemPrompt();
    expect(prompt).toContain("market");
    expect(prompt).toContain("picks");
    expect(prompt).toContain("tỉ số chính xác");
    expect(prompt).toContain("predictedScore");
    // Should NOT contain parlay/xiên guidance since it's simplified
    expect(prompt).not.toContain("xiên 3");
  });

  test("buildCombinedUserPrompt(payloads) includes match labels and JSON schema", () => {
    const prompt = bettingGemini.buildCombinedUserPrompt(testPayloads as any);
    // Should include match labels
    expect(prompt).toContain("Portugal vs Croatia");
    expect(prompt).toContain("Spain vs Italy");
    // Should contain the new picks array schema
    expect(prompt).toContain("picks");
    expect(prompt).toContain("predictedScore");
    expect(prompt).toContain("confidence");
    // Should include example values from the schema
    expect(prompt).toContain("H+0.5");
    expect(prompt).toContain("2-1");
  });

  test("System prompt must not mention parlay/xiên since system is simplified to picks only", () => {
    const prompt = bettingGemini.buildCombinedSystemPrompt();
    expect(prompt).not.toContain("xiên 3");
    expect(prompt).not.toContain("kèo xiên");
    expect(prompt).toContain("picks");
    expect(prompt).toContain("predictedScore");
    expect(prompt).toContain("confidence");
  });
});


describe("parseCombinedAnalysisResponse — match parsing & normalization", () => {
  test("Test 1: Both matches have complete data with predictedScore", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            totalGoalsPick: { market: "Tổng bàn châu Âu", selection: "Tài 2.5", odds: 1.85, reason: "Strong attack" },
            predictedScore: { score: "2-1", confidence: 80 },
          },
          {
            matchIndex: 1,
            matchLabel: "Brazil vs Argentina",
            kickoff: "18:00",
            totalGoalsPick: { market: "Tổng bàn châu Âu", selection: "Xỉu 2.5", odds: 1.9, reason: "Balanced defense" },
            predictedScore: { score: "1-0", confidence: 70 },
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

    expect(result?.matches[0].predictedScore.score).toBe("2-1");
    expect(result?.matches[0].predictedScore.confidence).toBe(80);
    expect(result?.matches[1].predictedScore.score).toBe("1-0");
    expect(result?.matches[1].predictedScore.confidence).toBe(70);
  });

  test("Test 2: AI provides null totalGoalsPick when no clear edge", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            totalGoalsPick: null,
            predictedScore: { score: "1-1", confidence: 45 },
            note: "Unclear edge",
          },
        ],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    });

    const result = await bettingGemini.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].totalGoalsPick).toBeNull();
    expect(result?.matches[0].predictedScore.confidence).toBe(45);
  });

  test("Test 3: Confidence values outside 0-100 are clamped", async () => {
    const callOpenRouter = vi.mocked(openrouter.callOpenRouter);
    callOpenRouter.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            totalGoalsPick: { market: "Tổng bàn châu Âu", selection: "Tài 2.5", odds: 1.85, reason: "Strong attack" },
            predictedScore: { score: "2-0", confidence: 150 },
          },
        ],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    });

    const result = await bettingGemini.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    // Should clamp 150 to 100
    expect(result?.matches[0].predictedScore.confidence).toBe(100);
  });

  test("Test 4: Unit test normalizeCombinedMatchForTest with picks array", () => {
    const fullMatch = {
      matchIndex: 0,
      matchLabel: "Belgium vs Senegal",
      kickoff: "12:00",
      picks: [
        { market: "eu_totals", selection: "Over 2.5", odds: 1.85, confidence: 75, reason: "Strong attack" },
        { market: "asia_handicap", selection: "H+0.75", odds: 1.9, confidence: 65, reason: "Home dominance" },
      ],
      predictedScore: { score: "2-1", confidence: 85 },
      note: "Defensive slip in second half expected",
    };
    const resultFull = bettingGemini.normalizeCombinedMatchForTest(fullMatch, "Trận 0");
    expect(resultFull.matchLabel).toBe("Belgium vs Senegal");
    expect(resultFull.kickoff).toBe("12:00");
    expect(resultFull.picks).toHaveLength(2);
    expect(resultFull.picks[0].market).toBe("eu_totals");
    expect(resultFull.picks[0].selection).toBe("Over 2.5");
    expect(resultFull.picks[0].confidence).toBe(75);
    expect(resultFull.predictedScore.score).toBe("2-1");
    expect(resultFull.predictedScore.confidence).toBe(85);
    expect(resultFull.note).toBe("Defensive slip in second half expected");

    const partialMatch = {
      matchIndex: 1,
      picks: [],
      predictedScore: { score: "1-0", confidence: 60 },
    };
    const resultPartial = bettingGemini.normalizeCombinedMatchForTest(partialMatch, "Trận 1");
    expect(resultPartial.matchLabel).toBe("Trận 1");
    expect(resultPartial.kickoff).toBe("");
    expect(resultPartial.picks).toHaveLength(0);
    expect(resultPartial.predictedScore.score).toBe("1-0");
    expect(resultPartial.predictedScore.confidence).toBe(60);
  });
});
