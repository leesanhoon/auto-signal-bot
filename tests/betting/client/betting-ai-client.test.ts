import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../src/shared/openrouter.js", () => ({ callOpenRouter: vi.fn() }));
vi.mock("../../../src/shared/ai-usage.js", () => ({
  recordOpenRouterUsage: vi.fn(),
}));

const bettingAiClient = await import("../../../src/betting/client/betting-ai-client.js");
const openrouter = await import("../../../src/shared/openrouter.js");

beforeEach(() => {
  vi.mocked(openrouter.callOpenRouter).mockReset();
  delete process.env.AI_REASONING_EFFORT;
  delete process.env.BETTING_PICKS_MARKET_SCOPE;
});

afterEach(() => {
  delete process.env.BETTING_PICKS_MARKET_SCOPE;
});

describe("betting/client/betting-ai-client", () => {
  test("a. Picks array có thể chứa các market khác nhau (không giới hạn tài/xỉu)", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            picks: [{ market: "eu_totals", selection: "Over 2.5", odds: 1.85, confidence: 75, reason: "Strong attacking play" }],
            predictedScore: { score: "2-1", confidence: 65 },
          },
        ],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].picks[0].market).toBe("eu_totals");
    expect(result?.matches[0].picks[0].selection).toBe("Over 2.5");
  });

  test("b. Picks array có thể chứa multiple picks đã xếp hạng theo confidence", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            picks: [{ market: "eu_totals", selection: "Over 2.5", odds: 1.85, confidence: 75, reason: "Goals estimate" }],
            predictedScore: { score: "2-0", confidence: 70 },
          },
        ],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].picks[0].market).toBe("eu_totals");
    expect(result?.matches[0].picks[0].selection).toBe("Over 2.5");
  });

  test("c. picks có thể là từ các market khác nhau (eu_totals, asia_totals, result_total_goals, v.v.)", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          {
            matchIndex: 0,
            matchLabel: "Belgium vs Senegal",
            kickoff: "12:00",
            picks: [{ market: "result_total_goals", selection: "H-O2.5", odds: 2.05, confidence: 80, reason: "Strong home advantage with goals" }],
            predictedScore: { score: "2-0", confidence: 75 },
          },
        ],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].picks[0].market).toBe("result_total_goals");
    expect(result?.matches[0].picks[0].selection).toBe("H-O2.5");
  });

  test("d. totalGoalsPick có thể null nếu không rõ edge", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", kickoff: "12:00", totalGoalsPick: null, predictedScore: { score: "1-1", confidence: 45 }, note: "Balanced teams, uncertain" }],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].totalGoalsPick).toBeNull();
    expect(result?.matches[0].note).toBe("Balanced teams, uncertain");
  });

  test("e. Picks array có thể chứa market bất kỳ (không giới hạn như system cũ)", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", kickoff: "12:00", picks: [{ market: "h2h", selection: "Belgium", odds: 2.1, confidence: 80, reason: "Strong team" }], predictedScore: { score: "2-0", confidence: 72 } }],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].picks[0].market).toBe("h2h");
    expect(result?.matches[0].picks[0].selection).toBe("Belgium");
  });

  test("detects missing matches and returns null", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", kickoff: "12:00", predictedScore: { score: "2-1", confidence: 70 } }],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
      { gameId: "2", home: "Spain", away: "Austria", kickoffUnix: 3600, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(vi.mocked(openrouter.callOpenRouter)).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  test("single match response with complete data is accepted", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", kickoff: "12:00", predictedScore: { score: "2-1", confidence: 70 } }],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result).not.toBeNull();
    expect(result?.matches).toHaveLength(1);
    expect(result?.matches[0].matchIndex).toBe(0);
  });

  test("full coverage from primary returns all matches correctly", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          { matchIndex: 0, matchLabel: "Belgium vs Senegal", kickoff: "12:00", picks: [{ market: "eu_totals", selection: "Over 2.5", odds: 1.85, confidence: 75, reason: "Strong attack" }], predictedScore: { score: "2-1", confidence: 70 } },
          { matchIndex: 1, matchLabel: "Spain vs Austria", kickoff: "14:00", picks: [{ market: "eu_totals", selection: "Under 2.5", odds: 1.9, confidence: 65, reason: "Defensive match" }], predictedScore: { score: "1-0", confidence: 65 } },
        ],
      }),
      usage: { promptTokens: 12, completionTokens: 40 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
      { gameId: "2", home: "Spain", away: "Austria", kickoffUnix: 3600, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches).toHaveLength(2);
    expect(result?.matches[0].picks[0].selection).toBe("Over 2.5");
    expect(result?.matches[1].picks[0].selection).toBe("Under 2.5");
  });

  test("findMissingMatchIndexesForTest empty array returns all indexes", () => {
    expect(bettingAiClient.findMissingMatchIndexesForTest([], 3)).toEqual([0, 1, 2]);
  });

  test("findMissingMatchIndexesForTest detects missing middle index", () => {
    expect(
      bettingAiClient.findMissingMatchIndexesForTest(
        [
          { matchIndex: 0, matchLabel: "A vs B", kickoff: "", analysis: "", topPicks: [] },
          { matchIndex: 2, matchLabel: "C vs D", kickoff: "", analysis: "", topPicks: [] },
        ] as any,
        3,
      ),
    ).toEqual([1]);
  });

  test("findMissingMatchIndexesForTest detects missing last index", () => {
    expect(
      bettingAiClient.findMissingMatchIndexesForTest(
        [
          { matchIndex: 0, matchLabel: "A vs B", kickoff: "", analysis: "", topPicks: [] },
          { matchIndex: 1, matchLabel: "B vs C", kickoff: "", analysis: "", topPicks: [] },
        ] as any,
        3,
      ),
    ).toEqual([2]);
  });

  test("findMissingMatchIndexesForTest full coverage returns empty array", () => {
    expect(
      bettingAiClient.findMissingMatchIndexesForTest(
        [
          { matchIndex: 0, matchLabel: "A vs B", kickoff: "", analysis: "", topPicks: [] },
          { matchIndex: 1, matchLabel: "B vs C", kickoff: "", analysis: "", topPicks: [] },
          { matchIndex: 2, matchLabel: "C vs D", kickoff: "", analysis: "", topPicks: [] },
        ] as any,
        3,
      ),
    ).toEqual([]);
  });

  test("findMissingMatchIndexesForTest duplicate index is not counted as missing", () => {
    expect(
      bettingAiClient.findMissingMatchIndexesForTest(
        [
          { matchIndex: 0, matchLabel: "A vs B", kickoff: "", analysis: "", topPicks: [] },
          { matchIndex: 1, matchLabel: "B vs C", kickoff: "", analysis: "", topPicks: [] },
          { matchIndex: 1, matchLabel: "B vs C dup", kickoff: "", analysis: "", topPicks: [] },
        ] as any,
        3,
      ),
    ).toEqual([2]);
  });

  test("findMissingMatchIndexesForTest zero payloadCount returns empty array", () => {
    expect(bettingAiClient.findMissingMatchIndexesForTest([{ matchIndex: 0 }] as any, 0)).toEqual([]);
  });

  test("buildCombinedSystemPrompt must contain simplified betting requirements", () => {
    const prompt = bettingAiClient.buildCombinedSystemPrompt();
    expect(prompt).toContain("market");
    expect(prompt).toContain("picks");
    expect(prompt).toContain("predictedScore");
    expect(prompt).not.toContain("xiên 3");
  });

  test("buildCombinedUserPrompt includes match labels and JSON schema", () => {
    const prompt = bettingAiClient.buildCombinedUserPrompt([
      { gameId: "1", home: "Portugal", away: "Croatia", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
      { gameId: "2", home: "Spain", away: "Italy", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(prompt).toContain("Portugal vs Croatia");
    expect(prompt).toContain("Spain vs Italy");
    expect(prompt).toContain("picks");
    expect(prompt).toContain("predictedScore");
    expect(prompt).toContain("confidence");
  });

  test("system prompt must not mention parlay/xiên", () => {
    const prompt = bettingAiClient.buildCombinedSystemPrompt();
    expect(prompt).not.toContain("xiên 3");
    expect(prompt).not.toContain("kèo xiên");
  });

  test("parse result keeps predictedScore for both matches", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [
          { matchIndex: 0, matchLabel: "Belgium vs Senegal", kickoff: "12:00", predictedScore: { score: "2-1", confidence: 80 } },
          { matchIndex: 1, matchLabel: "Brazil vs Argentina", kickoff: "18:00", predictedScore: { score: "1-0", confidence: 70 } },
        ],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
      { gameId: "2", home: "Brazil", away: "Argentina", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].predictedScore.score).toBe("2-1");
    expect(result?.matches[1].predictedScore.score).toBe("1-0");
  });

  test("AI provides null totalGoalsPick when no clear edge", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", kickoff: "12:00", totalGoalsPick: null, predictedScore: { score: "1-1", confidence: 45 }, note: "Unclear edge" }],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].totalGoalsPick).toBeNull();
    expect(result?.matches[0].predictedScore.confidence).toBe(45);
  });

  test("confidence values outside 0-100 are clamped", async () => {
    vi.mocked(openrouter.callOpenRouter).mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Tong quan",
        matches: [{ matchIndex: 0, matchLabel: "Belgium vs Senegal", kickoff: "12:00", predictedScore: { score: "2-0", confidence: 150 } }],
      }),
      usage: { promptTokens: 12, completionTokens: 34 },
      finishReason: "stop",
    } as any);

    const result = await bettingAiClient.generateCombinedAnalysis([
      { gameId: "1", home: "Belgium", away: "Senegal", kickoffUnix: 0, odds: { updatedUnix: 0, legend: "", markets: [] } },
    ]);

    expect(result?.matches[0].predictedScore.confidence).toBe(100);
  });

  test("normalizeCombinedMatchForTest with picks array", () => {
    const resultFull = bettingAiClient.normalizeCombinedMatchForTest(
      {
        matchIndex: 0,
        matchLabel: "Belgium vs Senegal",
        kickoff: "12:00",
        picks: [
          { market: "eu_totals", selection: "Over 2.5", odds: 1.85, confidence: 75, reason: "Strong attack" },
          { market: "asia_handicap", selection: "H+0.75", odds: 1.9, confidence: 65, reason: "Home dominance" },
        ],
        predictedScore: { score: "2-1", confidence: 85 },
        note: "Defensive slip in second half expected",
      },
      "Trận 0",
    );

    expect(resultFull.picks).toHaveLength(2);
    expect(resultFull.predictedScore.score).toBe("2-1");

    const resultPartial = bettingAiClient.normalizeCombinedMatchForTest(
      { matchIndex: 1, picks: [], predictedScore: { score: "1-0", confidence: 60 } },
      "Trận 1",
    );
    expect(resultPartial.matchLabel).toBe("Trận 1");
    expect(resultPartial.kickoff).toBe("");
  });

  test("normalizeCombinedMatchForTest filters picks with odds <= 1.8", () => {
    const result = bettingAiClient.normalizeCombinedMatchForTest(
      {
        matchIndex: 0,
        matchLabel: "Test Match",
        kickoff: "15:00",
        picks: [
          { market: "eu_totals", selection: "Over 2.5", odds: 1.5, confidence: 70, reason: "Low odds pick" },
          { market: "asia_handicap", selection: "H+0.75", odds: 1.9, confidence: 75, reason: "Valid odds pick" },
        ],
        predictedScore: { score: "2-1", confidence: 80 },
      },
      "Trận 0",
    );

    expect(result.picks).toHaveLength(1);
    expect(result.picks[0].selection).toBe("H+0.75");
  });
});
