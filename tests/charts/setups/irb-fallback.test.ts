import { describe, expect, it } from "vitest";
import type { Candle } from "../../../src/charts/ohlc-provider.js";
import { calculateAtr, calculateEma, detectCompression } from "../../../src/charts/indicators.js";
import { detectIrb } from "../../../src/charts/setups/irb.js";
import type { DetectionContext } from "../../../src/charts/setup-types.js";

function buildFallbackCandles(): Candle[] {
  const candles: Candle[] = [];

  for (let i = 0; i < 12; i++) {
    const base = 100 + i * 0.05;
    candles.push({
      time: 1700000000000 + i * 3600000,
      open: base,
      high: base + 2.0,
      low: base - 1.6,
      close: base + 0.3,
      volume: 100,
    });
  }

  const compression = [
    { high: 102.15, low: 101.55, close: 101.75 },
    { high: 102.14, low: 101.57, close: 101.78 },
    { high: 102.13, low: 101.6, close: 101.8 },
    { high: 102.12, low: 101.62, close: 101.82 },
    { high: 102.11, low: 101.64, close: 101.84 },
    { high: 102.1, low: 101.66, close: 101.86 },
    { high: 102.09, low: 101.68, close: 101.88 },
    { high: 102.08, low: 101.7, close: 101.9 },
    { high: 102.07, low: 101.72, close: 101.92 },
    { high: 102.06, low: 101.74, close: 101.94 },
  ];

  compression.forEach((candle, offset) => {
    const index = 12 + offset;
    candles.push({
      time: 1700000000000 + index * 3600000,
      open: candle.close - 0.04,
      high: offset === compression.length - 1 ? 102.11 : candle.high,
      low: candle.low,
      close: candle.close,
      volume: 90,
    });
  });

  candles.push({
    time: 1700000000000 + 22 * 3600000,
    open: 102.0,
    high: 102.25,
    low: 101.95,
    close: 102.12,
    volume: 120,
  });

  return candles;
}

function buildRejectionCandles(): Candle[] {
  const candles = buildFallbackCandles().slice(0, 22);
  candles.push({
    time: 1700000000000 + 22 * 3600000,
    open: 102.0,
    high: 102.02,
    low: 101.96,
    close: 102.0,
    volume: 120,
  });
  return candles;
}

function buildVariantCandles(overrides: Array<{ index: number; high?: number; low?: number; close?: number }>): Candle[] {
  const candles = buildFallbackCandles().map((candle) => ({ ...candle }));
  for (const override of overrides) {
    candles[override.index] = {
      ...candles[override.index],
      ...(override.high !== undefined ? { high: override.high } : {}),
      ...(override.low !== undefined ? { low: override.low } : {}),
      ...(override.close !== undefined ? { close: override.close, open: override.close } : {}),
    };
  }
  return candles;
}

function buildContext(candles: Candle[]): DetectionContext {
  return {
    ema20: calculateEma(candles, 20),
    atr14: calculateAtr(candles, 14),
    pair: "EUR/USD",
    timeframe: "H4",
  };
}

function legacyShiftedFallback(
  candles: Candle[],
  ctx: DetectionContext,
  index: number,
  matchedInnerWindow: number,
  kBlockInner: number,
  direction: "LONG" | "SHORT",
  rangeOuter: NonNullable<ReturnType<typeof detectCompression>>,
): boolean {
  const rangeInner = detectCompression(
    candles,
    ctx.ema20,
    ctx.atr14,
    index - 1,
    matchedInnerWindow,
    kBlockInner,
  );
  if (rangeInner === null) return false;

  const prevCandle = candles[index - 1];
  return direction === "LONG"
    ? prevCandle.high > rangeInner.high && candles[index].high > rangeOuter.high
    : prevCandle.low < rangeInner.low && candles[index].low < rangeOuter.low;
}

describe("IRB fallback branch", () => {
  it("shows the recomputed fallback is more permissive on a valid long breakout", () => {
    const candles = buildFallbackCandles();
    const ctx = buildContext(candles);
    const index = candles.length - 1;

    const rangeOuter = detectCompression(candles, ctx.ema20, ctx.atr14, index - 1, 10, 2.5);
    const rangeInner = detectCompression(candles, ctx.ema20, ctx.atr14, index - 1, 4, 1.5);

    expect(rangeOuter).not.toBeNull();
    expect(rangeInner).not.toBeNull();

    const signal = detectIrb(candles, index, ctx);

    expect(signal).not.toBeNull();
    expect(signal!.setup).toBe("IRB");
    expect(signal!.direction).toBe("LONG");
    expect(signal!.triggerIndex).toBe(index);
    expect(signal!.entry).toBe(102.11);
    expect(signal!.ruleTrace).toContain("RangeInner pha index 21, RangeOuter pha index 22 -> chap nhan");
    expect(
      legacyShiftedFallback(candles, ctx, index, 4, 1.5, "LONG", rangeOuter!),
    ).toBe(false);
  });

  it("does not expose a Case A regression across several candidate fixtures", () => {
    const fixtures = [
      { name: "case-b-long-breakout", candles: buildFallbackCandles() },
      { name: "no-breakout", candles: buildRejectionCandles() },
      { name: "wider-inner-17", candles: buildVariantCandles([{ index: 17, high: 103.4, low: 100.8, close: 102.0 }]) },
      { name: "tighter-inner-18", candles: buildVariantCandles([{ index: 18, high: 102.02, low: 101.88, close: 101.96 }]) },
    ];

    for (const fixture of fixtures) {
      const ctx = buildContext(fixture.candles);
      const index = fixture.candles.length - 1;
      const currentSignal = detectIrb(fixture.candles, index, ctx);
      const rangeOuter = detectCompression(fixture.candles, ctx.ema20, ctx.atr14, index - 1, 10, 2.5);
      const legacyAccepts = rangeOuter !== null
        ? legacyShiftedFallback(fixture.candles, ctx, index, 4, 1.5, "LONG", rangeOuter)
        : false;

      expect({
        name: fixture.name,
        legacyAccepts,
        currentAccepts: currentSignal !== null,
      }).not.toMatchObject({
        legacyAccepts: true,
        currentAccepts: false,
      });
    }
  });
});
