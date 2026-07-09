import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Candle } from "../../../src/charts/ohlc-provider.js";
import type { ChartTimeframe } from "../../../src/charts/chart-types.js";
import type { SmcSignal } from "../../../src/charts/smc/smc-types.js";
import type { HtfContext } from "../../../src/charts/smc/smc-htf-context.js";

const mocks = vi.hoisted(() => ({
  analyzeSmcSignalsAtIndex: vi.fn(),
}));

vi.mock("../../../src/charts/smc/smc-pipeline.js", () => ({
  analyzeSmcSignalsAtIndex: mocks.analyzeSmcSignalsAtIndex,
}));

import { runSmcBacktest } from "../../../src/charts/smc/smc-backtest.js";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 100 };
}

function signal(overrides: Partial<SmcSignal>): SmcSignal {
  return {
    setup: "SMC_BOS_OB",
    pair: "XAUTUSDT",
    timeframe: "M15",
    direction: "LONG",
    entry: 100,
    stopLoss: 99,
    takeProfit1: 101,
    takeProfit2: 102,
    confidence: 50,
    grade: "B",
    score: 50,
    triggerIndex: 30,
    ruleTrace: ["test"],
    ...overrides,
  };
}

describe("runSmcBacktest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.analyzeSmcSignalsAtIndex.mockImplementation(() => []);
  });

  test("insufficient candles returns empty report", () => {
    const result = runSmcBacktest([candle(1, 1, 1, 1, 1)], "XAUTUSDT", "M15");
    expect(result.signals).toBe(0);
    expect(result.overall.trades).toBe(0);
  });

  test("walk-forward keeps the signal from the current step even when an older higher-confidence signal exists earlier in the history", () => {
    const candles = Array.from({ length: 60 }, (_, i) =>
      candle(i + 1, 100, 100.5, 99.5, 100),
    );

    candles[31] = candle(32, 100, 101.5, 99.5, 101);
    candles[32] = candle(33, 101, 101.3, 100.7, 101.1);
    candles[45] = candle(46, 104.5, 105.0, 104.0, 104.5);
    candles[46] = candle(47, 104.5, 104.7, 102.0, 102.4);

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index === 31) {
        return [
          signal({
            pair,
            timeframe,
            direction: "LONG",
            triggerIndex: 31,
            confidence: 92,
            grade: "A",
            score: 92,
            entry: 100,
            stopLoss: 99,
            takeProfit1: 101,
            takeProfit2: 101.5,
            takeProfit3: 101.2,
          }),
        ];
      }
      if (index === 45) {
        return [
          signal({
            pair,
            timeframe,
            setup: "SMC_FVG_CONTINUATION",
            direction: "SHORT",
            triggerIndex: 45,
            confidence: 60,
            grade: "C",
            score: 60,
            entry: 104.5,
            stopLoss: 106,
            takeProfit1: 103.5,
            takeProfit2: 102.5,
          }),
        ];
      }
      return [];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(mocks.analyzeSmcSignalsAtIndex).toHaveBeenCalledWith(candles, "XAUTUSDT", "M15", 31, null);
    expect(mocks.analyzeSmcSignalsAtIndex).toHaveBeenCalledWith(candles, "XAUTUSDT", "M15", 45, null);
    expect(result.signals).toBe(2);
    expect(result.overall.trades).toBe(2);
    expect(result.trades.map((trade) => trade.entryIndex)).toEqual([31, 45]);
    expect(result.trades.map((trade) => trade.outcome)).toEqual(["tp3", "tp2"]);
  });

  test("counts signals that appear while an earlier trade is still open without opening a second trade", () => {
    const candles = Array.from({ length: 60 }, (_, i) =>
      candle(i + 1, 100, 100.4, 99.6, 100),
    );

    candles[31] = candle(32, 100, 100.5, 99.5, 100.1);
    candles[35] = candle(36, 104.5, 104.8, 104.2, 104.4);
    candles[36] = candle(37, 104.4, 104.6, 104.1, 104.3);

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index === 31) {
        return [
          signal({
            pair,
            timeframe,
            direction: "LONG",
            triggerIndex: 31,
            confidence: 90,
            grade: "A",
            score: 90,
            entry: 100,
            stopLoss: 99,
            takeProfit1: 120,
            takeProfit2: 121,
          }),
        ];
      }
      if (index === 35) {
        return [
          signal({
            pair,
            timeframe,
            setup: "SMC_FVG_CONTINUATION",
            direction: "SHORT",
            triggerIndex: 35,
            confidence: 65,
            grade: "B",
            score: 65,
            entry: 104.5,
            stopLoss: 106,
            takeProfit1: 103.5,
            takeProfit2: 102.5,
          }),
          signal({
            pair,
            timeframe,
            setup: "SMC_LIQUIDITY_SWEEP",
            direction: "LONG",
            triggerIndex: 35,
            confidence: 60,
            grade: "C",
            score: 60,
            entry: 104.4,
            stopLoss: 103.8,
            takeProfit1: 105.6,
            takeProfit2: 106.2,
          }),
        ];
      }
      return [];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(mocks.analyzeSmcSignalsAtIndex).toHaveBeenCalledWith(candles, "XAUTUSDT", "M15", 31, null);
    expect(mocks.analyzeSmcSignalsAtIndex).toHaveBeenCalledWith(candles, "XAUTUSDT", "M15", 35, null);
    expect(result.signals).toBe(3);
    expect(result.overall.trades).toBe(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.entryIndex).toBe(31);
    expect(result.trades[0]?.outcome).toBe("open_at_end");
    expect(result.bySetupStats["SMC_BOS_OB"].skippedWhileOpen).toBe(0);
    expect(result.bySetupStats["SMC_FVG_CONTINUATION"].skippedWhileOpen).toBe(1);
    expect(result.bySetupStats["SMC_LIQUIDITY_SWEEP"].skippedWhileOpen).toBe(1);
  });

  test("counts every candidate when one candle returns multiple SMC signals but opens only one trade", () => {
    const candles = Array.from({ length: 60 }, (_, i) =>
      candle(i + 1, 100, 100.4, 99.6, 100),
    );

    candles[31] = candle(32, 100, 100.5, 99.5, 100.1);
    candles[32] = candle(33, 100.1, 110.5, 100.0, 110.2);

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 31) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: 31,
          confidence: 88,
          grade: "A",
          score: 88,
          entry: 100,
          stopLoss: 99,
          takeProfit1: 110,
          takeProfit2: 111,
        }),
        signal({
          pair,
          timeframe,
          setup: "SMC_FVG_CONTINUATION",
          direction: "LONG",
          triggerIndex: 31,
          confidence: 70,
          grade: "B",
          score: 70,
          entry: 100,
          stopLoss: 99,
          takeProfit1: 109,
          takeProfit2: 110,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(2);
    expect(result.overall.trades).toBe(1);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.entryIndex).toBe(31);
    expect(result.trades[0]?.setup).toBe("SMC_BOS_OB");
    expect(result.bySetupStats["SMC_BOS_OB"].signals).toBe(1);
    expect(result.bySetupStats["SMC_FVG_CONTINUATION"].signals).toBe(1);
  });

  test("blocks stale re-entry for the same setup fingerprint after the first trade closes", () => {
    const candles = Array.from({ length: 70 }, (_, i) =>
      candle(i + 1, 100, 100.5, 99.5, 100),
    );

    candles[31] = candle(32, 100, 101.5, 99.5, 101);
    candles[32] = candle(33, 101, 101.3, 100.7, 101.1);
    candles[33] = candle(34, 101.1, 101.4, 100.8, 101.2);

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index < 31 || index > 33) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: index,
          confidence: 92,
          grade: "A",
          score: 92,
          entry: 100,
          stopLoss: 99,
          takeProfit1: 101,
          takeProfit2: 101.5,
          takeProfit3: 102,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(3);
    expect(result.overall.trades).toBe(1);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.entryIndex).toBe(31);
    expect(result.bySetupStats["SMC_BOS_OB"].attemptedTrades).toBe(1);
    expect(result.bySetupStats["SMC_BOS_OB"].signals).toBe(3);
  });

  test("keeps a skipped signal eligible later after the open trade closes", () => {
    const candles = Array.from({ length: 70 }, (_, i) =>
      candle(i + 1, 100, 100.4, 99.6, 100),
    );

    candles[31] = candle(32, 100, 100.6, 99.4, 100.2);
    candles[40] = candle(41, 100.1, 110.5, 100.0, 110.2);
    candles[45] = candle(46, 104.8, 105.4, 104.2, 105.1);

    const repeatedSignal = (triggerIndex: number) =>
      signal({
        pair: "XAUTUSDT",
        timeframe: "M15",
        setup: "SMC_FVG_CONTINUATION",
        direction: "LONG",
        triggerIndex,
        confidence: 77,
        grade: "B",
        score: 77,
        entry: 104.8,
        stopLoss: 104.1,
        takeProfit1: 106,
        takeProfit2: 107,
      });

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index === 31) {
        return [
          signal({
            pair,
            timeframe,
            setup: "SMC_BOS_OB",
            direction: "LONG",
            triggerIndex: 31,
            confidence: 90,
            grade: "A",
            score: 90,
            entry: 100,
            stopLoss: 99,
            takeProfit1: 108,
            takeProfit2: 109,
          }),
        ];
      }
      if (index === 35) {
        return [repeatedSignal(35)];
      }
      if (index === 45) {
        return [repeatedSignal(45)];
      }
      return [];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(3);
    expect(result.trades.map((trade) => trade.setup)).toEqual(["SMC_BOS_OB", "SMC_FVG_CONTINUATION"]);
    expect(result.trades.map((trade) => trade.entryIndex)).toEqual([31, 45]);
    expect(result.bySetupStats["SMC_FVG_CONTINUATION"].skippedWhileOpen).toBe(1);
    expect(result.bySetupStats["SMC_FVG_CONTINUATION"].attemptedTrades).toBe(1);
  });

  test("fills when price overlaps entryZone even if exact entry is not touched", () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i + 1, 100, 100.2, 99.8, 100),
    );

    candles[30] = candle(31, 100, 100.55, 100.0, 100.45);
    candles[31] = candle(32, 100.45, 101.5, 100.3, 101.2);

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 30) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: 30,
          entry: 100.7,
          entryZone: { low: 100.5, high: 100.9 },
          stopLoss: 100.1,
          takeProfit1: 101.3,
          takeProfit2: 101.8,
          confidence: 88,
          grade: "A",
          score: 88,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(1);
    expect(result.overall.trades).toBe(1);
    expect(result.trades[0]?.entryIndex).toBe(30);
    expect(result.trades[0]?.outcome).not.toBe("expired");
  });

  test("tracks expired trades in the outcome breakdown", () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i + 1, 100, 100.1, 99.9, 100),
    );

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 30) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "SHORT",
          triggerIndex: 30,
          entry: 90,
          entryZone: { low: 89.5, high: 90.5 },
          stopLoss: 91,
          takeProfit1: 88,
          takeProfit2: 87,
          confidence: 70,
          grade: "B",
          score: 70,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(1);
    expect(result.outcomes.expired).toBe(1);
    expect(result.byPairStats["XAUTUSDT"].outcomes.expired).toBe(1);
    expect(result.byPairStats["XAUTUSDT"].attemptedTrades).toBe(1);
    expect(result.overall.trades).toBe(0);
  });

  test("runSmcBacktest passes htfContext to analyzeSmcSignalsAtIndex from array by index", () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i + 1, 100, 100.1, 99.9, 100),
    );

    mocks.analyzeSmcSignalsAtIndex.mockReturnValue([]);

    const htfContextWithShortBias: HtfContext = {
      timeframe: "H4",
      bias: "SHORT",
      swings: [],
      candlesLength: 100,
    };

    const htfContexts = candles.map(() => htfContextWithShortBias);

    runSmcBacktest(candles, "XAUTUSDT", "M15", htfContexts);

    // Verify that analyzeSmcSignalsAtIndex was called with correct context at each index
    expect(mocks.analyzeSmcSignalsAtIndex).toHaveBeenCalled();
    const calls = mocks.analyzeSmcSignalsAtIndex.mock.calls;
    for (const call of calls) {
      const index = call[3];
      expect(call[4]).toBe(htfContexts[index]);
    }
  });

  test("runSmcBacktest backward compatibility: works without htfContexts parameter", () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i + 1, 100, 100.1, 99.9, 100),
    );

    mocks.analyzeSmcSignalsAtIndex.mockReturnValue([]);

    // Call without htfContexts - should not throw, analyzeSmcSignalsAtIndex gets null at each index
    const result1 = runSmcBacktest(candles, "XAUTUSDT", "M15");
    expect(result1).toBeDefined();
    expect(result1.signals).toBe(0);
    expect(mocks.analyzeSmcSignalsAtIndex).toHaveBeenCalledWith(candles, "XAUTUSDT", "M15", expect.any(Number), null);

    vi.clearAllMocks();
    mocks.analyzeSmcSignalsAtIndex.mockReturnValue([]);

    // Call with undefined htfContexts - should not throw
    const result2 = runSmcBacktest(candles, "XAUTUSDT", "M15", undefined);
    expect(result2).toBeDefined();
    expect(result2.signals).toBe(0);
    expect(mocks.analyzeSmcSignalsAtIndex).toHaveBeenCalledWith(candles, "XAUTUSDT", "M15", expect.any(Number), null);
  });

  test("runSmcBacktest includes HTF context assumption in report", () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i + 1, 100, 100.1, 99.9, 100),
    );

    mocks.analyzeSmcSignalsAtIndex.mockReturnValue([]);

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    const htfAssumption = result.assumptions.find(
      (assumption) =>
        assumption.includes("HTF context") && assumption.includes("rolling"),
    );
    expect(htfAssumption).toBeDefined();
  });

  test("runSmcBacktest handles htfContexts array shorter than candles", () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i + 1, 100, 100.1, 99.9, 100),
    );

    mocks.analyzeSmcSignalsAtIndex.mockReturnValue([]);

    const htfContext1: HtfContext = {
      timeframe: "H4",
      bias: "LONG",
      swings: [],
      candlesLength: 50,
    };

    const htfContexts = Array(20).fill(htfContext1);

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15", htfContexts);
    expect(result).toBeDefined();
    expect(result.signals).toBe(0);

    const calls = mocks.analyzeSmcSignalsAtIndex.mock.calls;
    for (const call of calls) {
      const index = call[3];
      if (index < htfContexts.length) {
        expect(call[4]).toBe(htfContext1);
      } else {
        expect(call[4]).toBeNull();
      }
    }
  });
});
