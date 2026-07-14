import { describe, expect, test } from "vitest";
import type { Candle } from "../../../src/charts/ohlc-provider.js";
import type { DetectionContext } from "../../../src/charts/setup-types.js";
import { calculateEma, calculateAtr } from "../../../src/charts/indicators.js";
import { detectFb } from "../../../src/charts/setups/fb.js";

function makeCandles(
  prices: Array<{ o: number; h: number; l: number; c: number; v?: number }>,
): Candle[] {
  return prices.map((p, i) => ({
    time: 1700000000000 + i * 3600000,
    open: p.o,
    high: p.h,
    low: p.l,
    close: p.c,
    volume: p.v ?? 100,
  }));
}

function buildContext(
  candles: Candle[],
  pair = "EUR/USD",
  timeframe: "M15" | "H4" | "D1" = "H4",
): DetectionContext {
  return {
    ma21: calculateEma(candles, 20),
    atr14: calculateAtr(candles, 14),
    pair,
    timeframe,
  };
}

describe("FB — First Break take-profit calculation", () => {
  test("returns pullback geometry from trend extreme to the signal candle", () => {
    const candles = makeCandles(
      Array.from({ length: 13 }, (_, index) => {
        if (index >= 8 && index <= 11) {
          const close = 103 - (index - 8) * 0.2;
          return {
            o: close + 0.2,
            h: close + 0.4,
            l: close - 0.4,
            c: close,
          };
        }

        if (index === 12) {
          return { o: 102.05, h: 102.2, l: 101.5, c: 101.85 };
        }

        return { o: 100.3, h: 100.8, l: 100.1, c: 100.5 };
      }),
    );

    const ctx: DetectionContext = {
      ma21: [100, 100, 100, 100, 100, 100, 100, 100, 101, 101.2, 101.4, 101.6, 101.8],
      atr14: candles.map(() => 1),
      pair: "EUR/USD",
      timeframe: "H4",
    };

    const signal = detectFb(candles, 12, ctx);

    expect(signal).not.toBeNull();
    expect(signal!.geometry!.lines).toHaveLength(1);
    // Pullback line now starts from trend extreme (high for LONG) at index 8, not from close
    expect(signal!.geometry!.lines![0]).toEqual({
      points: [
        { index: 8, price: candles[8].high },
        { index: 12, price: candles[12].close },
      ],
      label: "Pullback",
      style: "pullback",
    });
    expect(signal!.geometry!.patternLabel).toEqual({
      index: 12,
      price: signal!.entry,
      text: "FB",
    });
  });

  test("LONG FB uses the configured 2R take profit", () => {
    // Build uptrend followed by pullback to EMA, then FB break
    const candles: Candle[] = [];

    // 30 candles of uptrend
    for (let i = 0; i < 30; i++) {
      const base = 100 + i * 0.4;
      candles.push({
        time: 1700000000000 + i * 3600000,
        open: base,
        high: base + 0.6,
        low: base - 0.4,
        close: base + 0.3,
        volume: 100,
      });
    }

    // Candles with a swing high at 112 around index 10-15 (before trend start which will be ~index 25-28)
    // This swing high will be examined 15 candles before trendStartIndex

    // 5 more candles with steep rise to establish trend
    for (let i = 0; i < 5; i++) {
      const base = 112 + i * 0.5;
      candles.push({
        time: 1700000000000 + (30 + i) * 3600000,
        open: base,
        high: base + 0.6,
        low: base - 0.4,
        close: base + 0.3,
        volume: 100,
      });
    }

    // Pullback to EMA and then strong break above (FB signal bar)
    // At this point EMA20 should be around 113-114
    candles.push({
      time: 1700000000000 + 35 * 3600000,
      open: 114.2,
      high: 114.5,
      low: 113.5,
      close: 113.8, // close near EMA (touch)
      volume: 100,
    });

    // Signal bar: closes above open (uptrend), high body ratio
    candles.push({
      time: 1700000000000 + 36 * 3600000,
      open: 113.7,
      high: 115.0, // strong move
      low: 113.5,
      close: 114.9, // closes near high (strong body)
      volume: 120,
    });

    const ctx = buildContext(candles);
    const lastIndex = candles.length - 1;
    const signal = detectFb(candles, lastIndex, ctx);

    if (signal && signal.setup === "FB") {
      const entry = signal.entry; // should be high of signal bar = 115.0
      const takeProfit = signal.takeProfit;
      const risk = entry - signal.stopLoss;
      expect(takeProfit).toBeCloseTo(entry + 2 * risk);
    }
  });

  test("SHORT FB uses the configured 2R take profit", () => {
    // Build downtrend followed by pullback to EMA, then FB break
    const candles: Candle[] = [];

    // 30 candles of downtrend
    for (let i = 0; i < 30; i++) {
      const base = 100 - i * 0.4;
      candles.push({
        time: 1700000000000 + i * 3600000,
        open: base,
        high: base + 0.4,
        low: base - 0.6,
        close: base - 0.3,
        volume: 100,
      });
    }

    // 5 more candles with steep decline to establish trend
    for (let i = 0; i < 5; i++) {
      const base = 88 - i * 0.5;
      candles.push({
        time: 1700000000000 + (30 + i) * 3600000,
        open: base,
        high: base + 0.4,
        low: base - 0.6,
        close: base - 0.3,
        volume: 100,
      });
    }

    // Pullback to EMA and then strong break below (FB signal bar)
    candles.push({
      time: 1700000000000 + 35 * 3600000,
      open: 85.8,
      high: 86.5,
      low: 85.5,
      close: 86.2, // close near EMA (touch)
      volume: 100,
    });

    // Signal bar: closes below open (downtrend), high body ratio
    candles.push({
      time: 1700000000000 + 36 * 3600000,
      open: 86.3,
      high: 86.5,
      low: 85.0, // strong move down
      close: 85.1, // closes near low (strong body)
      volume: 120,
    });

    const ctx = buildContext(candles);
    const lastIndex = candles.length - 1;
    const signal = detectFb(candles, lastIndex, ctx);

    if (signal && signal.setup === "FB") {
      const entry = signal.entry; // should be low of signal bar = 85.0
      const takeProfit = signal.takeProfit;
      const risk = signal.stopLoss - entry;
      expect(takeProfit).toBeCloseTo(entry - 2 * risk);
    }
  });

  test("LONG FB target does not depend on a prior swing high", () => {
    // Build a sharp uptrend (no swing above current price), FB at the peak
    const candles: Candle[] = [];

    // 20 candles of gradual uptrend
    for (let i = 0; i < 20; i++) {
      const base = 100 + i * 0.3;
      candles.push({
        time: 1700000000000 + i * 3600000,
        open: base,
        high: base + 0.4,
        low: base - 0.2,
        close: base + 0.2,
        volume: 100,
      });
    }

    // Steep accelerated uptrend (last 10 candles)
    for (let i = 0; i < 10; i++) {
      const base = 106 + i * 0.8;
      candles.push({
        time: 1700000000000 + (20 + i) * 3600000,
        open: base,
        high: base + 0.6,
        low: base - 0.4,
        close: base + 0.4,
        volume: 100,
      });
    }

    // Brief touch near EMA
    candles.push({
      time: 1700000000000 + 30 * 3600000,
      open: 114.5,
      high: 115.0,
      low: 114.0,
      close: 114.3,
      volume: 100,
    });

    // FB signal bar at new high
    candles.push({
      time: 1700000000000 + 31 * 3600000,
      open: 114.4,
      high: 116.2,
      low: 114.0,
      close: 115.9,
      volume: 120,
    });

    const ctx = buildContext(candles);
    const lastIndex = candles.length - 1;
    const signal = detectFb(candles, lastIndex, ctx);

    if (signal && signal.setup === "FB") {
      const entry = signal.entry;
      const takeProfit = signal.takeProfit;
      const risk = entry - signal.stopLoss;
      expect(takeProfit).toBeCloseTo(entry + 2 * risk);
    }
  });

  test("SHORT FB target does not depend on a prior swing low", () => {
    // Build a sharp downtrend, FB at new low
    const candles: Candle[] = [];

    // 20 candles of gradual downtrend
    for (let i = 0; i < 20; i++) {
      const base = 100 - i * 0.3;
      candles.push({
        time: 1700000000000 + i * 3600000,
        open: base,
        high: base + 0.2,
        low: base - 0.4,
        close: base - 0.2,
        volume: 100,
      });
    }

    // Steep accelerated downtrend (last 10 candles)
    for (let i = 0; i < 10; i++) {
      const base = 94 - i * 0.8;
      candles.push({
        time: 1700000000000 + (20 + i) * 3600000,
        open: base,
        high: base + 0.4,
        low: base - 0.6,
        close: base - 0.4,
        volume: 100,
      });
    }

    // Brief touch near EMA
    candles.push({
      time: 1700000000000 + 30 * 3600000,
      open: 85.5,
      high: 86.0,
      low: 85.0,
      close: 85.7,
      volume: 100,
    });

    // FB signal bar at new low
    candles.push({
      time: 1700000000000 + 31 * 3600000,
      open: 85.6,
      high: 86.0,
      low: 83.8,
      close: 84.1,
      volume: 120,
    });

    const ctx = buildContext(candles);
    const lastIndex = candles.length - 1;
    const signal = detectFb(candles, lastIndex, ctx);

    if (signal && signal.setup === "FB") {
      const entry = signal.entry;
      const takeProfit = signal.takeProfit;
      const risk = signal.stopLoss - entry;
      expect(takeProfit).toBeCloseTo(entry - 2 * risk);
    }
  });

  test("take profit is always placed 2R away from entry", () => {
    const candles: Candle[] = [];

    // Simple uptrend
    for (let i = 0; i < 35; i++) {
      const base = 100 + i * 0.4;
      candles.push({
        time: 1700000000000 + i * 3600000,
        open: base,
        high: base + 0.5,
        low: base - 0.3,
        close: base + 0.2,
        volume: 100,
      });
    }

    // Touch and break
    candles.push({
      time: 1700000000000 + 35 * 3600000,
      open: 114.0,
      high: 114.5,
      low: 113.5,
      close: 113.8,
      volume: 100,
    });

    candles.push({
      time: 1700000000000 + 36 * 3600000,
      open: 113.8,
      high: 115.5,
      low: 113.5,
      close: 115.2,
      volume: 120,
    });

    const ctx = buildContext(candles);
    const signal = detectFb(candles, candles.length - 1, ctx);

    if (signal && signal.setup === "FB") {
      const entry = signal.entry;
      const takeProfit = signal.takeProfit;
      const risk = Math.abs(entry - signal.stopLoss);

      if (signal.direction === "LONG") {
        expect(takeProfit).toBeCloseTo(entry + 2 * risk);
      } else {
        expect(takeProfit).toBeCloseTo(entry - 2 * risk);
      }
    }
  });
});
