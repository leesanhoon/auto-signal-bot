import { describe, expect, test } from "vitest";
import type { TradeSetup } from "../../src/charts/model/chart-types-volman.js";
import {
  applyPriceSanityChecks,
  buildPendingOrderCheckPrompt,
  formatPrice,
  parseAnalysisResponse,
} from "../../src/charts/service/analyzer-volman.js";

describe("charts/analyzer-volman utilities", () => {
  test("formatPrice adapts precision based on value magnitude", () => {
    expect(formatPrice(1.234567)).toBe("1.23457");
    expect(formatPrice(12.34567)).toBe("12.346");
    expect(formatPrice(123.4567)).toBe("123.46");
    expect(formatPrice(1234.567)).toBe("1234.57");
  });

  test("formatPrice handles edge cases", () => {
    expect(formatPrice(0.00001)).toBe("0.00001");
    expect(formatPrice(100.5)).toBe("100.50");
    expect(formatPrice(1000.1)).toBe("1000.10");
  });

  test("applyPriceSanityChecks preserves valid trade setup", () => {
    const setup: TradeSetup = {
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
    };

    const checked = applyPriceSanityChecks(setup, 1.105);
    expect(checked.setup).not.toBeNull();
    expect(checked.setup?.lastPrice).toBe(1.105);
    expect(checked.setup?.currentPriceContext).toBeUndefined();
  });

  test("applyPriceSanityChecks rejects MARKET_NOW with high deviation", () => {
    const setup: TradeSetup = {
      pair: "EUR/USD",
      direction: "LONG",
      setup: "RB",
      orderType: "MARKET_NOW",
      reasons: [],
      risks: [],
      confidence: 80,
      entry: "1.2000",
      stopLoss: "1.1900",
      takeProfit1: "1.2100",
      takeProfit2: "1.2200",
      riskReward: "1:2",
      summary: "Test",
    };

    const checked = applyPriceSanityChecks(setup, 1.1005);
    expect(checked.setup).toBeNull();
    expect(checked.note).toContain("MARKET_NOW");
  });

  test("applyPriceSanityChecks rejects LONG setup when price is below stop loss", () => {
    const setup: TradeSetup = {
      pair: "EUR/USD",
      direction: "LONG",
      setup: "RB",
      reasons: [],
      risks: [],
      confidence: 80,
      entry: "1.1200",
      stopLoss: "1.1000",
      takeProfit1: "1.1400",
      takeProfit2: "1.1500",
      riskReward: "1:2",
      summary: "Test",
    };

    const checked = applyPriceSanityChecks(setup, 0.95);
    expect(checked.setup).toBeNull();
    expect(checked.note).toContain("stop loss");
  });

  test("applyPriceSanityChecks rejects SHORT setup when price is above stop loss", () => {
    const setup: TradeSetup = {
      pair: "EUR/USD",
      direction: "SHORT",
      setup: "RB",
      reasons: [],
      risks: [],
      confidence: 80,
      entry: "1.1000",
      stopLoss: "1.1200",
      takeProfit1: "1.0800",
      takeProfit2: "1.0700",
      riskReward: "1:2",
      summary: "Test",
    };

    const checked = applyPriceSanityChecks(setup, 1.15);
    expect(checked.setup).toBeNull();
    expect(checked.note).toContain("stop loss");
  });

  test("applyPriceSanityChecks detects TP breach for LONG", () => {
    const setup: TradeSetup = {
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
      summary: "Test",
    };

    const checked = applyPriceSanityChecks(setup, 1.135);
    expect(checked.setup?.currentPriceContext).toContain("Giá đã chạm/vượt TP 1.12000");
    expect(checked.setup?.currentPriceContext).not.toContain("TP1");
    expect(checked.setup?.currentPriceContext).not.toContain("TP2");
  });

  test("buildPendingOrderCheckPrompt includes one take-profit target", () => {
    const prompt = buildPendingOrderCheckPrompt({
      id: 1,
      pair: "EUR/USD",
      direction: "LONG",
      setup: "RB",
      orderType: "BUY_STOP",
      entry: "1.1000",
      stopLoss: "1.0900",
      takeProfit1: "1.1200",
      takeProfit2: null,
      confidence: 80,
      reasons: [],
      risks: [],
      primaryTimeframe: "H4",
      sourceChartFilepath: null,
      status: "PENDING",
      runCount: 0,
      expiryRuns: 3,
      createdAt: "2026-07-14T00:00:00.000Z",
      resolvedAt: null,
      resolvedReason: null,
      triggeredPositionId: null,
    });

    expect(prompt).toContain("- Take profit: 1.1200");
    expect(prompt).not.toContain("Take profit 1");
    expect(prompt).not.toContain("Take profit 2");
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

  test("parseAnalysisResponse normalizes Vietnamese direction variants", () => {
    const parsed = parseAnalysisResponse(
      '{"summaries":[],"setups":[{"pair":"EUR/USD","direction":"Bán","setup":"RB","reasons":[],"risks":[],"confidence":80,"entry":"1.1","stopLoss":"1.12","takeProfit1":"1.08","takeProfit2":"1.07","riskReward":"1:2","summary":"Test"}],"noSetupReason":""}',
    );

    expect(parsed.setups).toHaveLength(1);
    expect(parsed.setups[0].direction).toBe("SHORT");
  });

  test("parseAnalysisResponse handles invalid JSON gracefully", () => {
    const parsed = parseAnalysisResponse("not json at all");

    expect(parsed.summaries).toHaveLength(0);
    expect(parsed.setups).toHaveLength(0);
    expect(parsed.noSetupReason).toContain("Failed to parse");
  });

  test("parseAnalysisResponse handles empty setups", () => {
    const parsed = parseAnalysisResponse(
      '{"summaries":[],"setups":[],"noSetupReason":"No valid setup found"}',
    );

    expect(parsed.setups).toHaveLength(0);
    expect(parsed.noSetupReason).toBe("No valid setup found");
  });
});
