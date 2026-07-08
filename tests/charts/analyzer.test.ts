import { describe, expect, test } from "vitest";
import type { TradeSetup } from "../../src/charts/chart-types.js";
import {
  applyPriceSanityChecks,
  buildChartAnalysisCacheKey,
  buildPendingOrderCheckPrompt,
  clampConfidence,
  cleanResponse,
  extractJsonObject,
  formatPrice,
  parseAnalysisResponse,
  parsePendingOrderCheckResponse,
} from "../../src/charts/analyzer.js";

describe("charts/analyzer utilities", () => {
  test("buildChartAnalysisCacheKey preserves timeframe-specific cache keys", () => {
    expect(buildChartAnalysisCacheKey("2026-07-03T12", "deterministic", "multi")).toBe(
      "2026-07-03T12:deterministic:multi",
    );
    expect(buildChartAnalysisCacheKey("2026-07-03T12", "deterministic", "single", "M15")).toBe(
      "2026-07-03T12:deterministic:single:M15",
    );
  });

  test("cleanResponse and extractJsonObject strip code fences", () => {
    const wrapped = "```json\n{\"a\":1}\n```";
    expect(cleanResponse(wrapped)).toBe("{\"a\":1}");
    expect(extractJsonObject("prefix {\"a\":1} suffix")).toBe("{\"a\":1}");
  });

  test("clampConfidence bounds values", () => {
    expect(clampConfidence(101)).toBe(100);
    expect(clampConfidence(-5)).toBe(0);
    expect(clampConfidence("55")).toBe(55);
  });

  test("formatPrice adapts precision", () => {
    expect(formatPrice(1.234567)).toBe("1.23457");
    expect(formatPrice(12.34567)).toBe("12.346");
    expect(formatPrice(123.4567)).toBe("123.46");
  });

  test("parseAnalysisResponse normalizes setup shape and applies price checks", () => {
    const parsed = parseAnalysisResponse(
      '{"summaries":[{"pair":"EUR/USD","trend":"Up","status":"Trade","confidence":81}],"setups":[{"pair":"EUR/USD","direction":"Mua","setup":"RB","reasons":["A"],"risks":["B"],"confidence":72,"entry":"1.10","stopLoss":"1.09","takeProfit1":"1.12","takeProfit2":"1.13","riskReward":"1:2","summary":"ok"}],"noSetupReason":"none"}',
      { lastPriceByPair: new Map([["EURUSD", 1.105]]) },
    );

    expect(parsed.summaries).toHaveLength(1);
    expect(parsed.setups).toHaveLength(1);
    expect(parsed.setups[0].direction).toBe("LONG");
    expect(parsed.setups[0].orderType).toBe("BUY_STOP");
    expect(parsed.setups[0].lastPrice).toBe(1.105);
  });

  test("parseAnalysisResponse drops invalid market-now setups", () => {
    const parsed = parseAnalysisResponse(
      '{"summaries":[],"setups":[{"pair":"EUR/USD","direction":"LONG","setup":"RB","orderType":"MARKET_NOW","reasons":[],"risks":[],"confidence":80,"entry":"1.2000","stopLoss":"1.1900","takeProfit1":"1.2100","takeProfit2":"1.2200","riskReward":"1:2","summary":"Test"}],"noSetupReason":""}',
      { lastPriceByPair: new Map([["EURUSD", 1.1005]]) },
    );

    expect(parsed.setups).toHaveLength(0);
    expect(parsed.noSetupReason).toContain("MARKET_NOW");
  });

  test("parsePendingOrderCheckResponse normalizes status and confidence", () => {
    expect(
      parsePendingOrderCheckResponse('{"status":"triggered","confidence":"88","comment":"ok"}'),
    ).toEqual({ status: "TRIGGERED", confidence: 88, comment: "ok" });
  });

  test("buildPendingOrderCheckPrompt includes order details", () => {
    const prompt = buildPendingOrderCheckPrompt({
      id: 1,
      pair: "EUR/USD",
      direction: "LONG",
      setup: "RB",
      orderType: "BUY_STOP",
      entry: "1.10",
      stopLoss: "1.09",
      takeProfit1: "1.12",
      takeProfit2: null,
      confidence: 80,
      reasons: ["EMA"],
      risks: ["Noise"],
      primaryTimeframe: "H4",
      sourceChartFilepath: null,
      status: "PENDING",
      runCount: 0,
      expiryRuns: 0,
      createdAt: "2026-07-08T00:00:00.000Z",
      resolvedAt: null,
      resolvedReason: null,
      triggeredPositionId: null,
    });

    expect(prompt).toContain("EUR/USD");
    expect(prompt).toContain("BUY_STOP");
  });

  test("applyPriceSanityChecks preserves valid trade setup", () => {
    const setup = {
      pair: "EUR/USD",
      direction: "LONG",
      setup: "RB",
      reasons: [],
      risks: [],
      confidence: 80,
      entry: "1.1000",
      stopLoss: "1.0900",
      takeProfit1: "1.1200",
      takeProfit2: "1.1300",
      riskReward: "1:2",
      summary: "ok",
    } as TradeSetup;

    const checked = applyPriceSanityChecks(setup, 1.105);
    expect(checked.setup?.lastPrice).toBe(1.105);
    expect(checked.setup?.currentPriceContext).toContain("Giá thật hiện tại");
  });
});
