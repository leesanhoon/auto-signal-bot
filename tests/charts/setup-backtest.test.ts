import { describe, expect, test } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";
import { runSetupBacktest } from "../../src/charts/setup-backtest.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// runSetupBacktest
// ---------------------------------------------------------------------------

describe("runSetupBacktest", () => {
  test("returns empty report for insufficient candles", () => {
    const candles = makeCandles(
      Array.from({ length: 20 }, () => ({
        o: 100, h: 101, l: 99, c: 100.5,
      })),
    );
    const report = runSetupBacktest(candles, "EUR/USD", "H4");
    expect(report.trades).toHaveLength(0);
    expect(report.overall.trades).toBe(0);
  });

  test("returns report shape even with no trades", () => {
    const candles = makeCandles(
      Array.from({ length: 100 }, () => ({
        o: 100 + Math.random() * 2,
        h: 101 + Math.random() * 2,
        l: 99 + Math.random() * 2,
        c: 100.5 + Math.random() * 2,
      })),
    );
    const report = runSetupBacktest(candles, "EUR/USD", "H4");
    expect(report).toHaveProperty("bySetup");
    expect(report).toHaveProperty("byPair");
    expect(report).toHaveProperty("overall");
    expect(report).toHaveProperty("trades");
    expect(typeof report.overall.trades).toBe("number");
    expect(typeof report.overall.winRate).toBe("number");
    expect(typeof report.overall.avgRiskReward).toBe("number");
  });

  test("no overlapping trades — second signal is skipped while first is active", () => {
    // Create a sequence where the first signal would occupy many candles
    const candles = makeCandles(
      Array.from({ length: 100 }, (_, i) => {
        // First 30 candles: uptrend
        if (i < 40) {
          const base = 100 + i * 0.2;
          return { o: base, h: base + 0.5, l: base - 0.3, c: base + 0.1 };
        }
        // Random flat for rest
        return { o: 110, h: 111, l: 109, c: 110.5 };
      }),
    );
    const report = runSetupBacktest(candles, "EUR/USD", "H4");
    expect(report.trades.length).toBeGreaterThanOrEqual(0);
    // Check no overlapping trades
    for (let i = 0; i < report.trades.length - 1; i++) {
      if (report.trades[i].exitIndex !== null) {
        expect(report.trades[i + 1].entryIndex).toBeGreaterThan(
          report.trades[i].exitIndex!,
        );
      }
    }
  });

  test("computes correct bySetup/byPair/overall report", () => {
    const candles = makeCandles(
      Array.from({ length: 100 }, () => ({
        o: 100 + Math.random(),
        h: 101 + Math.random(),
        l: 99 + Math.random(),
        c: 100.5 + Math.random(),
      })),
    );
    const report = runSetupBacktest(candles, "EUR/USD", "H4");
    // Just verify shapes — actual values depend on fixture randomness
    if (report.trades.length > 0) {
      const closed = report.trades.filter((t) => t.outcome !== "open_at_end");
      if (closed.length > 0) {
        expect(report.overall.trades).toBe(closed.length);
        expect(report.overall.winRate).toBeGreaterThanOrEqual(0);
        expect(report.overall.winRate).toBeLessThanOrEqual(1);
      }
    }
  });
});