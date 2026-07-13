import { describe, expect, test } from "vitest";
import type { Candle } from "../../../src/charts/ohlc-provider.js";
import type { DetectionContext } from "../../../src/charts/setup-types.js";
import { detectDdb } from "../../../src/charts/setups/ddb.js";

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

describe("DDB geometry", () => {
  test("returns the doji cluster, pullback line, and DDB label", () => {
    const candles: Candle[] = [];

    for (let i = 0; i < 10; i++) {
      const close = 95.2 + i * 0.5;
      candles.push(candle(i, close - 0.2, close + 0.3, close - 0.5, close));
    }

    candles.push(candle(10, 99.98, 100.2, 99.8, 100.00));
    candles.push(candle(11, 100.00, 100.25, 99.85, 100.02));

    const ma21 = candles.map((item) => item.close - 0.1);
    ma21[6] = 98;
    ma21[11] = 100;

    const ctx: DetectionContext = {
      ma21,
      atr14: candles.map(() => 1),
      pair: "EUR/USD",
      timeframe: "H4",
    };

    const signal = detectDdb(candles, 11, ctx);

    expect(signal).not.toBeNull();
    expect(signal!.geometry!.highlightCandles).toEqual([
      { index: 10, label: "Doji" },
      { index: 11, label: "Doji" },
    ]);
    expect(signal!.geometry!.lines).toHaveLength(1);
    expect(signal!.geometry!.lines![0].points).toEqual([
      { index: 0, price: candles[0].close },
      { index: 10, price: candles[10].close },
    ]);
    expect(signal!.geometry!.patternLabel).toEqual({
      index: 11,
      price: signal!.entry,
      text: "DDB",
    });
  });
});
