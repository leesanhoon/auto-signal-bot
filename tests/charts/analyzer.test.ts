import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  call: vi.fn(),
  retry: vi.fn(async (request: () => Promise<unknown>) => request()),
}));
vi.mock("../../src/shared/openrouter.js", () => ({ callOpenRouter: state.call }));
vi.mock("../../src/shared/retry.js", () => ({ withRetry: state.retry }));
const analyzer = await import("../../src/charts/analyzer.js");

describe("charts/analyzer", () => {
  beforeEach(() => {
    state.call.mockReset();
    state.retry.mockClear();
  });

  test("parseAnalysisResponse filters low-confidence setups", () => {
    const parsed = analyzer.parseAnalysisResponse(
      '{"summaries":[{"pair":"EUR/USD","trend":"Up","status":"Trade","confidence":81}],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"Breakout","reasons":["A"],"risks":["B"],"confidence":72,"entry":"1.10","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"ok"},{"pair":"GBP/USD","direction":"SHORT","setup":"Reversal","reasons":["C"],"risks":["D"],"confidence":69,"entry":"1.25","stopLoss":"1.26","takeProfit1":"1.23","takeProfit2":"1.22","riskReward":"1:2","summary":"skip"}],"noSetupReason":"none"}',
    );
    expect(parsed.summaries).toHaveLength(1);
    expect(parsed.setups).toHaveLength(1);
    expect(parsed.setups[0].pair).toBe("EUR/USD");
  });

  test("analyzeAllCharts sends data URLs and parses OpenRouter output", async () => {
    state.call.mockResolvedValueOnce({
      text: '{"summaries":[{"pair":"EUR/USD","trend":"Up","status":"TRADE","confidence":88}],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"Pullback","reasons":["EMA"],"risks":["Noise"],"confidence":78,"entry":"1.1","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"Valid"}],"noSetupReason":""}',
      usage: { promptTokens: 10, completionTokens: 20 },
    });
    const screenshots = [{ chart: { symbol: "EURUSD", name: "EUR/USD" }, buffer: Buffer.from("image"), filepath: "/tmp/chart.jpg" }];
    const result = await analyzer.analyzeAllCharts(screenshots);
    expect(result.setups[0].pair).toBe("EUR/USD");
    expect(result.screenshots).toBe(screenshots);
    expect(state.call.mock.calls[0][0].userContent[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  test("confirmHighConfidenceSetups attaches OpenRouter verification", async () => {
    state.call.mockResolvedValueOnce({
      text: '{"confirmed":true,"confidence":91,"comment":"aligned"}',
      usage: { promptTokens: 0, completionTokens: 0 },
    });
    const setup = {
      pair: "EUR/USD", direction: "LONG" as const, setup: "Pullback", reasons: ["EMA"],
      risks: ["Noise"], confidence: 85, entry: "1.1", stopLoss: "1.09",
      takeProfit1: "1.12", takeProfit2: "1.13", riskReward: "1:2", summary: "Valid",
    };
    const screenshots = [{
      chart: { symbol: "OANDA:EURUSD", name: "EUR/USD H4", timeframe: "H4" as const },
      buffer: Buffer.from("image"),
      filepath: "/tmp/chart.jpg",
    }];

    const [verified] = await analyzer.confirmHighConfidenceSetups([setup], screenshots);

    expect(verified).toMatchObject({
      verifiedConfirmed: true,
      verifiedConfidence: 91,
      verifiedBy: "moonshotai/kimi-k2.6",
    });
    expect(state.call.mock.calls[0][0].userContent[0]).toMatchObject({
      type: "image_url",
      image_url: { url: expect.stringMatching(/^data:image\/jpeg;base64,/) },
    });
    expect(state.call.mock.calls[0][0].userContent[1]).toMatchObject({ type: "text" });
  });
});
