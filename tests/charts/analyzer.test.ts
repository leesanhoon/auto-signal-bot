import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ScreenshotResult } from "../../src/charts/chart-types.js";

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
const analyzer = await import("../../src/charts/analyzer.js");

describe("charts/analyzer", () => {
  beforeEach(() => {
    state.call.mockReset();
    state.retry.mockClear();
    state.callWithFallback.mockClear();
  });

  test("parseAnalysisResponse keeps low-confidence setups from AI", () => {
    const parsed = analyzer.parseAnalysisResponse(
      '{"summaries":[{"pair":"EUR/USD","trend":"Up","status":"Trade","confidence":81}],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"Breakout","reasons":["A"],"risks":["B"],"confidence":72,"entry":"1.10","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"ok"},{"pair":"GBP/USD","direction":"SHORT","setup":"Reversal","reasons":["C"],"risks":["D"],"confidence":30,"entry":"1.25","stopLoss":"1.26","takeProfit1":"1.23","takeProfit2":"1.22","riskReward":"1:2","summary":"skip"}],"noSetupReason":"none"}',
    );
    expect(parsed.summaries).toHaveLength(1);
    expect(parsed.setups).toHaveLength(2);
    expect(parsed.setups[1].pair).toBe("GBP/USD");
  });

  test("parseAnalysisResponse defaults order type for legacy setups", () => {
    const parsed = analyzer.parseAnalysisResponse(
      '{"summaries":[],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"BB","reasons":[],"risks":[],"confidence":80,"entry":"1.1000","stopLoss":"1.0950","takeProfit1":"1.1100","takeProfit2":"1.1200","riskReward":"1:2","summary":"Test"}],"noSetupReason":""}',
    );

    expect(parsed.setups[0].orderType).toBe("BUY_STOP");
    expect(parsed.setups[0].entryCondition).toBe("Chờ giá xác nhận đúng vùng entry trước khi vào lệnh.");
    expect(parsed.setups[0].currentPriceContext).toBe("Model chưa mô tả rõ vị trí giá hiện tại so với entry.");
    expect(parsed.setups[0].primaryTimeframe).toBe("H4");
  });

  test("parseAnalysisResponse preserves a valid primary timeframe", () => {
    const parsed = analyzer.parseAnalysisResponse(
      '{"summaries":[],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"BB","primaryTimeframe":"M15","reasons":[],"risks":[],"confidence":80,"entry":"1.1000","stopLoss":"1.0950","takeProfit1":"1.1100","takeProfit2":"1.1200","riskReward":"1:2","summary":"Test"}],"noSetupReason":""}',
    );

    expect(parsed.setups[0].primaryTimeframe).toBe("M15");
  });

  test("parseAnalysisResponse normalizes Vietnamese direction labels", () => {
    const parsed = analyzer.parseAnalysisResponse(
      '{"summaries":[],"setups":[{"pair":"EUR/USD","direction":"Bán","setup":"BB","reasons":[],"risks":[],"confidence":80,"entry":"1.1000","stopLoss":"1.0950","takeProfit1":"1.1100","takeProfit2":"1.1200","riskReward":"1:2","summary":"Test"}],"noSetupReason":""}',
    );

    expect(parsed.setups[0].direction).toBe("SHORT");
  });

  test("parseAnalysisResponse falls back for blank explanatory fields", () => {
    const parsed = analyzer.parseAnalysisResponse(
      '{"summaries":[],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"BB","reasons":[],"risks":[],"confidence":80,"entry":"1.1000","stopLoss":"1.0950","takeProfit1":"1.1100","takeProfit2":"1.1200","riskReward":"1:2","summary":"Test","entryCondition":"   ","currentPriceContext":""}],"noSetupReason":"   "}',
    );

    expect(parsed.setups[0].entryCondition).toBe("Chờ giá xác nhận đúng vùng entry trước khi vào lệnh.");
    expect(parsed.setups[0].currentPriceContext).toBe("Model chưa mô tả rõ vị trí giá hiện tại so với entry.");
    expect(parsed.noSetupReason).toBe("");
  });

  test("parseAnalysisResponse drops market-now setups that are far from last price", () => {
    const parsed = analyzer.parseAnalysisResponse(
      '{"summaries":[],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"RB","orderType":"MARKET_NOW","reasons":[],"risks":[],"confidence":80,"entry":"1.2000","stopLoss":"1.1900","takeProfit1":"1.2100","takeProfit2":"1.2200","riskReward":"1:2","summary":"Test"}],"noSetupReason":""}',
      { lastPriceByPair: new Map([["EURUSD", 1.1005]]) },
    );

    expect(parsed.setups).toHaveLength(0);
    expect(parsed.noSetupReason).toContain("MARKET_NOW lệch quá xa");
  });

  test("parseAnalysisResponse drops setups whose price already violated stop loss", () => {
    const parsed = analyzer.parseAnalysisResponse(
      '{"summaries":[],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"RB","reasons":[],"risks":[],"confidence":80,"entry":"1.1000","stopLoss":"1.0900","takeProfit1":"1.1200","takeProfit2":"1.1300","riskReward":"1:2","summary":"Test"}],"noSetupReason":""}',
      { lastPriceByPair: new Map([["EURUSD", 1.085]]) },
    );

    expect(parsed.setups).toHaveLength(0);
    expect(parsed.noSetupReason).toContain("đã nằm dưới stop loss");
  });

  test("analyzeAllCharts sends data URLs and parses OpenRouter output", async () => {
    state.callWithFallback.mockResolvedValueOnce({
      response: {
        text: '{"summaries":[{"pair":"EUR/USD","trend":"Up","status":"TRADE","confidence":88}],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"Pullback","reasons":["EMA"],"risks":["Noise"],"confidence":78,"entry":"1.1","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"Valid"}],"noSetupReason":""}',
        usage: { promptTokens: 10, completionTokens: 20 },
      },
      model: "primary-model",
    });
    const screenshots: ScreenshotResult[] = [
      {
        chart: { symbol: "EURUSD", name: "EUR/USD D1", timeframe: "D1", interval: "D", description: "" },
        buffer: Buffer.from("d1"),
        filepath: "/tmp/chart-d1.jpg",
        lastPrice: 1.101,
      },
      {
        chart: { symbol: "EURUSD", name: "EUR/USD H4", timeframe: "H4", interval: "240", description: "" },
        buffer: Buffer.from("h4"),
        filepath: "/tmp/chart-h4.jpg",
        lastPrice: 1.102,
      },
      {
        chart: { symbol: "EURUSD", name: "EUR/USD M15", timeframe: "M15", interval: "15", description: "" },
        buffer: Buffer.from("m15"),
        filepath: "/tmp/chart-m15.jpg",
        lastPrice: 1.103,
      },
    ];
    const result = await analyzer.analyzeAllCharts(screenshots);
    expect(result.setups[0].pair).toBe("EUR/USD");
    expect(result.setups[0].sourceCharts).toEqual([
      { symbol: "EURUSD", name: "EUR/USD D1", timeframe: "D1", filepath: "/tmp/chart-d1.jpg" },
      { symbol: "EURUSD", name: "EUR/USD H4", timeframe: "H4", filepath: "/tmp/chart-h4.jpg" },
      { symbol: "EURUSD", name: "EUR/USD M15", timeframe: "M15", filepath: "/tmp/chart-m15.jpg" },
    ]);
    expect(result.screenshots).toBe(screenshots);
    expect(state.callWithFallback).toHaveBeenCalled();
    // The requestBuilder is a function that should create requests with image data
    const requestBuilder = state.callWithFallback.mock.calls[0][2];
    const testRequest = requestBuilder("test-model");
    expect(testRequest.userContent[0]).toEqual(
      expect.objectContaining({ type: "image_url" })
    );
  });

  test("analyzeAllCharts keeps normalized setup pairs when screenshots use slash-form pair names", async () => {
    state.callWithFallback.mockResolvedValueOnce({
      response: {
        text: '{"summaries":[{"pair":"EURUSD","trend":"Up","status":"TRADE","confidence":88}],"setups":[{"pair":"EURUSD","direction":"LONG","setup":"Pullback","reasons":["EMA"],"risks":["Noise"],"confidence":78,"entry":"1.1","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"Valid"}],"noSetupReason":""}',
        usage: { promptTokens: 10, completionTokens: 20 },
      },
      model: "primary-model",
    });
    const screenshots: ScreenshotResult[] = [
      {
        chart: { symbol: "EUR/USD", name: "EUR/USD D1", timeframe: "D1", interval: "D", description: "" },
        buffer: Buffer.from("d1"),
        filepath: "/tmp/chart-d1.jpg",
        lastPrice: 1.101,
      },
      {
        chart: { symbol: "EUR/USD", name: "EUR/USD H4", timeframe: "H4", interval: "240", description: "" },
        buffer: Buffer.from("h4"),
        filepath: "/tmp/chart-h4.jpg",
        lastPrice: 1.102,
      },
      {
        chart: { symbol: "EUR/USD", name: "EUR/USD M15", timeframe: "M15", interval: "15", description: "" },
        buffer: Buffer.from("m15"),
        filepath: "/tmp/chart-m15.jpg",
        lastPrice: 1.103,
      },
    ];

    const result = await analyzer.analyzeAllCharts(screenshots);

    expect(result.setups).toHaveLength(1);
    expect(result.setups[0].pair).toBe("EURUSD");
    expect(result.setups[0].sourceCharts).toHaveLength(3);
  });

  test("analyzeAllCharts sends a Volman-focused prompt with EMA20 and volume rules", async () => {
    state.callWithFallback.mockResolvedValueOnce({
      response: {
        text: '{"summaries":[{"pair":"EUR/USD","trend":"Up","status":"TRADE","confidence":88}],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"RB","reasons":["EMA20 flat to up"],"risks":["False break"],"confidence":78,"entry":"1.1","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"Valid"}],"noSetupReason":"none"}',
        usage: { promptTokens: 10, completionTokens: 20 },
      },
      model: "primary-model",
    });

    const screenshots: ScreenshotResult[] = [
      {
        chart: { symbol: "EURUSD", name: "EUR/USD D1", timeframe: "D1", interval: "D", description: "" },
        buffer: Buffer.from("d1"),
        filepath: "/tmp/chart-d1.jpg",
        lastPrice: 1.101,
      },
      {
        chart: { symbol: "EURUSD", name: "EUR/USD H4", timeframe: "H4", interval: "240", description: "" },
        buffer: Buffer.from("h4"),
        filepath: "/tmp/chart-h4.jpg",
        lastPrice: 1.102,
      },
      {
        chart: { symbol: "EURUSD", name: "EUR/USD M15", timeframe: "M15", interval: "15", description: "" },
        buffer: Buffer.from("m15"),
        filepath: "/tmp/chart-m15.jpg",
        lastPrice: 1.103,
      },
    ];

    await analyzer.analyzeAllCharts(screenshots);

    // The requestBuilder is the 3rd argument to callOpenRouterWithFallback
    const requestBuilder = state.callWithFallback.mock.calls[0][2];
    const request = requestBuilder("test-model");
    expect(request.systemPrompt).toContain("Bob Volman");
    expect(request.systemPrompt).toContain("EMA20");
    expect(request.systemPrompt).toContain("volume");
    expect(request.systemPrompt).toContain("RB");
    expect(request.userContent.map((part: { type: string; text?: string }) => part.text ?? "").join(" ")).toContain("noSetupReason");
    expect(request.userContent.map((part: { type: string; text?: string }) => part.text ?? "").join(" ")).toContain("EMA20 slope");
    expect(request.userContent.map((part: { type: string; text?: string }) => part.text ?? "").join(" ")).toContain("RB, ARB, IRB, BB, FB, SB, DD");
    expect(request.userContent.map((part: { type: string; text?: string }) => part.text ?? "").join(" ")).toContain("LAST_PRICE=1.101");
  });
});
