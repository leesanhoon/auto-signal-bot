import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { resetRateLimitStateForTests } from "../../src/shared/rate-limit.js";

const geminiState = vi.hoisted(() => ({
  generateContent: vi.fn(),
  retry: vi.fn(async (request: () => Promise<unknown>) => request()),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: geminiState.generateContent };
    constructor(_options: unknown) {}
  },
}));

vi.mock("../../src/shared/retry.js", () => ({
  withRetry: geminiState.retry,
}));

const bettingApi = await import("../../src/betting/betting-api.js");
const bettingGemini = await import("../../src/betting/betting-gemini.js");

describe("rate limiting", () => {
  beforeEach(() => {
    resetRateLimitStateForTests();
    geminiState.generateContent.mockReset();
    geminiState.retry.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            response: [{ league: { id: 1 } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        )),
    );
    process.env.API_FOOTBALL_KEY = "test";
    process.env.API_FOOTBALL_RATE_LIMIT_RPM = "1";
    process.env.GEMINI_API_KEY = "test";
    process.env.GEMINI_RATE_LIMIT_RPM = "1";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("delays API-Football requests after the configured RPM is reached", async () => {
    const first = bettingApi.fetchFixtures("2026-07-01");
    const second = bettingApi.fetchFixtures("2026-07-01");

    await first;
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    const secondResult = await second;

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(await first).toEqual({ response: [{ league: { id: 1 } }] });
    expect(secondResult).toEqual({ response: [{ league: { id: 1 } }] });
  });

  test("delays Gemini requests after the configured RPM is reached", async () => {
    geminiState.generateContent.mockResolvedValue({
      text: JSON.stringify({
        match: "Arsenal vs Chelsea",
        preferredScoreline: "1-0",
        scoreConfidence: 80,
        recommendation: "Canh nhua",
        confidence: 81,
        keyPoints: ["A"],
        risks: ["B"],
        summary: "C",
      }),
    });

    const payload = {
      gameId: "match-1",
      home: "Arsenal",
      away: "Chelsea",
      kickoffUnix: 1760000000,
      odds: {
        updatedUnix: 1760000000,
        legend: "demo",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "H", price: 1.9 },
              { name: "D", price: 3.2 },
              { name: "A", price: 4.1 },
            ],
          },
        ],
      },
    } as never;

    const first = bettingGemini.analyzeMatchOdds(payload);
    const second = bettingGemini.analyzeMatchOdds(payload);

    await first;
    expect(geminiState.generateContent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    const secondResult = await second;

    expect(geminiState.generateContent).toHaveBeenCalledTimes(2);
    expect(await first).toMatchObject({ match: "Arsenal vs Chelsea" });
    expect(secondResult.match).toBe("Arsenal vs Chelsea");
  });
});
