import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetRateLimitStateForTests } from "../../src/shared/rate-limit.js";

const state = vi.hoisted(() => ({ retry: vi.fn(async (request: () => Promise<unknown>) => request()) }));
vi.mock("../../src/shared/retry.js", () => ({ withRetry: state.retry }));
const bettingApi = await import("../../src/betting/betting-api.js");
const bettingAi = await import("../../src/betting/betting-gemini.js");

describe("rate limiting", () => {
  beforeEach(() => {
    resetRateLimitStateForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    process.env.API_FOOTBALL_KEY = "test";
    process.env.API_FOOTBALL_RATE_LIMIT_RPM = "1";
    process.env.OPENROUTER_API_KEY = "test";
    process.env.OPENROUTER_RATE_LIMIT_RPM = "1";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("delays API-Football requests after configured RPM", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ response: [] }), { status: 200 })));
    const first = bettingApi.fetchFixtures("2026-07-01");
    const second = bettingApi.fetchFixtures("2026-07-01");
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await second;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("delays OpenRouter requests after configured RPM", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        match: "Arsenal vs Chelsea", preferredScoreline: "1-0", scoreConfidence: 80,
        recommendation: "Canh keo", confidence: 81, keyPoints: ["A"], risks: ["B"], summary: "C",
      }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const payload = {
      gameId: "match-1", home: "Arsenal", away: "Chelsea", kickoffUnix: 1760000000,
      odds: { updatedUnix: 1760000000, legend: "demo", markets: [] },
    } as never;
    const first = bettingAi.analyzeMatchOdds(payload);
    const second = bettingAi.analyzeMatchOdds(payload);
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await second;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
