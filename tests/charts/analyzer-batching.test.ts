import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  call: vi.fn(),
  retry: vi.fn(async (request: () => Promise<unknown>) => request()),
}));
vi.mock("../../src/shared/openrouter.js", () => ({ callOpenRouter: state.call }));
vi.mock("../../src/shared/retry.js", () => ({ withRetry: state.retry }));
const analyzer = await import("../../src/charts/analyzer.js");

describe("charts/analyzer batching", () => {
  beforeEach(() => {
    state.call.mockReset();
    state.retry.mockClear();
  });

  test("continues when one pair fails and merges successful pairs", async () => {
    state.call
      .mockResolvedValueOnce({
        text: '{"summaries":[{"pair":"EUR/USD","trend":"Up","status":"TRADE","confidence":88}],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"Pullback","reasons":["EMA"],"risks":["False breakout"],"confidence":78,"entry":"1.1","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"Valid"}],"noSetupReason":"EUR clean"}',
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockRejectedValueOnce(new Error("503 UNAVAILABLE"));

    const make = (symbol: string, pair: string, timeframe: string) => ({
      chart: { symbol, name: `${pair} ${timeframe}`, timeframe },
      buffer: Buffer.from(`${symbol}-${timeframe}`),
      filepath: `/tmp/${symbol}-${timeframe}.jpg`,
    });
    const screenshots = [
      make("EURUSD", "EUR/USD", "D1"), make("EURUSD", "EUR/USD", "H4"), make("EURUSD", "EUR/USD", "M15"),
      make("GBPUSD", "GBP/USD", "D1"), make("GBPUSD", "GBP/USD", "H4"), make("GBPUSD", "GBP/USD", "M15"),
    ];
    const result = await analyzer.analyzeAllCharts(screenshots);
    expect(result.summaries[0].pair).toBe("EUR/USD");
    expect(result.setups[0].pair).toBe("EUR/USD");
    expect(result.noSetupReason).toContain("[EUR/USD] EUR clean");
    expect(state.call).toHaveBeenCalledTimes(2);
  });
});
