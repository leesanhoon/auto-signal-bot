import { describe, expect, test } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";
import { calculateEma, calculateAtr } from "../../src/charts/indicators.js";
import { detectArb } from "../../src/charts/setups/arb.js";
import { buildTradeSetupFromSignal } from "../../src/charts/signal-assembly.js";

describe("Signal assembly — chartContext threading", () => {
  test("buildTradeSetupFromSignal threads chartContext when candles and ema20 provided", () => {
    const candles: Candle[] = [];
    candles.push(
      { time: 1700000000000 + 0 * 3600000, open: 100.0, high: 100.7, low: 99.95, close: 100.05, volume: 100 },
      { time: 1700000000000 + 1 * 3600000, open: 100.05, high: 100.75, low: 99.97, close: 100.02, volume: 100 },
    );

    for (let i = 2; i < 24; i++) {
      candles.push({
        time: 1700000000000 + i * 3600000,
        open: 100,
        high: 100.12,
        low: 99.88,
        close: 100.01,
        volume: 100,
      });
    }

    candles.push({
      time: 1700000000000 + 24 * 3600000,
      open: 100.1,
      high: 101.2,
      low: 100.0,
      close: 101.0,
      volume: 120,
    });

    const ema20 = calculateEma(candles, 20);
    const atr14 = calculateAtr(candles, 14);
    const ctx = { ema20, atr14, pair: "BTC/USDT", timeframe: "H4" as const };

    const signal = detectArb(candles, candles.length - 1, ctx);
    expect(signal).not.toBeNull();

    const setup = buildTradeSetupFromSignal(signal!, {
      lastPrice: 100.5,
      candles,
      ema20,
    });

    expect(setup).not.toBeNull();
    expect(setup!.chartContext).toBeDefined();
    expect(setup!.chartContext!.candles.length).toBeGreaterThan(0);
    expect(setup!.chartContext!.ema20.length).toBe(setup!.chartContext!.candles.length);
    expect(setup!.chartContext!.triggerIndex).toBe(24);
    expect(setup!.chartContext!.sliceStartIndex).toBeGreaterThanOrEqual(0);
    expect(setup!.chartContext!.sliceStartIndex).toBeLessThanOrEqual(24);
    expect(setup!.chartContext!.geometry).toBeDefined();
    expect(setup!.chartContext!.geometry!.boxes).toHaveLength(1);
    expect(setup!.chartContext!.geometry!.markers).toHaveLength(2);
  });

  test("buildTradeSetupFromSignal omits chartContext when candles/ema20 not provided (backward compat)", () => {
    const candles: Candle[] = [];
    candles.push(
      { time: 1700000000000 + 0 * 3600000, open: 100.0, high: 100.7, low: 99.95, close: 100.05, volume: 100 },
      { time: 1700000000000 + 1 * 3600000, open: 100.05, high: 100.75, low: 99.97, close: 100.02, volume: 100 },
    );

    for (let i = 2; i < 24; i++) {
      candles.push({
        time: 1700000000000 + i * 3600000,
        open: 100,
        high: 100.12,
        low: 99.88,
        close: 100.01,
        volume: 100,
      });
    }

    candles.push({
      time: 1700000000000 + 24 * 3600000,
      open: 100.1,
      high: 101.2,
      low: 100.0,
      close: 101.0,
      volume: 120,
    });

    const ema20 = calculateEma(candles, 20);
    const atr14 = calculateAtr(candles, 14);
    const ctx = { ema20, atr14, pair: "BTC/USDT", timeframe: "H4" as const };

    const signal = detectArb(candles, candles.length - 1, ctx);
    expect(signal).not.toBeNull();

    const setup = buildTradeSetupFromSignal(signal!, {
      lastPrice: 100.5,
    });

    expect(setup).not.toBeNull();
    expect(setup!.chartContext).toBeUndefined();
  });

  test("buildTradeSetupFromSignal includes chartContext even with valid prices", () => {
    // Reuse the same breakout fixture as the first test in this file — a flat market
    // never breaks out, so ARB never detects a signal there (a previous version of this
    // test used a flat fixture and always hit the "if (!signal) return" bailout, making
    // it pass unconditionally without checking anything).
    const candles: Candle[] = [];
    candles.push(
      { time: 1700000000000 + 0 * 3600000, open: 100.0, high: 100.7, low: 99.95, close: 100.05, volume: 100 },
      { time: 1700000000000 + 1 * 3600000, open: 100.05, high: 100.75, low: 99.97, close: 100.02, volume: 100 },
    );

    for (let i = 2; i < 24; i++) {
      candles.push({
        time: 1700000000000 + i * 3600000,
        open: 100,
        high: 100.12,
        low: 99.88,
        close: 100.01,
        volume: 100,
      });
    }

    candles.push({
      time: 1700000000000 + 24 * 3600000,
      open: 100.1,
      high: 101.2,
      low: 100.0,
      close: 101.0,
      volume: 120,
    });

    const ema20 = calculateEma(candles, 20);
    const atr14 = calculateAtr(candles, 14);
    const ctx = { ema20, atr14, pair: "BTC/USDT", timeframe: "H4" as const };

    const signal = detectArb(candles, candles.length - 1, ctx);
    expect(signal).not.toBeNull();

    // A valid lastPrice above stopLoss (range.low ~99.88) — must survive applyPriceSanityChecks
    // (which only rejects LONG setups when lastPrice <= stopLoss) and keep chartContext attached.
    const setup = buildTradeSetupFromSignal(signal!, {
      lastPrice: 100.95,
      candles,
      ema20,
    });

    expect(setup).not.toBeNull();
    expect(setup!.chartContext).toBeDefined();
    expect(setup!.chartContext!.candles.length).toBeGreaterThan(0);
  });
});
