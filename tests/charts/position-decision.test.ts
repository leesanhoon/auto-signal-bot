import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  call: vi.fn(),
  retry: vi.fn(async (request: () => Promise<unknown>) => request()),
}));
vi.mock("../../src/shared/openrouter.js", () => ({ callOpenRouter: state.call }));
vi.mock("../../src/shared/retry.js", () => ({ withRetry: state.retry }));
const positionDecision = await import("../../src/charts/position-decision.js");

describe("charts/position-decision", () => {
  beforeEach(() => state.call.mockReset());

  test("parseDecisionResponse normalizes malformed decisions to HOLD", () => {
    expect(positionDecision.parseDecisionResponse('{"decision":"WAIT","confidence":"abc","comment":"unclear"}')).toMatchObject({
      decision: "HOLD", confidence: 0, comment: "unclear",
    });
  });

  test("decidePosition uses the single OpenRouter path", async () => {
    state.call.mockResolvedValueOnce({
      text: '{"decision":"CLOSE","confidence":87,"comment":"Trend failed"}',
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    const result = await positionDecision.decidePosition({
      id: 1, pair: "EUR/USD", direction: "LONG", setup: "Breakout", entry: "1.1000",
      stopLoss: "1.0960", takeProfit1: "1.1080", takeProfit2: "1.1120", reasons: ["Trend broke"],
      openedAt: "2026-07-01T00:00:00.000Z", status: "open", lastDecision: null,
      lastDecisionConfidence: null, lastDecisionComment: null, lastCheckedAt: null, closedAt: null,
    }, { chart: { symbol: "EURUSD", name: "EUR/USD" }, buffer: Buffer.from("chart"), filepath: "/tmp/chart.jpg", lastPrice: 1.105 });
    expect(result).toMatchObject({ decision: "CLOSE", confidence: 87, comment: "Trend failed" });
    expect(state.call).toHaveBeenCalledTimes(1);
    expect(state.call.mock.calls[0][0].systemPrompt).toContain("All user-facing text must be Vietnamese with accents.");
    expect(state.call.mock.calls[0][0].userContent[1].text).toContain("- Pair: EUR/USD");
    expect(state.call.mock.calls[0][0].userContent[1].text).not.toContain("|-");
  });
});
