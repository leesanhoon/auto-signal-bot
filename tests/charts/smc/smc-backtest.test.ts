import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Candle } from "../../../src/charts/ohlc-provider.js";
import type { ChartTimeframe } from "../../../src/charts/chart-types-common.js";
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

    candles[31] = candle(32, 100, 100.5, 99.5, 100);
    candles[32] = candle(33, 100, 101.5, 99.5, 101);
    candles[33] = candle(34, 101, 101.3, 100.7, 101.1);
    candles[45] = candle(46, 104.5, 104.5, 104.0, 104.5);
    candles[46] = candle(47, 104.5, 105.0, 102.0, 102.4);

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
    expect(result.trades.map((trade) => trade.entryIndex)).toEqual([32, 46]);
    expect(result.trades.map((trade) => trade.outcome)).toEqual(["tp3", "tp2"]);
  });

  test("counts signals that appear while an earlier trade is still open without opening a second trade", () => {
    const candles = Array.from({ length: 60 }, (_, i) =>
      candle(i + 1, 100, 100.4, 99.6, 100),
    );

    candles[31] = candle(32, 100, 100.4, 99.6, 100);
    candles[32] = candle(33, 100, 100.5, 99.5, 100.1);
    candles[35] = candle(36, 104.5, 104.5, 104.2, 104.4);
    candles[36] = candle(37, 104.4, 104.8, 104.1, 104.3);

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
    expect(result.trades[0]?.entryIndex).toBe(32);
    expect(result.trades[0]?.outcome).toBe("open_at_end");
    expect(result.bySetupStats["SMC_BOS_OB"].skippedWhileOpen).toBe(0);
    expect(result.bySetupStats["SMC_FVG_CONTINUATION"].skippedWhileOpen).toBe(1);
    expect(result.bySetupStats["SMC_LIQUIDITY_SWEEP"].skippedWhileOpen).toBe(1);
  });

  test("counts every candidate when one candle returns multiple SMC signals but opens only one trade", () => {
    const candles = Array.from({ length: 60 }, (_, i) =>
      candle(i + 1, 100, 100.4, 99.6, 100),
    );

    candles[31] = candle(32, 100, 100.4, 99.6, 100);
    candles[32] = candle(33, 100, 100.5, 99.5, 100.1);
    candles[33] = candle(34, 100.1, 110.5, 100.0, 110.2);

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
    expect(result.trades[0]?.entryIndex).toBe(32);
    expect(result.trades[0]?.setup).toBe("SMC_BOS_OB");
    expect(result.bySetupStats["SMC_BOS_OB"].signals).toBe(1);
    expect(result.bySetupStats["SMC_FVG_CONTINUATION"].signals).toBe(1);
  });

  test("blocks stale re-entry for the same setup fingerprint after the first trade closes", () => {
    const candles = Array.from({ length: 70 }, (_, i) =>
      candle(i + 1, 100, 100.5, 99.5, 100),
    );

    candles[31] = candle(32, 100, 100.5, 99.5, 100);
    candles[32] = candle(33, 100, 101.5, 99.5, 101);
    candles[33] = candle(34, 101, 101.3, 100.7, 101.1);
    candles[34] = candle(35, 101.1, 101.4, 100.8, 101.2);

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
    expect(result.trades[0]?.entryIndex).toBe(32);
    expect(result.bySetupStats["SMC_BOS_OB"].attemptedTrades).toBe(1);
    expect(result.bySetupStats["SMC_BOS_OB"].signals).toBe(3);
  });

  test("keeps a skipped signal eligible later after the open trade closes", () => {
    const candles = Array.from({ length: 70 }, (_, i) =>
      candle(i + 1, 100, 100.4, 99.6, 100),
    );

    candles[31] = candle(32, 100, 100.4, 99.6, 100);
    candles[32] = candle(33, 100, 100.6, 99.4, 100.2);
    candles[40] = candle(41, 100.1, 110.5, 100.0, 110.2);
    candles[45] = candle(46, 104.8, 104.8, 104.2, 104.8);
    candles[46] = candle(47, 104.8, 105.4, 104.2, 105.1);

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
    expect(result.trades.map((trade) => trade.entryIndex)).toEqual([32, 46]);
    expect(result.bySetupStats["SMC_FVG_CONTINUATION"].skippedWhileOpen).toBe(1);
    expect(result.bySetupStats["SMC_FVG_CONTINUATION"].attemptedTrades).toBe(1);
  });

  test("fills when price overlaps entryZone even if exact entry is not touched", () => {
    const candles = Array.from({ length: 40 }, (_, i) =>
      candle(i + 1, 100, 100.2, 99.8, 100),
    );

    candles[30] = candle(31, 100, 100.2, 99.8, 100);
    candles[31] = candle(32, 100, 100.55, 100.0, 100.45);
    candles[32] = candle(33, 100.45, 101.5, 100.3, 101.2);

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
    expect(result.trades[0]?.entryIndex).toBe(31);
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

  test("does not fill on signal candle — outcome expired if entry zone not touched within 5 candles after trigger", () => {
    const candles = Array.from({ length: 45 }, (_, i) =>
      candle(i + 1, 100, 100.2, 99.8, 100),
    );

    candles[30] = candle(31, 100, 100.5, 99.5, 100);
    candles[31] = candle(32, 100, 100.3, 99.7, 100);
    candles[32] = candle(33, 100, 100.4, 99.6, 100);
    candles[33] = candle(34, 100, 100.3, 99.7, 100);
    candles[34] = candle(35, 100, 100.2, 99.8, 100);
    candles[35] = candle(36, 100, 100.1, 99.9, 100);

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 30) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: 30,
          entry: 100.6,
          entryZone: { low: 100.55, high: 100.65 },
          stopLoss: 99.5,
          takeProfit1: 101,
          takeProfit2: 102,
          confidence: 85,
          grade: "A",
          score: 85,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(1);
    expect(result.outcomes.expired).toBe(1);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.outcome).toBe("expired");
  });

  test("does not hit TP on fill candle — TP only checked from next candle onwards", () => {
    // Test partial exit behavior: TP1 then TP2 on successive candles
    // Gross: 0.5*(101-100)/0.5 + 0.5*(102-100)/0.5 = 1 + 2 = 3
    // Net (with default 0.12% fees per direction): ~2.52
    const candles = Array.from({ length: 45 }, (_, i) =>
      candle(i + 1, 100, 100.2, 99.8, 100),
    );

    candles[30] = candle(31, 100, 100.2, 99.8, 100);
    candles[31] = candle(32, 100, 101.5, 99.9, 101); // TP1 hit but not TP2
    candles[32] = candle(33, 101, 102.5, 101.0, 102); // TP2 hit here

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 30) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: 30,
          entry: 100,
          entryZone: { low: 99.9, high: 100.1 },
          stopLoss: 99.5,
          takeProfit1: 101,
          takeProfit2: 102,
          confidence: 85,
          grade: "A",
          score: 85,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(1);
    expect(result.overall.trades).toBe(1);
    expect(result.trades[0]?.entryIndex).toBe(31);
    expect(result.trades[0]?.outcome).toBe("tp2");
    expect(result.trades[0]?.exitIndex).toBe(32);
    // Net RR with default fees should be less than gross
    expect(result.trades[0]?.realizedRiskReward).toBeCloseTo(2.52, 0.2);
  });

  test("still checks stop loss on fill candle — SL can close on fill", () => {
    const candles = Array.from({ length: 45 }, (_, i) =>
      candle(i + 1, 100, 100.2, 99.8, 100),
    );

    candles[30] = candle(31, 100, 100.2, 99.8, 100);
    candles[31] = candle(32, 100, 100.5, 98.5, 99.8);

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 30) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: 30,
          entry: 100,
          entryZone: { low: 99.9, high: 100.1 },
          stopLoss: 99,
          takeProfit1: 101,
          takeProfit2: 102,
          confidence: 85,
          grade: "A",
          score: 85,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(1);
    expect(result.overall.trades).toBe(1);
    expect(result.trades[0]?.entryIndex).toBe(31);
    expect(result.trades[0]?.outcome).toBe("stop");
    expect(result.trades[0]?.exitIndex).toBe(31);
  });

  test("expired_hold releases slot for next signal after timeout", () => {
    const candles = Array.from({ length: 180 }, (_, i) =>
      candle(i + 1, 100, 100.2, 99.8, 100),
    );

    candles[30] = candle(31, 100, 100.2, 99.8, 100);
    candles[31] = candle(32, 100, 100.5, 99.5, 100.1);
    candles[127] = candle(128, 100, 100.2, 99.8, 100.1);
    candles[140] = candle(141, 100, 100.2, 99.8, 100);
    candles[141] = candle(142, 100, 100.5, 99.5, 100.1);
    candles[142] = candle(143, 100.1, 101.5, 99.9, 101.5);

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index === 30) {
        return [
          signal({
            pair,
            timeframe,
            direction: "LONG",
            triggerIndex: 30,
            entry: 100,
            entryZone: { low: 99.9, high: 100.1 },
            stopLoss: 99,
            takeProfit1: 120,
            takeProfit2: 121,
            confidence: 85,
            grade: "A",
            score: 85,
          }),
        ];
      }
      if (index === 140) {
        return [
          signal({
            pair,
            timeframe,
            setup: "SMC_FVG_CONTINUATION",
            direction: "LONG",
            triggerIndex: 140,
            entry: 100,
            entryZone: { low: 99.9, high: 100.1 },
            stopLoss: 99,
            takeProfit1: 101,
            takeProfit2: 102,
            confidence: 70,
            grade: "B",
            score: 70,
          }),
        ];
      }
      return [];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(2);
    expect(result.overall.trades).toBe(2);
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]?.entryIndex).toBe(31);
    expect(result.trades[0]?.outcome).toBe("expired_hold");
    expect(result.trades[0]?.exitIndex).toBe(127);
    expect(result.trades[1]?.entryIndex).toBe(141);
    expect(result.trades[1]?.outcome).toBe("tp1");
    expect(result.bySetupStats["SMC_BOS_OB"].skippedWhileOpen).toBe(0);
  });

  test("partial-exit-a: LONG with TP3, hits all three levels", () => {
    // Partial exit: 50% at TP1, 30% at TP2, 20% at TP3
    // Gross: 0.5*(101-100)/1 + 0.3*(102-100)/1 + 0.2*(103-100)/1 = 0.5 + 0.6 + 0.6 = 1.7
    // Net (with default fees): ~1.46
    const candles = Array.from({ length: 50 }, (_, i) =>
      candle(i + 1, 100, 100.1, 99.9, 100),
    );

    candles[30] = candle(31, 100, 100.1, 99.9, 100);
    candles[31] = candle(32, 100, 101.5, 99.9, 101); // TP1 hit
    candles[32] = candle(33, 101, 102.5, 100.5, 102); // TP2 hit
    candles[33] = candle(34, 102, 103.5, 101.5, 103); // TP3 hit

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 30) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: 30,
          entry: 100,
          entryZone: { low: 99.9, high: 100.1 },
          stopLoss: 99,
          takeProfit1: 101,
          takeProfit2: 102,
          takeProfit3: 103,
          confidence: 85,
          grade: "A",
          score: 85,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(1);
    expect(result.overall.trades).toBe(1);
    expect(result.trades[0]?.outcome).toBe("tp3");
    expect(result.trades[0]?.exitIndex).toBe(33);
    // Net RR with fees applied
    expect(result.trades[0]?.realizedRiskReward).toBeCloseTo(1.46, 0.2);
  });

  test("partial-exit-b: partial exit reaches both TP1 and TP2", () => {
    // Verify that TP1 closes 50%, TP2 closes remaining 50% (for no-TP3 setup)
    // When both TP levels are hit, outcome should be tp2 (highest reached)
    const candles = Array.from({ length: 50 }, (_, i) =>
      candle(i + 1, 100, 100.1, 99.9, 100),
    );

    candles[30] = candle(31, 100, 100.1, 99.9, 100);
    candles[31] = candle(32, 100, 101.5, 99.9, 101); // TP1 hit (but not TP2, high is 101.5 > 102)
    candles[32] = candle(33, 101, 102.5, 100.5, 102); // TP2 hit on this candle

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 30) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: 30,
          entry: 100,
          entryZone: { low: 99.9, high: 100.1 },
          stopLoss: 99,
          takeProfit1: 101,
          takeProfit2: 102,
          confidence: 85,
          grade: "A",
          score: 85,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(1);
    expect(result.overall.trades).toBe(1);
    // Outcome should be tp2 since TP2 was the highest TP reached
    expect(result.trades[0]?.outcome).toBe("tp2");
    // RR should reflect partial exits at both levels minus fees
    expect(result.trades[0]?.realizedRiskReward).toBeLessThan(1.5);
  });

  test("partial-exit-c: LONG no TP3, hits TP1 then TP2", () => {
    // 2-TP setup: 50% at TP1, 50% at TP2
    // Gross: 0.5*(101-100)/1 + 0.5*(102-100)/1 = 0.5 + 1 = 1.5
    // Net (with default fees): ~1.26
    const candles = Array.from({ length: 50 }, (_, i) =>
      candle(i + 1, 100, 100.1, 99.9, 100),
    );

    candles[30] = candle(31, 100, 100.1, 99.9, 100);
    candles[31] = candle(32, 100, 101.5, 99.9, 101); // TP1 hit
    candles[32] = candle(33, 101, 102.5, 100.5, 102); // TP2 hit, trade closes

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 30) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: 30,
          entry: 100,
          entryZone: { low: 99.9, high: 100.1 },
          stopLoss: 99,
          takeProfit1: 101,
          takeProfit2: 102,
          confidence: 85,
          grade: "A",
          score: 85,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");

    expect(result.signals).toBe(1);
    expect(result.overall.trades).toBe(1);
    expect(result.trades[0]?.outcome).toBe("tp2");
    expect(result.trades[0]?.exitIndex).toBe(32);
    // Net RR with fees applied
    expect(result.trades[0]?.realizedRiskReward).toBeCloseTo(1.26, 0.2);
  });

  test("fee-d: TP2 exit with default fees applied", () => {
    // Same fixture as partial-exit-c but verifies fees are applied
    // Gross RR = 0.5*(101-100)/1 + 0.5*(102-100)/1 = 1.5
    // With default fees (0.12% per direction): net ~1.26
    const candles = Array.from({ length: 50 }, (_, i) =>
      candle(i + 1, 100, 100.1, 99.9, 100),
    );

    candles[30] = candle(31, 100, 100.1, 99.9, 100);
    candles[31] = candle(32, 100, 101.5, 99.9, 101); // TP1 hit
    candles[32] = candle(33, 101, 102.5, 100.5, 102); // TP2 hit

    mocks.analyzeSmcSignalsAtIndex.mockImplementation((_candles, pair, timeframe, index) => {
      if (index !== 30) return [];
      return [
        signal({
          pair,
          timeframe,
          direction: "LONG",
          triggerIndex: 30,
          entry: 100,
          entryZone: { low: 99.9, high: 100.1 },
          stopLoss: 99,
          takeProfit1: 101,
          takeProfit2: 102,
          confidence: 85,
          grade: "A",
          score: 85,
        }),
      ];
    });

    const result = runSmcBacktest(candles, "XAUTUSDT", "M15");
    expect(result.trades[0]?.outcome).toBe("tp2");

    // Verify fees are applied (net RR < gross RR of 1.5)
    expect(result.trades[0]?.realizedRiskReward).toBeLessThan(1.5);
    // Net RR should be approximately gross minus fee cost
    expect(result.trades[0]?.realizedRiskReward).toBeCloseTo(1.26, 0.2);
  });
});
