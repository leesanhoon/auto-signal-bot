import { describe, expect, test } from "vitest";
import type { Candle } from "../../../src/charts/ohlc-provider.js";
import {
  detectFairValueGap,
  detectLiquiditySweep,
  detectStructureBreak,
  findRecentOrderBlock,
  findSwingPoints,
} from "../../../src/charts/smc/smc-structure.js";

function candle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle {
  return { time, open, high, low, close, volume: 100 };
}

const swingCandles: Candle[] = [
  candle(1, 100, 102, 99, 101),
  candle(2, 101, 105, 100, 104),
  candle(3, 104, 103, 98, 99),
  candle(4, 99, 106, 97, 105),
  candle(5, 105, 104, 96, 97),
  candle(6, 97, 103, 95, 102),
  candle(7, 102, 108, 101, 107),
];

describe("findSwingPoints", () => {
  test("detects swing high and low deterministically", () => {
    const swings = findSwingPoints(swingCandles, { left: 1, right: 1 });
    expect(swings).toEqual([
      { index: 1, price: 105, kind: "HIGH" },
      { index: 3, price: 106, kind: "HIGH" },
      { index: 5, price: 95, kind: "LOW" },
    ]);
  });

  test("returns empty array when not enough candles", () => {
    expect(findSwingPoints(swingCandles.slice(0, 2), { left: 2, right: 2 })).toEqual([]);
  });
});

describe("detectStructureBreak", () => {
  test("detects bullish BOS when close breaks prior swing high", () => {
    const candles = [
      candle(1, 100, 101, 99, 100),
      candle(2, 100, 105, 99, 104),
      candle(3, 104, 103, 98, 99),
      candle(4, 99, 106, 97, 105),
      candle(5, 105, 107, 103, 106),
    ];
    const swings = findSwingPoints(candles, { left: 1, right: 1 });
    const event = detectStructureBreak(candles, swings, 4);
    expect(event).toEqual({
      kind: "BOS",
      direction: "LONG",
      breakIndex: 4,
      level: 105,
    });
  });

  test("detects bearish CHOCH after bullish previous bias", () => {
    const candles = [
      candle(1, 100, 101, 99, 100),
      candle(2, 100, 102, 98, 101),
      candle(3, 101, 105, 100, 104),
      candle(4, 104, 103, 96, 97),
      candle(5, 97, 100, 95, 99),
    ];
    const swings = findSwingPoints(candles, { left: 1, right: 1 });
    const event = detectStructureBreak(candles, swings, 3, "LONG");
    expect(event).toEqual({
      kind: "CHOCH",
      direction: "SHORT",
      breakIndex: 3,
      level: 98,
      previousBias: "LONG",
    });
  });
});

describe("detectLiquiditySweep", () => {
  test("detects sweep above prior swing high", () => {
    const candles = [
      candle(1, 100, 101, 99, 100),
      candle(2, 100, 105, 99, 104),
      candle(3, 104, 103, 98, 99),
      candle(4, 99, 106, 97, 105),
      candle(5, 105, 106, 100, 103),
    ];
    const swings = findSwingPoints(candles, { left: 1, right: 1 });
    expect(detectLiquiditySweep(candles, swings, 4)).toEqual({
      direction: "SHORT",
      sweepIndex: 4,
      sweptLevel: 105,
      reclaimClose: 103,
    });
  });

  test("detects sweep below prior swing low", () => {
    const candles = [
      candle(1, 100, 101, 99, 100),
      candle(2, 100, 102, 97, 98),
      candle(3, 98, 103, 99, 102),
      candle(4, 102, 104, 96, 101),
      candle(5, 101, 105, 100, 104),
    ];
    const swings = findSwingPoints(candles, { left: 1, right: 1 });
    expect(detectLiquiditySweep(candles, swings, 3)).toEqual({
      direction: "LONG",
      sweepIndex: 3,
      sweptLevel: 97,
      reclaimClose: 101,
    });
  });
});

describe("findRecentOrderBlock", () => {
  test("returns last bearish candle for LONG", () => {
    const candles = [
      candle(1, 100, 101, 99, 101),
      candle(2, 101, 103, 100, 99),
      candle(3, 99, 104, 98, 103),
      candle(4, 103, 106, 102, 105),
    ];
    expect(findRecentOrderBlock(candles, 3, "LONG", 5)).toEqual({
      direction: "LONG",
      startIndex: 1,
      endIndex: 1,
      high: 103,
      low: 100,
      midpoint: 101.5,
    });
  });

  test("returns last bullish candle for SHORT", () => {
    const candles = [
      candle(1, 100, 101, 99, 99),
      candle(2, 99, 103, 98, 102),
      candle(3, 102, 104, 101, 100),
      candle(4, 100, 106, 99, 95),
    ];
    expect(findRecentOrderBlock(candles, 3, "SHORT", 5)).toEqual({
      direction: "SHORT",
      startIndex: 1,
      endIndex: 1,
      high: 103,
      low: 98,
      midpoint: 100.5,
    });
  });
});

describe("detectFairValueGap", () => {
  test("detects bullish FVG", () => {
    const candles = [
      candle(1, 100, 101, 99, 100),
      candle(2, 100, 103, 100, 102),
      candle(3, 102, 108, 104, 107),
    ];
    expect(detectFairValueGap(candles, 2)).toEqual({
      direction: "LONG",
      index: 2,
      high: 104,
      low: 101,
      midpoint: 102.5,
    });
  });

  test("detects bearish FVG", () => {
    const candles = [
      candle(1, 110, 111, 109, 110),
      candle(2, 110, 109, 106, 107),
      candle(3, 107, 104, 103, 103),
    ];
    expect(detectFairValueGap(candles, 2)).toEqual({
      direction: "SHORT",
      index: 2,
      high: 109,
      low: 104,
      midpoint: 106.5,
    });
  });

  test("returns null for insufficient candles", () => {
    expect(detectFairValueGap(swingCandles.slice(0, 2), 1)).toBeNull();
    expect(detectLiquiditySweep(swingCandles.slice(0, 2), [], 1)).toBeNull();
    expect(detectStructureBreak(swingCandles.slice(0, 2), [], 1)).toBeNull();
    expect(findRecentOrderBlock(swingCandles.slice(0, 1), 0, "LONG")).toBeNull();
  });
});
