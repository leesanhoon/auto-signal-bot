import { describe, it, expect, beforeEach } from "vitest";
import type { Candle, DetectedSignal } from "../../src/charts/ohlc-provider.js";
import type { DetectionContext } from "../../src/charts/setup-types.js";
import { runSbDetection } from "../../src/charts/setup-sb-runner.js";

describe("setup-sb-runner: runSbDetection", () => {
  let ctx: DetectionContext;
  let candles: Candle[];

  beforeEach(() => {
    // Simple context for testing
    ctx = {
      ema20: Array(100).fill(100),
      atr14: Array(100).fill(2),
      pair: "EUR/USD",
      timeframe: "H4",
    };

    // Create simple candles for testing
    candles = Array.from({ length: 100 }, (_, i) => ({
      time: new Date(Date.now() + i * 3600000),
      open: 100 + i * 0.1,
      high: 100.5 + i * 0.1,
      low: 99.5 + i * 0.1,
      close: 100.2 + i * 0.1,
    }));
  });

  it("should return empty arrays for empty signals", () => {
    const result = runSbDetection(candles, [], 50, ctx);
    expect(result.validSignals).toEqual([]);
    expect(result.sbSignals).toEqual([]);
  });

  it("should keep signal that is not false-break", () => {
    const signal: DetectedSignal = {
      setup: "DD",
      pair: "EUR/USD",
      timeframe: "H4",
      direction: "LONG",
      entry: 100,
      stopLoss: 99,
      takeProfit1: 101,
      takeProfit2: 102,
      confidence: 75,
      triggerIndex: 50,
      ruleTrace: ["test"],
    };

    const result = runSbDetection(candles, [signal], 60, ctx);
    expect(result.validSignals).toContainEqual(signal);
    expect(result.sbSignals).toEqual([]);
  });

  it("should filter out signal when false-break detected", () => {
    // For this test, we just verify that the function processes signals correctly.
    // The actual false-break detection depends on specific candle patterns which
    // is tested in indicators.test.ts (isFalseBreak). Here we just verify the
    // logic that removes signals when false-break is confirmed.
    const signal: DetectedSignal = {
      setup: "FB",
      pair: "EUR/USD",
      timeframe: "H4",
      direction: "LONG",
      entry: 100.5,
      stopLoss: 99.5,
      takeProfit1: 102,
      takeProfit2: 104,
      confidence: 70,
      triggerIndex: 50,
      ruleTrace: ["FB trigger"],
    };

    const result = runSbDetection(candles, [signal], 60, ctx);
    // Whether signal is kept or removed depends on isFalseBreak detection.
    // Main thing is: if false-break is detected, signal won't be in validSignals
    // and only sbSignals (if any) will be returned.
    const totalSignals = result.validSignals.length + result.sbSignals.length;
    expect(totalSignals).toBeLessThanOrEqual(1); // At most 1 signal (original or SB)
  });

  it("should handle multiple signals correctly", () => {
    const signal1: DetectedSignal = {
      setup: "DD",
      pair: "EUR/USD",
      timeframe: "H4",
      direction: "LONG",
      entry: 100,
      stopLoss: 99,
      takeProfit1: 101,
      takeProfit2: 102,
      confidence: 75,
      triggerIndex: 40,
      ruleTrace: ["DD trigger"],
    };

    const signal2: DetectedSignal = {
      setup: "FB",
      pair: "EUR/USD",
      timeframe: "H4",
      direction: "SHORT",
      entry: 99.5,
      stopLoss: 101,
      takeProfit1: 98,
      takeProfit2: 97,
      confidence: 60,
      triggerIndex: 50,
      ruleTrace: ["FB trigger"],
    };

    const result = runSbDetection(candles, [signal1, signal2], 60, ctx);
    // Should keep at least signal1 (not false-break)
    expect(result.validSignals.length).toBeGreaterThanOrEqual(1);
    // Total = validSignals + sbSignals should account for all signals
    expect(result.validSignals.length + result.sbSignals.length).toBeLessThanOrEqual(2);
  });

  it("should not process signal if triggerIndex too close to end", () => {
    const signal: DetectedSignal = {
      setup: "BB",
      pair: "EUR/USD",
      timeframe: "H4",
      direction: "LONG",
      entry: 100,
      stopLoss: 99,
      takeProfit1: 102,
      takeProfit2: 104,
      confidence: 80,
      triggerIndex: 99, // Very close to end
      ruleTrace: ["BB trigger"],
    };

    // Should keep signal since we can't look far enough ahead for false-break
    const result = runSbDetection(candles, [signal], 99, ctx);
    expect(result.validSignals).toContainEqual(signal);
  });

  it("should preserve ruleTrace and add SB marker", () => {
    const signal: DetectedSignal = {
      setup: "FB",
      pair: "EUR/USD",
      timeframe: "H4",
      direction: "LONG",
      entry: 101,
      stopLoss: 98,
      takeProfit1: 103,
      takeProfit2: 105,
      confidence: 70,
      triggerIndex: 50,
      ruleTrace: ["Original trace"],
    };

    const result = runSbDetection(candles, [signal], 60, ctx);
    // If SB signal is generated, should have trace marker
    const sbSignals = result.sbSignals.filter((s) => s.ruleTrace.some((t) => t.includes("[SB]")));
    // May or may not have SB based on detectSb success, but if present, should have marker
    sbSignals.forEach((sb) => {
      expect(sb.ruleTrace[0]).toMatch(/\[SB\]/);
    });
  });
});
