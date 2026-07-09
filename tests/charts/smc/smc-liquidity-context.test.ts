import { describe, expect, test } from "vitest";
import {
  calculatePriorPeriodLevels,
  calculatePremiumDiscountZone,
  calculateRvol,
  detectRejectionWick,
  findEqualLevels,
  findDealingRange,
} from "../../../src/charts/smc/smc-liquidity-context.js";
import type { Candle } from "../../../src/charts/ohlc-provider.js";
import type { SmcSwingPoint } from "../../../src/charts/smc/smc-types.js";

const swings: SmcSwingPoint[] = [
  { index: 2, price: 100, kind: "LOW" },
  { index: 4, price: 130, kind: "HIGH" },
  { index: 6, price: 110, kind: "LOW" },
  { index: 8, price: 160, kind: "HIGH" },
];

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 100 };
}

describe("findDealingRange", () => {
  test("finds latest prior high and low before atIndex", () => {
    expect(findDealingRange(swings, 9)).toEqual({
      rangeLow: 110,
      rangeHigh: 160,
    });
  });
});

describe("calculatePremiumDiscountZone", () => {
  test("returns PREMIUM for price in upper part of range", () => {
    const result = calculatePremiumDiscountZone(126, swings, 7);
    expect(result).toEqual({
      rangeLow: 110,
      rangeHigh: 130,
      percentInRange: 80,
      zone: "PREMIUM",
    });
  });

  test("returns DISCOUNT for price near lower part of range", () => {
    const result = calculatePremiumDiscountZone(116, swings, 9);
    expect(result).toEqual({
      rangeLow: 110,
      rangeHigh: 160,
      percentInRange: 12,
      zone: "DISCOUNT",
    });
  });

  test("returns EQUILIBRIUM for midpoint price", () => {
    const result = calculatePremiumDiscountZone(135, swings, 9);
    expect(result).toEqual({
      rangeLow: 110,
      rangeHigh: 160,
      percentInRange: 50,
      zone: "EQUILIBRIUM",
    });
  });

  test("returns null when swings are insufficient", () => {
    expect(
      calculatePremiumDiscountZone(100, [{ index: 1, price: 120, kind: "HIGH" }], 3),
    ).toBeNull();
  });
});

describe("findEqualLevels", () => {
  test("finds equal lows within tolerance", () => {
    const equalSwings: SmcSwingPoint[] = [
      { index: 1, price: 120, kind: "HIGH" },
      { index: 2, price: 100, kind: "LOW" },
      { index: 3, price: 130, kind: "HIGH" },
      { index: 4, price: 100.05, kind: "LOW" },
    ];
    expect(findEqualLevels(equalSwings, 5)).toEqual([
      { price: 100.025, kind: "EQL" },
    ]);
  });
});

describe("calculatePriorPeriodLevels", () => {
  test("calculates prior day and prior week levels from closed candles", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const candles: Candle[] = [
      candle(6 * dayMs, 10, 15, 8, 14),
      candle(7 * dayMs, 14, 20, 11, 18),
      candle(7 * dayMs + 60_000, 18, 19, 10, 12),
      candle(8 * dayMs, 12, 17, 9, 16),
    ];

    expect(calculatePriorPeriodLevels(candles, 3)).toEqual({
      priorDayLow: 10,
      priorDayHigh: 20,
      priorWeekLow: 8,
      priorWeekHigh: 15,
    });
  });
});

describe("calculateRvol", () => {
  test("calculates relative volume from prior candles", () => {
    const candles: Candle[] = [
      candle(1, 1, 2, 0.5, 1.5),
      candle(2, 1, 2, 0.5, 1.5),
      candle(3, 1, 2, 0.5, 1.5),
      candle(4, 1, 2, 0.5, 1.5),
      candle(5, 1, 2, 0.5, 1.5),
      { ...candle(6, 1, 2, 0.5, 1.5), volume: 50 },
    ].map((c, index) => ({ ...c, volume: index < 5 ? 100 : c.volume }));

    expect(calculateRvol(candles, 5, 5)).toBe(0.5);
  });
});

describe("detectRejectionWick", () => {
  test("detects strong upper wick for SHORT direction", () => {
    expect(
      detectRejectionWick({ time: 1, open: 100, close: 99, high: 110, low: 98, volume: 100 }, "SHORT"),
    ).toEqual({
      hasRejectionWick: true,
      wickRatio: 10 / 12,
    });
  });

  test("returns false when candle has no meaningful rejection wick", () => {
    expect(
      detectRejectionWick({ time: 1, open: 100, close: 109, high: 110, low: 99, volume: 100 }, "SHORT"),
    ).toEqual({
      hasRejectionWick: false,
      wickRatio: 1 / 11,
    });
  });
});
