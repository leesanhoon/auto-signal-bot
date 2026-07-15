import { describe, expect, test } from "vitest";
import type { Candle } from "../../../src/charts/client/ohlc-provider.js";
import type { DetectionContext } from "../../../src/charts/model/setup-types.js";
import { detectSb } from "../../../src/charts/service/setups/sb.js";

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  return {
    time: 1700000000000 + index * 3600000,
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

function buildLongFixture(): { candles: Candle[]; ctx: DetectionContext } {
  const candles = Array.from({ length: 21 }, (_, index) =>
    candle(index, 101.4, 101.8, 98.8, 101.5),
  );

  candles[9] = candle(9, 102.8, 104, 98.8, 102.4);
  candles[10] = candle(10, 102.4, 103, 98.8, 102);
  candles[11] = candle(11, 102, 102.5, 98.8, 101.6);
  candles[12] = candle(12, 100.6, 100.8, 99.8, 100.4);
  candles[13] = candle(13, 100.2, 101.2, 98.8, 99.9);
  candles[14] = candle(14, 100.4, 101.3, 98.8, 100.2);
  candles[15] = candle(15, 100.5, 100.9, 99.7, 100.3);
  candles[16] = candle(16, 101.2, 101.7, 98.8, 101.3);
  candles[17] = candle(17, 101.4, 101.9, 98.8, 101.5);
  candles[18] = candle(18, 101.6, 102.1, 98.8, 101.7);
  candles[19] = candle(19, 101.8, 102.3, 98.8, 101.9);
  candles[20] = candle(20, 99.6, 100.1, 98.8, 99.7);

  return {
    candles,
    ctx: {
      ma21: [99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99.2, 99.4, 99.6, 99.8, 100],
      atr14: candles.map(() => 2),
      pair: "EUR/USD",
      timeframe: "H4",
    },
  };
}

function buildShortFixture(): { candles: Candle[]; ctx: DetectionContext } {
  const candles = Array.from({ length: 21 }, (_, index) =>
    candle(index, 98.6, 101.2, 98.2, 98.5),
  );

  candles[9] = candle(9, 97.2, 101.2, 96, 97.6);
  candles[10] = candle(10, 97.6, 101.2, 97, 98);
  candles[11] = candle(11, 98, 101.2, 97.5, 98.4);
  candles[12] = candle(12, 99.4, 100.2, 99.2, 99.6);
  candles[13] = candle(13, 99.8, 101.2, 99.4, 100.1);
  candles[14] = candle(14, 99.6, 101.2, 98.8, 99.4);
  candles[15] = candle(15, 99.5, 100.3, 99.1, 99.7);
  candles[16] = candle(16, 98.8, 101.2, 98.3, 98.7);
  candles[17] = candle(17, 98.6, 101.2, 98.1, 98.5);
  candles[18] = candle(18, 98.4, 101.2, 97.9, 98.3);
  candles[19] = candle(19, 98.2, 101.2, 97.7, 98.1);
  candles[20] = candle(20, 100.4, 101.2, 99.8, 100.3);

  return {
    candles,
    ctx: {
      ma21: [101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 100.8, 100.6, 100.4, 100.2, 100],
      atr14: candles.map(() => 2),
      pair: "EUR/USD",
      timeframe: "H4",
    },
  };
}

describe("SB geometry", () => {
  test("LONG returns W-pattern geometry", () => {
    const { candles, ctx } = buildLongFixture();
    const signal = detectSb(candles, 20, ctx);

    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe("LONG");
    expect(signal!.geometry!.highlightCandles).toEqual([
      { index: 12, label: "Bottom 1" },
      { index: 15, label: "Bottom 2" },
    ]);
    expect(signal!.geometry!.lines).toHaveLength(2);
    expect(signal!.geometry!.lines![0]).toEqual({
      points: [
        { index: 9, price: candles[9].close },
        { index: 12, price: 99.8 },
      ],
      label: "Pullback",
      style: "pullback",
    });
    expect(signal!.geometry!.lines![1]).toEqual({
      points: [
        { index: 12, price: 99.8 },
        { index: 15, price: 99.7 },
      ],
      label: "W-pattern",
      style: "pattern",
    });
    expect(signal!.geometry!.patternLabel).toEqual({ index: 20, price: signal!.entry, text: "SB" });
  });

  test("SHORT returns M-pattern geometry", () => {
    const { candles, ctx } = buildShortFixture();
    const signal = detectSb(candles, 20, ctx);

    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe("SHORT");
    expect(signal!.geometry!.highlightCandles).toEqual([
      { index: 12, label: "Top 1" },
      { index: 15, label: "Top 2" },
    ]);
    expect(signal!.geometry!.lines).toHaveLength(2);
    expect(signal!.geometry!.lines![0]).toEqual({
      points: [
        { index: 9, price: candles[9].close },
        { index: 12, price: 100.2 },
      ],
      label: "Pullback",
      style: "pullback",
    });
    expect(signal!.geometry!.lines![1]).toEqual({
      points: [
        { index: 12, price: 100.2 },
        { index: 15, price: 100.3 },
      ],
      label: "M-pattern",
      style: "pattern",
    });
    expect(signal!.geometry!.patternLabel).toEqual({ index: 20, price: signal!.entry, text: "SB" });
  });
});
