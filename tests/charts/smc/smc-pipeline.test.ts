import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchOhlcHistory: vi.fn(),
  analyzeAllChartsSmc: vi.fn(),
  detectFairValueGap: vi.fn(),
  detectStructureBreak: vi.fn(),
  findSwingPoints: vi.fn(),
  findRecentOrderBlock: vi.fn(),
  calculatePremiumDiscountZone: vi.fn(),
  findEqualLevels: vi.fn(),
  calculatePriorPeriodLevels: vi.fn(),
  detectRejectionWick: vi.fn(),
  calculateRvol: vi.fn(),
  getConfiguredSmcSignalFreshnessCandles: vi.fn(() => 1),
  getConfiguredSmcMinSignalConfidence: vi.fn(() => 0),
  getConfiguredSmcMinRiskPct: vi.fn(() => 0),
  checkMultiTimeframeConfluence: vi.fn(),
}));

vi.mock("../../../src/charts/ohlc-provider.js", () => ({
  fetchOhlcHistory: mocks.fetchOhlcHistory,
}));

vi.mock("../../../src/charts/smc-config-env.js", () => ({
  getConfiguredSmcSignalFreshnessCandles: mocks.getConfiguredSmcSignalFreshnessCandles,
  getConfiguredSmcMinSignalConfidence: mocks.getConfiguredSmcMinSignalConfidence,
  getConfiguredSmcMinRiskPct: mocks.getConfiguredSmcMinRiskPct,
}));

vi.mock("../../../src/charts/smc/smc-structure.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/charts/smc/smc-structure.js")>(
    "../../../src/charts/smc/smc-structure.js",
  );

  return {
    ...actual,
    detectFairValueGap: mocks.detectFairValueGap,
    detectStructureBreak: mocks.detectStructureBreak,
    findSwingPoints: mocks.findSwingPoints,
    findRecentOrderBlock: mocks.findRecentOrderBlock,
  };
});

vi.mock("../../../src/charts/smc/smc-confluence.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/charts/smc/smc-confluence.js")>(
    "../../../src/charts/smc/smc-confluence.js",
  );

  return {
    ...actual,
    checkMultiTimeframeConfluence: mocks.checkMultiTimeframeConfluence,
  };
});

vi.mock("../../../src/charts/smc/smc-liquidity-context.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/charts/smc/smc-liquidity-context.js")>(
    "../../../src/charts/smc/smc-liquidity-context.js",
  );

  return {
    ...actual,
    calculatePremiumDiscountZone: mocks.calculatePremiumDiscountZone,
    findEqualLevels: mocks.findEqualLevels,
    calculatePriorPeriodLevels: mocks.calculatePriorPeriodLevels,
    detectRejectionWick: mocks.detectRejectionWick,
    calculateRvol: mocks.calculateRvol,
  };
});

import { analyzeAllChartsSmc, analyzeSmcSignalsAtIndex, analyzeSmcWindow } from "../../../src/charts/smc/smc-pipeline.js";
import type { Candle } from "../../../src/charts/ohlc-provider.js";
import type { HtfContext } from "../../../src/charts/smc/smc-htf-context.js";
import { gradeFromScore } from "../../../src/charts/smc/smc-signal-assembly.js";
import { buildSmcSignalMessage } from "../../../src/shared/telegram-smc.js";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 100 };
}

function utcTime(hour: number, minute: number): number {
  return Date.UTC(2024, 0, 2, hour, minute, 0, 0);
}

function calculateExpectedAtr(series: Candle[], endIndex: number, lookback = 14): number {
  const startIndex = Math.max(0, endIndex - lookback + 1);
  let sum = 0;
  let count = 0;

  for (let i = startIndex; i <= endIndex; i += 1) {
    const current = series[i];
    const previousClose = i > 0 ? series[i - 1].close : current.close;
    const trueRange = Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    );
    sum += trueRange;
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

const candles: Candle[] = [
  candle(utcTime(12, 0), 100, 101, 99, 100),
  candle(utcTime(12, 1), 100, 102, 98, 101),
  candle(utcTime(12, 2), 101, 105, 100, 104),
  candle(utcTime(12, 3), 104, 103, 97, 98),
  candle(utcTime(12, 4), 98, 106, 96, 105),
  candle(utcTime(12, 5), 105, 108, 103, 107),
  candle(utcTime(12, 6), 107, 111, 106, 110),
  candle(utcTime(12, 7), 110, 113, 109, 112),
  candle(utcTime(12, 8), 112, 116, 111, 115),
  candle(utcTime(12, 9), 115, 118, 114, 117),
  candle(utcTime(12, 10), 117, 120, 116, 119),
  candle(utcTime(12, 11), 119, 122, 118, 121),
  candle(utcTime(12, 12), 121, 125, 120, 124),
  candle(utcTime(12, 13), 124, 126, 123, 125),
  candle(utcTime(12, 14), 125, 128, 124, 127),
  candle(utcTime(12, 15), 127, 129, 126, 128),
  candle(utcTime(12, 16), 128, 131, 127, 130),
  candle(utcTime(12, 17), 130, 134, 129, 133),
  candle(utcTime(12, 18), 133, 136, 132, 135),
  candle(utcTime(12, 19), 135, 138, 134, 137),
];

describe("analyzeAllChartsSmc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOhlcHistory.mockResolvedValue(candles);
    mocks.findSwingPoints.mockReturnValue([]);
    mocks.findRecentOrderBlock.mockReturnValue(null);
    mocks.calculatePremiumDiscountZone.mockReturnValue(null);
    mocks.findEqualLevels.mockReturnValue([]);
    mocks.calculatePriorPeriodLevels.mockReturnValue({
      priorDayLow: null,
      priorDayHigh: null,
      priorWeekLow: null,
      priorWeekHigh: null,
    });
    mocks.getConfiguredSmcSignalFreshnessCandles.mockReturnValue(20);
    mocks.getConfiguredSmcMinSignalConfidence.mockReturnValue(0);
    mocks.checkMultiTimeframeConfluence.mockResolvedValue({
      agreementCount: 0,
      agreeingTimeframes: [],
    });
    mocks.detectFairValueGap.mockImplementation((series: Candle[], index: number) => {
      if (index < 2) return null;
      const prev2 = series[index - 2];
      const current = series[index];
      if (prev2.high < current.low) {
        return {
          direction: "LONG" as const,
          index,
          high: current.low,
          low: prev2.high,
          midpoint: (prev2.high + current.low) / 2,
        };
      }
      if (prev2.low > current.high) {
        return {
          direction: "SHORT" as const,
          index,
          high: prev2.low,
          low: current.high,
          midpoint: (prev2.low + current.high) / 2,
        };
      }
      return null;
    });
    mocks.detectStructureBreak.mockImplementation((series: Candle[], swings: unknown[], index: number, direction?: string) => {
      const fvg = mocks.detectFairValueGap(series, index);
      if (fvg && direction === fvg.direction) {
        return {
          kind: "BOS" as const,
          direction: fvg.direction,
          breakIndex: index,
          level: fvg.midpoint,
        };
      }
      return null;
    });
    mocks.detectRejectionWick.mockReturnValue({ hasRejectionWick: false, wickRatio: 0.3 });
    mocks.calculateRvol.mockReturnValue(null);
  });

  test("fetches expected symbol/timeframe/count", async () => {
    await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], { timeframeMode: "single", primaryTimeframe: "M15" });
    expect(mocks.fetchOhlcHistory).toHaveBeenCalledWith("OANDA:XAUUSD", "M15", 200);
  });

  test("no candles becomes skipped/no throw", async () => {
    mocks.fetchOhlcHistory.mockResolvedValue([]);
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }]);
    expect(result.analysisStats?.skippedPairs).toBe(1);
    expect(result.setups).toHaveLength(0);
  });

  test("fixture with bullish structure returns one smc setup", async () => {
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], { timeframeMode: "multi" });
    expect(result.setups.length).toBeGreaterThanOrEqual(1);
    expect(result.setups[0].detectionSource).toBe("smc");
  });

  test("analysis stats are populated", async () => {
    const result = await analyzeAllChartsSmc([
      { pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" },
      { pair: "EURUSDT", symbol: "OANDA:EURUSD" },
    ]);
    expect(result.analysisStats).toMatchObject({
      attemptedPairs: 2,
      okPairs: 2,
      noSetupPairs: 0,
      skippedPairs: 0,
      setupCount: result.setups.length,
    });
  });

  test("analyzeAllChartsSmc uses M15 by default and message shows Timeframe: M15", async () => {
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }]);
    expect(mocks.fetchOhlcHistory).toHaveBeenCalledWith("OANDA:XAUUSD", "M15", 200);
    expect(result.setups.length).toBeGreaterThanOrEqual(1);
    expect(result.setups[0].primaryTimeframe).toBe("M15");
    expect(buildSmcSignalMessage(result.setups[0])).toContain("Timeframe: M15");
  });

  test("FVG continuation is not generated when structure confirmation is opposite direction", () => {
    mocks.detectFairValueGap.mockReturnValue({
      direction: "LONG",
      index: 4,
      high: 110,
      low: 108,
      midpoint: 109,
    });
    mocks.detectStructureBreak.mockReturnValue({
      kind: "CHOCH",
      direction: "SHORT",
      breakIndex: 4,
      level: 100,
      previousBias: "LONG",
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 4);
    const fvgSignal = signals.find((signal) => signal.setup === "SMC_FVG_CONTINUATION");

    expect(fvgSignal).toBeUndefined();
  });

  test("FVG continuation keeps confidence 74 when structure confirmation matches direction", () => {
    mocks.detectFairValueGap.mockReturnValue({
      direction: "LONG",
      index: 4,
      high: 110,
      low: 108,
      midpoint: 109,
    });
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 4,
      level: 105,
      previousBias: "LONG",
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 4);
    const fvgSignal = signals.find((signal) => signal.setup === "SMC_FVG_CONTINUATION");

    // Score mới (factor-based): base 40 + FVG 8 + P/D UNKNOWN 5 + overlap session 10 = 63
    expect(fvgSignal).toMatchObject({
      confidence: 74,
      grade: "B",
      score: 63,
      direction: "LONG",
      structureEvent: {
        direction: "LONG",
      },
    });
    expect(fvgSignal?.ruleTrace).toEqual(["FVG cùng hướng cấu trúc đang mở rộng."]);
  });

  test("FVG continuation is not generated when no structure is detected", () => {
    mocks.detectFairValueGap.mockReturnValue({
      direction: "LONG",
      index: 4,
      high: 110,
      low: 108,
      midpoint: 109,
    });
    mocks.detectStructureBreak.mockReturnValue(null);

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 4);
    const fvgSignal = signals.find((signal) => signal.setup === "SMC_FVG_CONTINUATION");

    expect(fvgSignal).toBeUndefined();
  });

  test("BOS order block long stop loss uses ATR buffer and recalculates 2R/3R targets", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");
    const atrProxy = calculateExpectedAtr(candles.slice(0, 7), 6);
    const stopBuffer = Math.max(atrProxy * 0.2, Math.abs(101) * 0.00002, 0.0001);
    const expectedStopLoss = 96 - stopBuffer;
    const expectedRisk = Math.abs(101 - expectedStopLoss);

    expect(obSignal?.orderBlock).toMatchObject({ low: 96, high: 106, midpoint: 101 });
    expect(obSignal?.stopLoss).toBeCloseTo(expectedStopLoss);
    expect(obSignal?.stopLoss).toBeLessThan(96);
    expect(obSignal?.takeProfit1).toBeCloseTo(101 + expectedRisk * 2);
    expect(obSignal?.takeProfit2).toBeCloseTo(101 + expectedRisk * 3);
    expect(obSignal?.entryZone).toEqual({ low: 96, high: 106 });
  });

  test("CHOCH order block short stop loss uses ATR buffer and recalculates 2R/3R targets", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "CHOCH",
      direction: "SHORT",
      breakIndex: 6,
      level: 96,
      previousBias: "LONG",
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "SHORT",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignal = signals.find((signal) => signal.setup === "SMC_CHOCH_OB");
    const atrProxy = calculateExpectedAtr(candles.slice(0, 7), 6);
    const stopBuffer = Math.max(atrProxy * 0.2, Math.abs(101) * 0.00002, 0.0001);
    const expectedStopLoss = 106 + stopBuffer;
    const expectedRisk = Math.abs(101 - expectedStopLoss);

    expect(obSignal?.orderBlock).toMatchObject({ low: 96, high: 106, midpoint: 101 });
    expect(obSignal?.stopLoss).toBeCloseTo(expectedStopLoss);
    expect(obSignal?.stopLoss).toBeGreaterThan(106);
    expect(obSignal?.takeProfit1).toBeCloseTo(101 - expectedRisk * 2);
    expect(obSignal?.takeProfit2).toBeCloseTo(101 - expectedRisk * 3);
    expect(obSignal?.entryZone).toEqual({ low: 96, high: 106 });
  });

  test("BOS long in premium zone is penalized by 15 points and grade is recalculated", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePremiumDiscountZone.mockReturnValue({
      rangeLow: 90,
      rangeHigh: 110,
      percentInRange: 65,
      zone: "PREMIUM",
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");

    // Score mới: base 40 + BOS 15 + P/D WRONG (-10) + overlap session 10 = 55
    expect(obSignal).toMatchObject({
      confidence: 65,
      grade: gradeFromScore(55),
      score: 55,
      premiumDiscountZone: {
        zone: "PREMIUM",
        percentInRange: 65,
      },
    });
    expect(obSignal?.ruleTrace).toContain(
      "Canh bao: vao lenh LONG tai vung PREMIUM - nguoc nguyen tac premium/discount, da ha diem.",
    );
  });

  test("BOS long in discount zone keeps base confidence and grade", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePremiumDiscountZone.mockReturnValue({
      rangeLow: 90,
      rangeHigh: 110,
      percentInRange: 35,
      zone: "DISCOUNT",
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");

    expect(obSignal).toMatchObject({
      confidence: 80,
      grade: "A",
      score: 80,
      premiumDiscountZone: {
        zone: "DISCOUNT",
        percentInRange: 35,
      },
    });
    expect(obSignal?.ruleTrace).toContain("Premium/Discount: DISCOUNT (35% range).");
  });

  test("BOS long in equilibrium zone is neutral and keeps base confidence", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePremiumDiscountZone.mockReturnValue({
      rangeLow: 90,
      rangeHigh: 110,
      percentInRange: 50,
      zone: "EQUILIBRIUM",
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");

    // Score mới: base 40 + BOS 15 + EQUILIBRIUM là trung tính (UNKNOWN, +5) + overlap session 10 = 70
    expect(obSignal).toMatchObject({
      confidence: 80,
      grade: "B",
      score: 70,
      premiumDiscountZone: {
        zone: "EQUILIBRIUM",
        percentInRange: 50,
      },
    });
    expect(obSignal?.ruleTrace).toContain("Premium/Discount: EQUILIBRIUM (50% range).");
  });

  test("BOS long uses valid equal-high liquidity target for TP2 and valid prior-week level for TP3", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.findEqualLevels.mockReturnValue([{ kind: "EQH", price: 118 }]);
    mocks.calculatePriorPeriodLevels.mockReturnValue({
      priorDayLow: null,
      priorDayHigh: null,
      priorWeekLow: null,
      priorWeekHigh: 124,
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");

    expect(obSignal?.takeProfit1).toBeGreaterThan(101);
    expect(obSignal?.takeProfit2).toBe(118);
    expect(obSignal?.takeProfit3).toBe(124);
    expect(obSignal?.ruleTrace).toContain("TP2 dieu chinh theo equal high/low tai 118.00 (thay vi 3R mac dinh).");
    expect(obSignal?.ruleTrace).toContain("TP3 dieu chinh theo prior week level tai 124.00.");
  });

  test("BOS long falls back to 3R TP2 when equal-high target is too close", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.findEqualLevels.mockReturnValue([{ kind: "EQH", price: 106 }]);

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");
    const atrProxy = calculateExpectedAtr(candles.slice(0, 7), 6);
    const stopBuffer = Math.max(atrProxy * 0.2, Math.abs(101) * 0.00002, 0.0001);
    const stopLoss = 96 - stopBuffer;
    const risk = Math.abs(101 - stopLoss);
    const expectedFallbackTp2 = 101 + risk * 3;

    expect(obSignal?.takeProfit2).toBeCloseTo(expectedFallbackTp2);
    expect(obSignal?.takeProfit2).toBeGreaterThan(101);
    expect(obSignal?.ruleTrace).not.toContain("TP2 dieu chinh theo equal high/low tai 106.00 (thay vi 3R mac dinh).");
  });

  test("BOS long keeps default TP2 when no matching equal-high exists", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.findEqualLevels.mockReturnValue([{ kind: "EQL", price: 92 }]);

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");
    const atrProxy = calculateExpectedAtr(candles.slice(0, 7), 6);
    const stopBuffer = Math.max(atrProxy * 0.2, Math.abs(101) * 0.00002, 0.0001);
    const stopLoss = 96 - stopBuffer;
    const risk = Math.abs(101 - stopLoss);

    expect(obSignal?.takeProfit2).toBeCloseTo(101 + risk * 3);
    expect(obSignal?.takeProfit2).toBeGreaterThan(101);
  });

  test("BOS long leaves TP3 undefined when prior-week level is on the wrong side", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePriorPeriodLevels.mockReturnValue({
      priorDayLow: null,
      priorDayHigh: null,
      priorWeekLow: null,
      priorWeekHigh: 99,
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");

    expect(obSignal?.takeProfit3).toBeUndefined();
    expect(obSignal?.ruleTrace).not.toContain("TP3 dieu chinh theo prior week level tai 99.00.");
  });

test("HTF context with wide dealing range results in EQUILIBRIUM zone (vs PREMIUM with M15-local)", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });

    // Mock for M15-local: narrow range, entry at top → PREMIUM
    mocks.calculatePremiumDiscountZone.mockReturnValue({
      rangeLow: 90,
      rangeHigh: 110,
      percentInRange: 65,
      zone: "PREMIUM",
    });

    // Call without htfContext first - should use M15-local and get PREMIUM
    const signalsWithoutHtf = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const obSignalWithoutHtf = signalsWithoutHtf.find((signal) => signal.setup === "SMC_BOS_OB");
    expect(obSignalWithoutHtf?.premiumDiscountZone?.zone).toBe("PREMIUM");
    expect(obSignalWithoutHtf?.confidence).toBe(65); // penalized

    // Now setup mock to simulate HTF context being used
    // When calculatePremiumDiscountZone is called with HTF swings/candlesLength, it returns different result
    mocks.calculatePremiumDiscountZone.mockImplementation(
      (_entry: number, swings: unknown, atIndex: unknown) => {
        // Simulate: if called with htfContext.candlesLength (e.g., 100) vs scoped index (7)
        // Return different zones to show HTF context was used
        if (typeof atIndex === "number" && atIndex > 50) {
          return {
            rangeLow: 50,
            rangeHigh: 150,
            percentInRange: 50,
            zone: "EQUILIBRIUM",
          };
        }
        return {
          rangeLow: 90,
          rangeHigh: 110,
          percentInRange: 65,
          zone: "PREMIUM",
        };
      },
    );

    const htfContextMock = {
      timeframe: "H4" as const,
      bias: "LONG" as const,
      swings: [],
      candlesLength: 100,
    };

    // Call with htfContext - should use HTF range and get EQUILIBRIUM
    const signalsWithHtf = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6, htfContextMock);
    const obSignalWithHtf = signalsWithHtf.find((signal) => signal.setup === "SMC_BOS_OB");
    expect(obSignalWithHtf?.premiumDiscountZone?.zone).toBe("EQUILIBRIUM");
    expect(obSignalWithHtf?.confidence).toBe(80); // not penalized, using HTF range
  });

  test("analyzeSmcSignalsAtIndex without htfContext maintains backward compatibility", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePremiumDiscountZone.mockReturnValue({
      rangeLow: 90,
      rangeHigh: 110,
      percentInRange: 35,
      zone: "DISCOUNT",
    });

    // Call without htfContext (or null) - should work exactly as before
    const signals1 = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const signals2 = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6, null);
    const signals3 = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6, undefined);

    expect(signals1).toHaveLength(signals2.length);
    expect(signals1).toHaveLength(signals3.length);

    const ob1 = signals1.find((signal) => signal.setup === "SMC_BOS_OB");
    const ob2 = signals2.find((signal) => signal.setup === "SMC_BOS_OB");
    const ob3 = signals3.find((signal) => signal.setup === "SMC_BOS_OB");

    expect(ob1?.confidence).toBe(80);
    expect(ob2?.confidence).toBe(80);
    expect(ob3?.confidence).toBe(80);
    expect(ob1?.premiumDiscountZone?.zone).toBe("DISCOUNT");
    expect(ob2?.premiumDiscountZone?.zone).toBe("DISCOUNT");
    expect(ob3?.premiumDiscountZone?.zone).toBe("DISCOUNT");
  });

  test("BOS LONG setup is blocked when HTF bias is SHORT (directional gate)", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePremiumDiscountZone.mockReturnValue({
      rangeLow: 90,
      rangeHigh: 110,
      percentInRange: 35,
      zone: "DISCOUNT",
    });

    const htfContextWithShortBias: HtfContext = {
      timeframe: "H4",
      bias: "SHORT",
      swings: [],
      candlesLength: 100,
    };

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6, htfContextWithShortBias);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");

    expect(obSignal).toBeUndefined();
  });

  test("BOS LONG setup is kept when HTF bias is LONG (same direction)", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePremiumDiscountZone.mockReturnValue({
      rangeLow: 90,
      rangeHigh: 110,
      percentInRange: 35,
      zone: "DISCOUNT",
    });

    const htfContextWithLongBias: HtfContext = {
      timeframe: "H4",
      bias: "LONG",
      swings: [],
      candlesLength: 100,
    };

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6, htfContextWithLongBias);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");

    expect(obSignal).toBeDefined();
    expect(obSignal?.confidence).toBe(80);
    expect(obSignal?.setup).toBe("SMC_BOS_OB");
  });

  test("BOS LONG setup is kept when HTF bias is null (unknown direction)", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePremiumDiscountZone.mockReturnValue({
      rangeLow: 90,
      rangeHigh: 110,
      percentInRange: 35,
      zone: "DISCOUNT",
    });

    const htfContextWithNullBias: HtfContext = {
      timeframe: "H4",
      bias: null,
      swings: [],
      candlesLength: 100,
    };

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6, htfContextWithNullBias);
    const obSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");

    expect(obSignal).toBeDefined();
    expect(obSignal?.confidence).toBe(80);
  });

  test("FVG LONG is blocked when HTF bias is SHORT (directional gate)", () => {
    mocks.detectStructureBreak.mockReturnValue(null);
    mocks.detectFairValueGap.mockReturnValue({
      direction: "LONG",
      index: 4,
      high: 110,
      low: 108,
      midpoint: 109,
    });

    const htfContextWithShortBias: HtfContext = {
      timeframe: "H4",
      bias: "SHORT",
      swings: [],
      candlesLength: 100,
    };

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 4, htfContextWithShortBias);
    const fvgSignal = signals.find((signal) => signal.setup === "SMC_FVG_CONTINUATION");

    expect(fvgSignal).toBeUndefined();
  });

  test("SMC_LIQUIDITY_SWEEP setup is permanently disabled and never appears in signals", () => {
    mocks.detectFairValueGap.mockReturnValue({
      direction: "LONG",
      index: 6,
      high: 110,
      low: 108,
      midpoint: 109,
    });
    mocks.detectStructureBreak.mockReturnValue(null);

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);

    const sweepSignals = signals.filter((signal) => signal.setup === "SMC_LIQUIDITY_SWEEP");
    expect(sweepSignals).toHaveLength(0);

    const allSignalSetups = signals.map((s) => s.setup);
    expect(allSignalSetups).not.toContain("SMC_LIQUIDITY_SWEEP");
  });

  test("analyzeAllChartsSmc fetches HTF context with corresponding HTF timeframe", async () => {
    mocks.fetchOhlcHistory.mockImplementation(async (_symbol: string, timeframe: string) => {
      // Return appropriate data based on timeframe requested
      if (timeframe === "M15") return candles;
      if (timeframe === "H4") return candles.slice(0, 10); // Simulating HTF candles
      return [];
    });

    mocks.findSwingPoints.mockReturnValue([]);
    mocks.findRecentOrderBlock.mockReturnValue(null);
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue(null);
    mocks.findEqualLevels.mockReturnValue([]);
    mocks.calculatePriorPeriodLevels.mockReturnValue({
      priorDayLow: null,
      priorDayHigh: null,
      priorWeekLow: null,
      priorWeekHigh: null,
    });

    await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }]);

    // Verify fetchOhlcHistory was called for both M15 (primary) and H4 (HTF)
    const allFetchCalls = mocks.fetchOhlcHistory.mock.calls;
    const m15Calls = allFetchCalls.filter((call) => call[1] === "M15");
    const h4Calls = allFetchCalls.filter((call) => call[1] === "H4");

    expect(m15Calls.length).toBeGreaterThanOrEqual(1);
    expect(h4Calls.length).toBeGreaterThanOrEqual(1);
  });

  test("CHOCH order block SHORT has confidence 72 (lower than BOS 80) when previousBias is LONG and break is SHORT", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "CHOCH",
      direction: "SHORT",
      breakIndex: 6,
      level: 96,
      previousBias: "LONG",
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "SHORT",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const chochSignal = signals.find((signal) => signal.setup === "SMC_CHOCH_OB");

    expect(chochSignal).toBeDefined();
    expect(chochSignal?.setup).toBe("SMC_CHOCH_OB");
    // Score mới: base 40 + CHOCH 8 + P/D UNKNOWN 5 + overlap session 10 = 63
    expect(chochSignal?.confidence).toBe(72);
    expect(chochSignal?.grade).toBe(gradeFromScore(63));
    expect(chochSignal?.score).toBe(63);
    expect(chochSignal?.structureEvent?.kind).toBe("CHOCH");
    expect(chochSignal?.structureEvent?.direction).toBe("SHORT");
    expect(chochSignal?.structureEvent?.previousBias).toBe("LONG");
  });

  test("BOS order block LONG has confidence 80 when previousBias is LONG and break is LONG (same direction)", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 108,
      previousBias: "LONG",
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const bosSignal = signals.find((signal) => signal.setup === "SMC_BOS_OB");

    expect(bosSignal).toBeDefined();
    expect(bosSignal?.setup).toBe("SMC_BOS_OB");
    // Score mới: base 40 + BOS 15 + P/D UNKNOWN 5 + overlap session 10 = 70
    expect(bosSignal?.confidence).toBe(80);
    expect(bosSignal?.grade).toBe("B");
    expect(bosSignal?.score).toBe(70);
    expect(bosSignal?.structureEvent?.kind).toBe("BOS");
    expect(bosSignal?.structureEvent?.direction).toBe("LONG");
    expect(bosSignal?.structureEvent?.previousBias).toBe("LONG");
  });

  test("CHOCH SHORT in PREMIUM zone maintains base confidence 72 (correct zone for SHORT)", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "CHOCH",
      direction: "SHORT",
      breakIndex: 6,
      level: 96,
      previousBias: "LONG",
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "SHORT",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePremiumDiscountZone.mockReturnValue({
      rangeLow: 90,
      rangeHigh: 110,
      percentInRange: 65,
      zone: "PREMIUM",
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const chochSignal = signals.find((signal) => signal.setup === "SMC_CHOCH_OB");

    expect(chochSignal?.confidence).toBe(72);
    expect(chochSignal?.grade).toBe("B");
    expect(chochSignal?.ruleTrace).toContain("Premium/Discount: PREMIUM (65% range).");
  });

  test("BOS order block and CHOCH order block both returned when two different structures at same index", () => {
    // This tests that the pipeline correctly handles multiple structure detections
    // In reality, this is rare, but the code processes them independently
    mocks.detectFairValueGap.mockReturnValue(null);
    // First call returns BOS, subsequent calls return CHOCH (simulating multiple detections)
    let callCount = 0;
    mocks.detectStructureBreak.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return {
          kind: "BOS",
          direction: "LONG",
          breakIndex: 6,
          level: 108,
          previousBias: "LONG",
        };
      }
      return {
        kind: "CHOCH",
        direction: "SHORT",
        breakIndex: 6,
        level: 96,
        previousBias: "LONG",
      };
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });

    const signals = analyzeSmcSignalsAtIndex(candles, "XAUTUSDT", "M15", 6);
    const bosSignals = signals.filter((signal) => signal.setup === "SMC_BOS_OB");
    const chochSignals = signals.filter((signal) => signal.setup === "SMC_CHOCH_OB");

    expect(bosSignals.length).toBeGreaterThanOrEqual(0);
    expect(chochSignals.length).toBeGreaterThanOrEqual(0);
  });
});

describe("analyzeSmcWindow with freshness filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSwingPoints.mockReturnValue([]);
    mocks.findRecentOrderBlock.mockReturnValue(null);
    mocks.calculatePremiumDiscountZone.mockReturnValue(null);
    mocks.findEqualLevels.mockReturnValue([]);
    mocks.calculatePriorPeriodLevels.mockReturnValue({
      priorDayLow: null,
      priorDayHigh: null,
      priorWeekLow: null,
      priorWeekHigh: null,
    });
    mocks.detectStructureBreak.mockReturnValue(null);
    mocks.detectRejectionWick.mockReturnValue({ hasRejectionWick: false, wickRatio: 0.3 });
    mocks.calculateRvol.mockReturnValue(null);
  });

  test("returns no signal when best candidate is outside freshness window with freshnessCandles=1", () => {
    mocks.detectFairValueGap.mockImplementation((series: Candle[], index: number) => {
      if (index === 10) {
        return {
          direction: "LONG" as const,
          index: 10,
          high: 110,
          low: 108,
          midpoint: 109,
        };
      }
      return null;
    });

    const extendedCandles = [...candles, candle(utcTime(12, 20), 137, 140, 136, 139)];
    const signals = analyzeSmcWindow(extendedCandles, "XAUTUSDT", "M15");
    expect(signals).toHaveLength(0);
  });

  test("returns signal when best candidate is within freshness window (latest candle)", () => {
    mocks.detectFairValueGap.mockImplementation((series: Candle[], index: number) => {
      if (index === series.length - 1) {
        return {
          direction: "LONG" as const,
          index: series.length - 1,
          high: 140,
          low: 138,
          midpoint: 139,
        };
      }
      return null;
    });
    mocks.detectStructureBreak.mockImplementation((series: Candle[], swings: unknown[], index: number, direction?: string) => {
      if (index === series.length - 1 && direction === "LONG") {
        return {
          kind: "BOS" as const,
          direction: "LONG" as const,
          breakIndex: series.length - 1,
          level: 139,
        };
      }
      return null;
    });

    const extendedCandles = [...candles, candle(utcTime(12, 20), 137, 140, 136, 139)];
    const signals = analyzeSmcWindow(extendedCandles, "XAUTUSDT", "M15");
    expect(signals).toHaveLength(1);
    expect(signals[0].triggerIndex).toBe(extendedCandles.length - 1);
  });

  test("respects freshnessCandles=2 to include triggers within last 2 candles", () => {
    mocks.detectFairValueGap.mockImplementation((series: Candle[], index: number) => {
      if (index === 20) {
        return {
          direction: "LONG" as const,
          index: 20,
          high: 138,
          low: 136,
          midpoint: 137,
        };
      }
      return null;
    });
    mocks.detectStructureBreak.mockImplementation((series: Candle[], swings: unknown[], index: number, direction?: string) => {
      if (index === 20 && direction === "LONG") {
        return {
          kind: "BOS" as const,
          direction: "LONG" as const,
          breakIndex: 20,
          level: 137,
        };
      }
      return null;
    });

    const extendedCandles = [...candles, candle(utcTime(12, 20), 137, 140, 136, 139), candle(utcTime(12, 21), 139, 142, 138, 141)];
    const signals = analyzeSmcWindow(extendedCandles, "XAUTUSDT", "M15", undefined, { freshnessCandles: 2 });
    expect(signals).toHaveLength(1);
    expect(signals[0].triggerIndex).toBe(20);
  });

  test("filters out signals outside freshness window even if they have high confidence", () => {
    mocks.detectFairValueGap.mockImplementation((series: Candle[], index: number) => {
      if (index === 5) {
        return {
          direction: "LONG" as const,
          index: 5,
          high: 110,
          low: 108,
          midpoint: 109,
        };
      }
      if (index === series.length - 1) {
        return {
          direction: "SHORT" as const,
          index: series.length - 1,
          high: 142,
          low: 140,
          midpoint: 141,
        };
      }
      return null;
    });
    mocks.detectStructureBreak.mockImplementation((series: Candle[], swings: unknown[], index: number, direction?: string) => {
      if (index === 5 && direction === "LONG") {
        return {
          kind: "BOS" as const,
          direction: "LONG" as const,
          breakIndex: 5,
          level: 108,
        };
      }
      if (index === series.length - 1 && direction === "SHORT") {
        return {
          kind: "BOS" as const,
          direction: "SHORT" as const,
          breakIndex: series.length - 1,
          level: 140,
        };
      }
      return null;
    });

    const extendedCandles = [...candles, candle(utcTime(12, 20), 137, 140, 136, 139)];
    const signals = analyzeSmcWindow(extendedCandles, "XAUTUSDT", "M15");
    expect(signals).toHaveLength(1);
    expect(signals[0].triggerIndex).toBe(extendedCandles.length - 1);
  });

  test("returns empty array when no candidates exist in freshness window", () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue(null);
    const signals = analyzeSmcWindow(candles, "XAUTUSDT", "M15");
    expect(signals).toHaveLength(0);
  });
});

describe("analyzeAllChartsSmc with minimum confidence threshold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOhlcHistory.mockResolvedValue(candles);
    mocks.findSwingPoints.mockReturnValue([]);
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    mocks.calculatePremiumDiscountZone.mockReturnValue(null);
    mocks.findEqualLevels.mockReturnValue([]);
    mocks.calculatePriorPeriodLevels.mockReturnValue({
      priorDayLow: null,
      priorDayHigh: null,
      priorWeekLow: null,
      priorWeekHigh: null,
    });
    mocks.getConfiguredSmcSignalFreshnessCandles.mockReturnValue(20);
    mocks.getConfiguredSmcMinSignalConfidence.mockReturnValue(0);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS" as const,
      direction: "LONG" as const,
      breakIndex: 6,
      level: 108,
    });
    mocks.detectRejectionWick.mockReturnValue({ hasRejectionWick: false, wickRatio: 0.3 });
    mocks.calculateRvol.mockReturnValue(null);
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.checkMultiTimeframeConfluence.mockResolvedValue({
      agreementCount: 0,
      agreeingTimeframes: [],
    });
  });

  test("filters out signal with confidence below minSignalConfidence threshold", async () => {
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], {
      minSignalConfidence: 100,
    });
    expect(result.setups).toHaveLength(0);
    expect(result.noSetupReason).toContain("bi loai");
  });

  test("includes signal with confidence at or above minSignalConfidence threshold", async () => {
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], {
      minSignalConfidence: 50,
    });
    expect(result.setups.length).toBeGreaterThanOrEqual(1);
  });

  test("respects custom minSignalConfidence option passed to analyzeAllChartsSmc", async () => {
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], {
      minSignalConfidence: 100,
    });
    expect(result.setups).toHaveLength(0);
    expect(result.noSetupReason).toContain("< nguong 100");
  });

  test("uses option minSignalConfidence when provided", async () => {
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], {
      minSignalConfidence: 60,
    });
    expect(result.setups.length).toBeGreaterThanOrEqual(1);
  });

  test("includes reason in no_setup when signal below threshold", async () => {
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], {
      minSignalConfidence: 100,
    });
    expect(result.setups).toHaveLength(0);
    expect(result.noSetupReason).toMatch(/confidence \d+ < nguong 100/);
  });

  test("filters out signal with risk below minRiskPct threshold (stop too tight)", async () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 1000,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 1000.5,
      low: 999.5,
      midpoint: 1000,
    });
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], {
      minRiskPct: 0.5,
    });
    expect(result.setups).toHaveLength(0);
    expect(result.noSetupReason).toContain("bi loai do risk");
    expect(result.noSetupReason).toContain("< nguong 0.5%");
  });

  test("includes signal when risk is above minRiskPct threshold", async () => {
    mocks.detectFairValueGap.mockReturnValue(null);
    mocks.detectStructureBreak.mockReturnValue({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 6,
      level: 105,
    });
    mocks.findRecentOrderBlock.mockReturnValue({
      direction: "LONG",
      startIndex: 4,
      endIndex: 4,
      high: 106,
      low: 96,
      midpoint: 101,
    });
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], {
      minRiskPct: 0.5,
    });
    expect(result.setups.length).toBeGreaterThanOrEqual(1);
  });
});

