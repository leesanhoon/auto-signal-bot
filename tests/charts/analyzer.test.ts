import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ScreenshotResult } from "../../src/charts/chart-types.js";

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
  });

  test("parseAnalysisResponse falls back for blank explanatory fields", () => {
    const parsed = analyzer.parseAnalysisResponse(
      '{"summaries":[],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"BB","reasons":[],"risks":[],"confidence":80,"entry":"1.1000","stopLoss":"1.0950","takeProfit1":"1.1100","takeProfit2":"1.1200","riskReward":"1:2","summary":"Test","entryCondition":"   ","currentPriceContext":""}],"noSetupReason":"   "}',
    );

    expect(parsed.setups[0].entryCondition).toBe("Chờ giá xác nhận đúng vùng entry trước khi vào lệnh.");
    expect(parsed.setups[0].currentPriceContext).toBe("Model chưa mô tả rõ vị trí giá hiện tại so với entry.");
    expect(parsed.noSetupReason).toBe("");
  });

  test("analyzeAllCharts sends data URLs and parses OpenRouter output", async () => {
    state.call.mockResolvedValueOnce({
      text: '{"summaries":[{"pair":"EUR/USD","trend":"Up","status":"TRADE","confidence":88}],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"Pullback","reasons":["EMA"],"risks":["Noise"],"confidence":78,"entry":"1.1","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"Valid"}],"noSetupReason":""}',
      usage: { promptTokens: 10, completionTokens: 20 },
    });
    const screenshots: ScreenshotResult[] = [
      {
        chart: { symbol: "EURUSD", name: "EUR/USD D1", timeframe: "D1", interval: "D", description: "" },
        buffer: Buffer.from("d1"),
        filepath: "/tmp/chart-d1.jpg",
      },
      {
        chart: { symbol: "EURUSD", name: "EUR/USD H4", timeframe: "H4", interval: "240", description: "" },
        buffer: Buffer.from("h4"),
        filepath: "/tmp/chart-h4.jpg",
      },
      {
        chart: { symbol: "EURUSD", name: "EUR/USD M15", timeframe: "M15", interval: "15", description: "" },
        buffer: Buffer.from("m15"),
        filepath: "/tmp/chart-m15.jpg",
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
    expect(state.call.mock.calls[0][0].userContent[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  test("analyzeAllCharts keeps normalized setup pairs when screenshots use slash-form pair names", async () => {
    state.call.mockResolvedValueOnce({
      text: '{"summaries":[{"pair":"EURUSD","trend":"Up","status":"TRADE","confidence":88}],"setups":[{"pair":"EURUSD","direction":"LONG","setup":"Pullback","reasons":["EMA"],"risks":["Noise"],"confidence":78,"entry":"1.1","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"Valid"}],"noSetupReason":""}',
      usage: { promptTokens: 10, completionTokens: 20 },
    });
    const screenshots: ScreenshotResult[] = [
      {
        chart: { symbol: "EUR/USD", name: "EUR/USD D1", timeframe: "D1", interval: "D", description: "" },
        buffer: Buffer.from("d1"),
        filepath: "/tmp/chart-d1.jpg",
      },
      {
        chart: { symbol: "EUR/USD", name: "EUR/USD H4", timeframe: "H4", interval: "240", description: "" },
        buffer: Buffer.from("h4"),
        filepath: "/tmp/chart-h4.jpg",
      },
      {
        chart: { symbol: "EUR/USD", name: "EUR/USD M15", timeframe: "M15", interval: "15", description: "" },
        buffer: Buffer.from("m15"),
        filepath: "/tmp/chart-m15.jpg",
      },
    ];

    const result = await analyzer.analyzeAllCharts(screenshots);

    expect(result.setups).toHaveLength(1);
    expect(result.setups[0].pair).toBe("EURUSD");
    expect(result.setups[0].sourceCharts).toHaveLength(3);
  });

  test("analyzeAllCharts sends a Volman-focused prompt with EMA20 and volume rules", async () => {
    state.call.mockResolvedValueOnce({
      text: '{"summaries":[{"pair":"EUR/USD","trend":"Up","status":"TRADE","confidence":88}],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"RB","reasons":["EMA20 flat to up"],"risks":["False break"],"confidence":78,"entry":"1.1","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"Valid"}],"noSetupReason":"none"}',
      usage: { promptTokens: 10, completionTokens: 20 },
    });

    const screenshots: ScreenshotResult[] = [
      {
        chart: { symbol: "EURUSD", name: "EUR/USD D1", timeframe: "D1", interval: "D", description: "" },
        buffer: Buffer.from("d1"),
        filepath: "/tmp/chart-d1.jpg",
      },
      {
        chart: { symbol: "EURUSD", name: "EUR/USD H4", timeframe: "H4", interval: "240", description: "" },
        buffer: Buffer.from("h4"),
        filepath: "/tmp/chart-h4.jpg",
      },
      {
        chart: { symbol: "EURUSD", name: "EUR/USD M15", timeframe: "M15", interval: "15", description: "" },
        buffer: Buffer.from("m15"),
        filepath: "/tmp/chart-m15.jpg",
      },
    ];

    await analyzer.analyzeAllCharts(screenshots);

    const request = state.call.mock.calls[0][0];
    expect(request.systemPrompt).toContain("Bob Volman");
    expect(request.systemPrompt).toContain("EMA20");
    expect(request.systemPrompt).toContain("volume");
    expect(request.systemPrompt).toContain("RB");
    expect(request.userContent.map((part: { type: string; text?: string }) => part.text ?? "").join(" ")).toContain("noSetupReason");
    expect(request.userContent.map((part: { type: string; text?: string }) => part.text ?? "").join(" ")).toContain("EMA20 slope");
    expect(request.userContent.map((part: { type: string; text?: string }) => part.text ?? "").join(" ")).toContain("RB, ARB, IRB, BB, FB, SB, DD");
  });
});
