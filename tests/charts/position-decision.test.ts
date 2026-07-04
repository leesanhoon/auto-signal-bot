import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  call: vi.fn(),
  retry: vi.fn(async (request: () => Promise<unknown>) => request()),
  callWithFallback: vi.fn(),
}));
vi.mock("../../src/shared/openrouter.js", () => ({ callOpenRouter: state.call }));
vi.mock("../../src/shared/retry.js", () => ({ withRetry: state.retry }));
vi.mock("../../src/shared/ai-model-fallback.js", () => ({
  callOpenRouterWithFallback: state.callWithFallback,
  parseModelFallbacks: vi.fn((val) => (val ? val.split(",").map((m: string) => m.trim()).filter(Boolean) : [])),
}));
const positionDecision = await import("../../src/charts/position-decision.js");

describe("charts/position-decision", () => {
  beforeEach(() => {
    state.call.mockReset();
    state.callWithFallback.mockClear();
  });

  test("parseDecisionResponse normalizes malformed decisions to HOLD", () => {
    expect(positionDecision.parseDecisionResponse('{"decision":"WAIT","confidence":"abc","comment":"unclear"}')).toMatchObject({
      decision: "HOLD", confidence: 0, comment: "unclear",
    });
  });

  test("decidePosition uses the single OpenRouter path", async () => {
    state.callWithFallback.mockResolvedValueOnce({
      response: {
        text: '{"decision":"CLOSE","confidence":87,"comment":"Trend failed"}',
        usage: { promptTokens: 10, completionTokens: 5 },
      },
      model: "primary-model",
    });
    const result = await positionDecision.decidePosition({
      id: 1, pair: "EUR/USD", direction: "LONG", setup: "Breakout", entry: "1.1000",
      stopLoss: "1.0960", takeProfit1: "1.1080", takeProfit2: "1.1120", reasons: ["Trend broke"],
      openedAt: "2026-07-01T00:00:00.000Z", status: "open", lastDecision: null,
      lastDecisionConfidence: null, lastDecisionComment: null, lastCheckedAt: null, closedAt: null,
    }, { chart: { symbol: "EURUSD", name: "EUR/USD" }, buffer: Buffer.from("chart"), filepath: "/tmp/chart.jpg", lastPrice: 1.105 });
    expect(result).toMatchObject({ decision: "CLOSE", confidence: 87, comment: "Trend failed" });
    expect(state.callWithFallback).toHaveBeenCalledTimes(1);

    // Check the requestBuilder creates the right request
    const requestBuilder = state.callWithFallback.mock.calls[0][2];
    const request = requestBuilder("test-model");
    expect(request.systemPrompt).toContain("All user-facing text must be Vietnamese with accents.");
    expect(request.userContent[1].text).toContain("- Pair: EUR/USD");
    expect(request.userContent[1].text).not.toContain("|-");
  });
});
