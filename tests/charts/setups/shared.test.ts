import { afterEach, describe, it, expect } from "vitest";
import { baseConfidence, computeSlope, computeBodyRatio, computeTakeProfit, applyStandardConfidenceAdjustments } from "../../../src/charts/setups/shared.js";

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
});
