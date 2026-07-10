import { describe, it, expect, beforeEach } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";
import type { DetectedSignal, DetectionContext } from "../../src/charts/setup-types.js";
import { runSbDetection } from "../../src/charts/setup-sb-runner.js";

describe("setup-sb-runner: runSbDetection", () => {
  let ctx: DetectionContext;
  let candles: Candle[];

  beforeEach(() => {
    ctx = {
      ema20: Array(100).fill(100),
      atr14: Array(100).fill(2),
      pair: "EUR/USD",
      timeframe: "H4",
    };

    candles = Array.from({ length: 100 }, (_, i) => ({
      time: Date.now() + i * 3600000,
      open: 100 + i * 0.1,
      high: 100.5 + i * 0.1,
      low: 99.5 + i * 0.1,
      close: 100.2 + i * 0.1,
    }));
  });

  it("should return empty resolved for empty signals", () => {
    const { resolved } = runSbDetection(candles, [], 50, ctx);
    expect(resolved).toEqual([]);
  });

  it("should keep signal that is not false-break", () => {
    const signal: DetectedSignal = {
      setup: "DD", pair: "EUR/USD", timeframe: "H4", direction: "LONG",
      entry: 100, stopLoss: 99, takeProfit1: 101, takeProfit2: 102,
      confidence: 75, triggerIndex: 50, ruleTrace: ["test"],
    };
    const { resolved } = runSbDetection(candles, [signal], 60, ctx);
    expect(resolved).toContainEqual(signal);
  });

  it("should filter out signal when false-break detected", () => {
    // Fixture: price breaks above level (entry=105, stop=104) then returns inside
    const rangeCandles: Candle[] = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 100 },  // 0: pre
      { time: 1, open: 100, high: 106, low: 100, close: 105, volume: 100 }, // 1: breakout above range
      { time: 2, open: 105, high: 105, low: 100, close: 102, volume: 100 }, // 2: returns inside → FALSE BREAK
    ];
    const signal: DetectedSignal = {
      setup: "FB", pair: "EUR/USD", timeframe: "H4", direction: "LONG",
      entry: 105, stopLoss: 100, takeProfit1: 108, takeProfit2: 110,
      confidence: 70, triggerIndex: 1, ruleTrace: ["FB trigger"],
    };
    const { resolved } = runSbDetection(rangeCandles, [signal], 2, ctx);
    // Signal should be removed (false-break), SB may or may not exist
    expect(resolved.find((s) => s.setup === "FB")).toBeUndefined();
  });

  it("should not remove signal when breakout continues (no false-break)", () => {
    const rangeCandles: Candle[] = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 100 },  // 0: pre
      { time: 1, open: 100, high: 106, low: 100, close: 105, volume: 100 }, // 1: breakout
      { time: 2, open: 106, high: 108, low: 105, close: 107, volume: 100 }, // 2: continues up → no false break
    ];
    const signal: DetectedSignal = {
      setup: "FB", pair: "EUR/USD", timeframe: "H4", direction: "LONG",
      entry: 105, stopLoss: 100, takeProfit1: 108, takeProfit2: 110,
      confidence: 70, triggerIndex: 1, ruleTrace: ["FB trigger"],
    };
    const { resolved } = runSbDetection(rangeCandles, [signal], 2, ctx);
    expect(resolved).toContainEqual(signal);
  });

  it("should handle multiple signals correctly", () => {
    const s1: DetectedSignal = {
      setup: "DD", pair: "EUR/USD", timeframe: "H4", direction: "LONG",
      entry: 100, stopLoss: 99, takeProfit1: 101, takeProfit2: 102,
      confidence: 75, triggerIndex: 40, ruleTrace: ["DD trigger"],
    };
    const s2: DetectedSignal = {
      setup: "FB", pair: "EUR/USD", timeframe: "H4", direction: "SHORT",
      entry: 99.5, stopLoss: 101, takeProfit1: 98, takeProfit2: 97,
      confidence: 60, triggerIndex: 50, ruleTrace: ["FB trigger"],
    };
    const { resolved } = runSbDetection(candles, [s1, s2], 60, ctx);
    // Same pair → resolveSetupConflicts keeps higher-confidence signal (DD with 75 > 60)
    expect(resolved).toHaveLength(1);
    expect(resolved[0].setup).toBe("DD");
    expect(resolved[0].confidence).toBe(75);
  });

  it("should not process signal if triggerIndex too close to end", () => {
    const signal: DetectedSignal = {
      setup: "BB", pair: "EUR/USD", timeframe: "H4", direction: "LONG",
      entry: 100, stopLoss: 99, takeProfit1: 102, takeProfit2: 104,
      confidence: 80, triggerIndex: 99, ruleTrace: ["BB trigger"],
    };
    const { resolved } = runSbDetection(candles, [signal], 99, ctx);
    expect(resolved).toContainEqual(signal);
  });

  it("should drop a false-break signal outright (SB reversal retired — no replacement generated)", () => {
    const rangeCandles: Candle[] = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 100 },          // 0: pre
      { time: 1, open: 100, high: 101.2, low: 99.8, close: 101, volume: 100 },      // 1: breakout above
      { time: 2, open: 101, high: 101.2, low: 99.5, close: 100, volume: 100 },      // 2: false break (returns inside)
      { time: 3, open: 99.5, high: 100.5, low: 99, close: 99.5, volume: 100 },      // 3
      { time: 4, open: 99, high: 99.5, low: 99, close: 98.9, volume: 100 },         // 4
    ];
    const signal: DetectedSignal = {
      setup: "FB", pair: "EUR/USD", timeframe: "H4", direction: "LONG",
      entry: 101.2, stopLoss: 99.8, takeProfit1: 108, takeProfit2: 110,
      confidence: 70, triggerIndex: 1, ruleTrace: ["FB trigger"],
    };
    const { resolved } = runSbDetection(rangeCandles, [signal], 4, ctx);
    // Original FB is gone (false-break) and nothing replaces it.
    expect(resolved).toHaveLength(0);
  });
})
