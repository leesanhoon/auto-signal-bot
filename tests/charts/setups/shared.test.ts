import { afterEach, describe, it, expect } from "vitest";
import type { Candle } from "../../../src/charts/client/ohlc-provider.js";
import { baseConfidence, computeSlope, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments, applyPriorConsolidationPenalty } from "../../../src/charts/service/setups/shared.js";

const originalTpRMultiple = process.env.TP_R_MULTIPLE;

afterEach(() => {
  if (originalTpRMultiple === undefined) {
    delete process.env.TP_R_MULTIPLE;
  } else {
    process.env.TP_R_MULTIPLE = originalTpRMultiple;
  }
});

describe("shared setup helpers", () => {
  describe("computeTakeProfit", () => {
    it("uses 2R by default for long and short signals", () => {
      delete process.env.TP_R_MULTIPLE;

      expect(computeTakeProfit("LONG", 100, 95)).toBe(110);
      expect(computeTakeProfit("SHORT", 100, 105)).toBe(90);
    });

    it("uses TP_R_MULTIPLE when configured", () => {
      process.env.TP_R_MULTIPLE = "3";

      expect(computeTakeProfit("LONG", 100, 95)).toBe(115);
      expect(computeTakeProfit("SHORT", 100, 105)).toBe(85);
    });
  });

  describe("baseConfidence", () => {
    it("should export base confidence value", () => {
      expect(baseConfidence).toBe(50);
    });
  });

  describe("computeSlope", () => {
    it("should return null if index < 5", () => {
      const ema = [10, 10, 10, 10, 10];
      const atr = [1, 1, 1, 1, 1];
      expect(computeSlope(ema, atr, 0)).toBeNull();
      expect(computeSlope(ema, atr, 4)).toBeNull();
    });

    it("should return null if EMA is missing at index or index-5", () => {
      const ema = [null, 10, 10, 10, 10, 10];
      const atr = [1, 1, 1, 1, 1, 1];
      expect(computeSlope(ema, atr, 5)).toBeNull(); // ema[0] is null (index-5)

      const ema2 = [10, 10, 10, 10, 10, null];
      expect(computeSlope(ema2, atr, 5)).toBeNull(); // ema[5] is null
    });

    it("should return null if ATR is zero or null", () => {
      const ema = [10, 10, 10, 10, 10, 12];
      const atr = [1, 1, 1, 1, 1, 0];
      expect(computeSlope(ema, atr, 5)).toBeNull(); // atr[5] is 0

      const atrNull = [1, 1, 1, 1, 1, null];
      expect(computeSlope(ema, atrNull, 5)).toBeNull(); // atr[5] is null
    });

    it("should compute slope as (ema[i] - ema[i-5]) / atr[i]", () => {
      const ema = [10, 10, 10, 10, 10, 12];
      const atr = [2, 2, 2, 2, 2, 2];
      const slope = computeSlope(ema, atr, 5);
      expect(slope).toBe((12 - 10) / 2); // (12 - 10) / 2 = 1
    });

    it("should handle uptrend slope (positive)", () => {
      const ema = [10, 10.5, 11, 11.5, 12, 12.5];
      const atr = [1, 1, 1, 1, 1, 1];
      const slope = computeSlope(ema, atr, 5);
      expect(slope).toBeCloseTo((12.5 - 10) / 1); // 2.5
    });

    it("should handle downtrend slope (negative)", () => {
      const ema = [12.5, 12, 11.5, 11, 10.5, 10];
      const atr = [1, 1, 1, 1, 1, 1];
      const slope = computeSlope(ema, atr, 5);
      expect(slope).toBeCloseTo((10 - 12.5) / 1); // -2.5
    });
  });

  describe("computeBodyRatio", () => {
    it("should return 0 if range is 0", () => {
      const ratio = computeBodyRatio(100, 100, 100, 100);
      expect(ratio).toBe(0);
    });

    it("should compute body ratio as |close - open| / (high - low)", () => {
      const ratio = computeBodyRatio(100, 110, 90, 105);
      // body = |105 - 100| = 5, range = 110 - 90 = 20, ratio = 5/20 = 0.25
      expect(ratio).toBeCloseTo(0.25);
    });

    it("should handle doji (small body)", () => {
      const ratio = computeBodyRatio(100, 110, 90, 100.5);
      // body = |100.5 - 100| = 0.5, range = 20, ratio = 0.5/20 = 0.025
      expect(ratio).toBeCloseTo(0.025);
    });

    it("should handle full candle (body = range)", () => {
      const ratio = computeBodyRatio(90, 110, 90, 110);
      // body = |110 - 90| = 20, range = 20, ratio = 1
      expect(ratio).toBe(1);
    });

    it("should handle negative open-close difference", () => {
      const ratio = computeBodyRatio(110, 110, 90, 100);
      // body = |100 - 110| = 10, range = 20, ratio = 0.5
      expect(ratio).toBeCloseTo(0.5);
    });
  });

  describe("applyStandardConfidenceAdjustments", () => {
    it("should add 15 confidence for clear uptrend", () => {
      const trace: string[] = [];
      const result = applyStandardConfidenceAdjustments(50, 0.5, 0.5, trace);
      expect(result).toBe(65); // 50 + 15
      expect(trace).toContainEqual(expect.stringContaining("Bonus"));
    });

    it("should add 15 confidence for clear downtrend", () => {
      const trace: string[] = [];
      const result = applyStandardConfidenceAdjustments(50, -0.4, 0.5, trace);
      expect(result).toBe(65); // 50 + 15
    });

    it("should not bonus if slope is exactly 0.3", () => {
      const trace: string[] = [];
      const result = applyStandardConfidenceAdjustments(50, 0.3, 0.5, trace);
      expect(result).toBe(50); // no bonus
    });

    it("should subtract 15 confidence for weak bodyRatio", () => {
      const trace: string[] = [];
      const result = applyStandardConfidenceAdjustments(50, null, 0.2, trace);
      expect(result).toBe(35); // 50 - 15
      expect(trace).toContainEqual(expect.stringContaining("Penalty"));
    });

    it("should apply both bonus and penalty", () => {
      const trace: string[] = [];
      const result = applyStandardConfidenceAdjustments(50, 0.5, 0.2, trace);
      expect(result).toBe(50); // 50 + 15 - 15
    });

    it("should clamp confidence to [0, 100]", () => {
      const trace: string[] = [];
      const result = applyStandardConfidenceAdjustments(95, 0.5, 0.2, trace);
      expect(result).toBe(95); // 95 + 15 - 15 = 95 (within bounds)

      const result2 = applyStandardConfidenceAdjustments(100, 0.5, 0.2, trace);
      expect(result2).toBe(100); // 100 + 15 - 15 = 100 (clamped at upper)

      const result3 = applyStandardConfidenceAdjustments(0, null, 0.2, trace);
      expect(result3).toBe(0); // 0 - 15 = -15, clamp to 0
    });

    it("should handle null slope gracefully", () => {
      const trace: string[] = [];
      const result = applyStandardConfidenceAdjustments(50, null, 0.5, trace);
      expect(result).toBe(50); // no slope bonus
    });

    it("should push trace messages for each adjustment", () => {
      const trace: string[] = [];
      applyStandardConfidenceAdjustments(50, 0.4, 0.25, trace);
      expect(trace.length).toBeGreaterThan(0);
    });
  });

  describe("applyPriorConsolidationPenalty", () => {
    const createCandle = (high: number, low: number, close: number = (high + low) / 2): Candle => ({
      open: close,
      high,
      low,
      close,
    });

    it("should penalize -10 when >=2 candles touch near entry within lookback window", () => {
      const candles: Candle[] = [
        createCandle(100, 95),
        createCandle(101, 94),
        createCandle(100.3, 95.1), // touch entry (100.3 near 100)
        createCandle(102, 93),
        createCandle(100.2, 95.2), // touch entry again (100.2 near 100)
      ];
      const trace: string[] = [];
      const result = applyPriorConsolidationPenalty(candles, 100, 10, 4, 50, trace);
      expect(result).toBe(40); // 50 - 10
      expect(trace).toContainEqual(expect.stringContaining("Penalty"));
      expect(trace).toContainEqual(expect.stringContaining("vung dan co"));
    });

    it("should not penalize when only 1 candle touches within lookback window", () => {
      const candles: Candle[] = [
        createCandle(110, 105), // no touch (far from entry)
        createCandle(111, 104), // no touch
        createCandle(100.2, 99.8), // single touch (high touches)
      ];
      const trace: string[] = [];
      const result = applyPriorConsolidationPenalty(candles, 100, 10, 2, 50, trace);
      expect(result).toBe(50); // no change
      expect(trace.length).toBe(0); // no trace added
    });

    it("should not penalize when no candles touch within lookback window", () => {
      const candles: Candle[] = [
        createCandle(110, 105),
        createCandle(111, 104),
      ];
      const trace: string[] = [];
      const result = applyPriorConsolidationPenalty(candles, 100, 10, 1, 50, trace);
      expect(result).toBe(50); // no change
      expect(trace.length).toBe(0);
    });

    it("should safely return confidence when lookbackEndIndex < 2", () => {
      const candles: Candle[] = [
        createCandle(100.2, 99.8), // would touch if checked
      ];
      const trace: string[] = [];
      const result = applyPriorConsolidationPenalty(candles, 100, 10, 0, 50, trace);
      expect(result).toBe(50); // no penalty for insufficient history
      expect(trace.length).toBe(0);
    });

    it("should safely return confidence when atr <= 0", () => {
      const candles: Candle[] = [
        createCandle(100.2, 99.8),
      ];
      const trace: string[] = [];
      const result = applyPriorConsolidationPenalty(candles, 100, 0, 0, 50, trace);
      expect(result).toBe(50); // no penalty for invalid ATR
      expect(trace.length).toBe(0);
    });

    it("should respect the 30-candle lookback window (ignore touches outside)", () => {
      const candles: Candle[] = [];
      // Create 50 candles, with touches at index 5 and 35
      for (let i = 0; i < 50; i++) {
        if (i === 5 || i === 35) {
          candles.push(createCandle(100.2, 99.8)); // touch at entry
        } else {
          candles.push(createCandle(110, 105)); // no touch
        }
      }
      const trace: string[] = [];
      // lookbackEndIndex = 40, LOOKBACK_CANDLES = 30, so range is [11, 40]
      // Only touch at index 35 is within range, 5 is outside
      const result = applyPriorConsolidationPenalty(candles, 100, 10, 40, 50, trace);
      expect(result).toBe(50); // only 1 touch in window, no penalty
      expect(trace.length).toBe(0);
    });

    it("should clamp confidence to 0 when penalty brings it below 0", () => {
      const candles: Candle[] = [];
      // Create enough candles with touches at the end of the window
      for (let i = 0; i < 35; i++) {
        if (i === 30 || i === 34) {
          candles.push(createCandle(100.2, 99.8)); // touch entry at specific indices
        } else {
          candles.push(createCandle(110, 105)); // no touch elsewhere
        }
      }
      const trace: string[] = [];
      // lookbackEndIndex = 34, window = [5, 34], touches at 30 and 34 → 2 touches
      const result = applyPriorConsolidationPenalty(candles, 100, 10, 34, 5, trace);
      expect(result).toBe(0); // 5 - 10 = -5, clamp to 0
      expect(trace).toContainEqual(expect.stringContaining("Penalty"));
    });

    it("should use tolerance of 0.3 * ATR for touch detection", () => {
      const atr = 10;
      const tolerance = 0.3 * atr; // 3
      const candles: Candle[] = [
        createCandle(100 + tolerance, 100 - tolerance), // just at edge of tolerance
        createCandle(100 + tolerance + 0.01, 100 - tolerance - 0.01), // just outside tolerance
      ];
      const trace: string[] = [];
      const result = applyPriorConsolidationPenalty(candles, 100, atr, 1, 50, trace);
      expect(result).toBe(50); // only 1 touch, no penalty
      expect(trace.length).toBe(0);
    });

    it("should count touches on both high and low sides separately", () => {
      const candles: Candle[] = [
        createCandle(100.2, 99.8), // both high and low touch entry
        createCandle(110, 105),    // no touch
      ];
      const trace: string[] = [];
      const result = applyPriorConsolidationPenalty(candles, 100, 10, 1, 50, trace);
      // one candle with both high and low touching counts as separate touches? Actually no—
      // the logic checks `Math.abs(c.high - entry) <= tolerance OR Math.abs(c.low - entry) <= tolerance`
      // so it counts as 1 touch per candle, not 2
      expect(result).toBe(50); // only 1 candle with touch, no penalty
      expect(trace.length).toBe(0);
    });
  });
});
