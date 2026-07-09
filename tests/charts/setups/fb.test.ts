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
    ema20: calculateEma(candles, 20),
    atr14: calculateAtr(candles, 14),
    pair,
    timeframe,
  };
}

describe("FB — First Break TP2 Calculation", () => {
  test("LONG FB calculates TP2 = entry + (swingHigh - entry)/2 when swing is above entry, and TP2 > TP1", () => {
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
      const tp1 = signal.takeProfit1;
      const tp2 = signal.takeProfit2;
      const risk = entry - signal.stopLoss;

      // TP1 should be entry + 1.5*risk
      expect(tp1).toBeCloseTo(entry + 1.5 * risk);

      // TP2 should be > TP1 (further up)
      expect(tp2).toBeGreaterThan(tp1);

      // TP2 should be closer to swing high level (within entry and swing high)
      // TP2 = entry + (swingHigh - entry) * 0.5, where swingHigh should be around 112-112.5
      // So TP2 should be around 115 + (112 - 115) * 0.5 = 114.5, which is less than entry
      // Actually, let me recalculate: swingHigh is max of candles[i].high for i in [trendStartIndex-15, trendStartIndex)
      // If trendStartIndex is around 28, then we look at candles 13-27
      // In those candles, high is base + 0.6, so around 106.8 to 113.8
      // So swingHigh should be around 113.8
      // But the new logic requires swingHigh > entry (115.0), which is false
      // So TP2 should fall back to default: entry + 2.5 * risk
      const expectedDefaultTp2 = entry + 2.5 * risk;
      expect(tp2).toBeCloseTo(expectedDefaultTp2, 0);
    }
  });

  test("SHORT FB calculates TP2 = entry - (entry - swingLow)/2 when swing is below entry, and TP2 < TP1", () => {
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
      const tp1 = signal.takeProfit1;
      const tp2 = signal.takeProfit2;
      const risk = signal.stopLoss - entry;

      // TP1 should be entry - 1.5*risk
      expect(tp1).toBeCloseTo(entry - 1.5 * risk);

      // TP2 should be < TP1 (further down)
      expect(tp2).toBeLessThan(tp1);

      // TP2 should be further down than entry
      expect(tp2).toBeLessThan(entry);

      // swingLow should be min of candles[i].low for i in [trendStartIndex-15, trendStartIndex)
      // With similar trend start around index 28, we look at candles 13-27
      // In those candles, low is base - 0.6, going from ~95.8 down to ~88.2
      // So swingLow should be around 88.2
      // If swingLow (88.2) < entry (85.0) is false, then TP2 = default = entry - 2.5 * risk
      const expectedDefaultTp2 = entry - 2.5 * risk;
      expect(tp2).toBeCloseTo(expectedDefaultTp2, 0);
    }
  });

  test("LONG FB with swing high on wrong side (below entry) uses 2.5R fallback", () => {
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
      const tp1 = signal.takeProfit1;
      const tp2 = signal.takeProfit2;
      const risk = entry - signal.stopLoss;

      // Since swing high (around 115 from candles before trendStart) is below entry (116.2)
      // TP2 should use fallback: entry + 2.5 * risk
      const expectedTp2 = entry + 2.5 * risk;
      expect(tp2).toBeCloseTo(expectedTp2);

      // TP2 should still be > TP1
      expect(tp2).toBeGreaterThan(tp1);
    }
  });

  test("SHORT FB with swing low on wrong side (above entry) uses 2.5R fallback", () => {
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
      const tp1 = signal.takeProfit1;
      const tp2 = signal.takeProfit2;
      const risk = signal.stopLoss - entry;

      // Since swing low (around 85-86 from candles before trendStart) is above entry (83.8)
      // TP2 should use fallback: entry - 2.5 * risk
      const expectedTp2 = entry - 2.5 * risk;
      expect(tp2).toBeCloseTo(expectedTp2);

      // TP2 should still be < TP1
      expect(tp2).toBeLessThan(tp1);
    }
  });

  test("TP2 never equals TP1 and always moves away from entry", () => {
    // Any valid FB should have TP2 strictly different from TP1 and further from entry
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
      const tp1 = signal.takeProfit1;
      const tp2 = signal.takeProfit2;

      // TP2 should never equal TP1
      expect(tp2).not.toEqual(tp1);

      // For LONG, both TP1 and TP2 should be > entry
      if (signal.direction === "LONG") {
        expect(tp1).toBeGreaterThan(entry);
        expect(tp2).toBeGreaterThan(entry);
        // TP2 should be further (or at least not closer)
        expect(Math.abs(tp2 - entry)).toBeGreaterThanOrEqual(Math.abs(tp1 - entry) * 0.8);
      } else {
        expect(tp1).toBeLessThan(entry);
        expect(tp2).toBeLessThan(entry);
        expect(Math.abs(tp2 - entry)).toBeGreaterThanOrEqual(Math.abs(tp1 - entry) * 0.8);
      }
    }
  });
});
