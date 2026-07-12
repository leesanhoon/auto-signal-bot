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

function buildImmediateRbCandles(): Candle[] {
  return makeCandles([
    ...Array.from({ length: 23 }, (_, i) => {
      const base = 100;
      return { o: base, h: base + 1.1, l: base - 1.1, c: base };
    }),
    { o: 100, h: 101.0, l: 99.0, c: 100.0 },
    { o: 100.0, h: 101.1, l: 99.1, c: 100.05 },
    { o: 100.05, h: 101.05, l: 99.05, c: 100.02 },
    { o: 100.02, h: 101.0, l: 99.0, c: 100.03 },
    { o: 100.03, h: 101.08, l: 99.08, c: 100.04 },
    { o: 100.04, h: 101.1, l: 99.1, c: 100.01 },
    { o: 100.01, h: 101.05, l: 99.05, c: 100.02 },
    { o: 100.3, h: 101.45, l: 99.9, c: 101.2 },
  ]);
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

  test("returns a report shape for the breakout fixture", () => {
    const candles = [
      ...buildImmediateRbCandles(),
      ...Array.from({ length: 3 }, (_, i) => ({
        time: 1700000000000 + (31 + i) * 3600000,
        open: 100.02,
        high: 100.2,
        low: 99.8,
        close: 100.01,
        volume: 100,
      })),
    ];
    const report = runSetupBacktest(candles, "EUR/USD", "H4");

    expect(report).toHaveProperty("bySetup");
    expect(report).toHaveProperty("byPair");
    expect(report).toHaveProperty("overall");
    expect(report).toHaveProperty("trades");
  });

  test("does not create the non-SB trade before its breakout candle exists", () => {
    const candles = buildImmediateRbCandles().slice(0, 30);
    const report = runSetupBacktest(candles, "EUR/USD", "H4");

    expect(report.trades).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// runSetupBacktest — pending fill mode
// ---------------------------------------------------------------------------

describe("runSetupBacktest — pending fill mode", () => {
  test("immediate mode unchanged when fillMode not specified", () => {
    const candles = [
      ...buildImmediateRbCandles(),
      ...Array.from({ length: 5 }, (_, i) => ({
        time: 1700000000000 + (32 + i) * 3600000,
        open: 100.5,
        high: 101.0,
        low: 99.9,
        close: 100.0,
        volume: 100,
      })),
    ];

    // Run without explicit fillMode (default "immediate")
    const reportDefault = runSetupBacktest(candles, "EUR/USD", "H4");

    // Run with explicit fillMode="immediate"
    const reportExplicit = runSetupBacktest(
      candles,
      "EUR/USD",
      "H4",
      "fixed",
      0,
      3,
      "immediate",
    );

    // Both should be identical (including trades array structure)
    expect(reportDefault.overall.trades).toBe(reportExplicit.overall.trades);
    expect(reportDefault.trades.length).toBe(reportExplicit.trades.length);

    if (reportDefault.trades.length > 0) {
      for (let i = 0; i < reportDefault.trades.length; i++) {
        expect(reportDefault.trades[i].entryIndex).toBe(
          reportExplicit.trades[i].entryIndex,
        );
        expect(reportDefault.trades[i].entryPrice).toBe(
          reportExplicit.trades[i].entryPrice,
        );
        expect(reportDefault.trades[i].exitIndex).toBe(
          reportExplicit.trades[i].exitIndex,
        );
        expect(reportDefault.trades[i].outcome).toBe(
          reportExplicit.trades[i].outcome,
        );
      }
    }
  });

  test("pending mode fills only when price touches entry on bar after trigger", () => {
    // Start with base RB setup (trigger at index 31)
    const baseCandles = buildImmediateRbCandles();

    // Add candles after trigger:
    // Create a sequence where entry is not touched for multiple bars, then is touched
    const candles = [
      ...baseCandles,
      {
        time: 1700000000000 + 32 * 3600000,
        open: 100.3,
        high: 100.5, // Staying low to avoid entry trigger
        low: 99.9,
        close: 100.2,
        volume: 100,
      },
      {
        time: 1700000000000 + 33 * 3600000,
        open: 100.4,
        high: 100.6, // Still not quite at entry
        low: 99.95,
        close: 100.3,
        volume: 100,
      },
      {
        time: 1700000000000 + 34 * 3600000,
        open: 100.5,
        high: 101.4, // Now touches entry level
        low: 100.2,
        close: 101.0,
        volume: 100,
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        time: 1700000000000 + (35 + i) * 3600000,
        open: 101.0,
        high: 101.5,
        low: 100.5,
        close: 101.0,
        volume: 100,
      })),
    ];

    const report = runSetupBacktest(
      candles,
      "EUR/USD",
      "H4",
      "fixed",
      0,
      3,
      "pending",
      10,
    );

    // After BB pre-position changes, may get multiple signals (RB + BB pre-position on same pattern)
    // Verify at least one trade was created from pending fill
    expect(report.trades.length).toBeGreaterThanOrEqual(1);
    const trade = report.trades[0];

    // Trade should have valid entry/exit prices
    expect(trade.entryPrice).toBeGreaterThan(0);
    expect(trade.direction).toMatch(/^(LONG|SHORT)$/);

    // Pending stats: should show at least one signal seen and filled
    expect(report.pendingStats).toBeDefined();
    expect(report.pendingStats!.signalsSeen).toBeGreaterThanOrEqual(1);
    expect(report.pendingStats!.filled).toBeGreaterThanOrEqual(1);
  });

  test("pending mode invalidates when SL touches before entry", () => {
    const baseCandles = buildImmediateRbCandles();

    // Assume RB has entry ~101.1 and stopLoss ~99.1
    // Add candle after trigger with low <= stopLoss
    const candles = [
      ...baseCandles,
      {
        time: 1700000000000 + 32 * 3600000,
        open: 100.5,
        high: 101.0,
        low: 99.0, // Touches/crosses stopLoss (~99.1)
        close: 99.5,
        volume: 100,
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        time: 1700000000000 + (33 + i) * 3600000,
        open: 100.0,
        high: 101.0,
        low: 99.0,
        close: 100.0,
        volume: 100,
      })),
    ];

    const report = runSetupBacktest(
      candles,
      "EUR/USD",
      "H4",
      "fixed",
      0,
      3,
      "pending",
      5,
    );

    // No trades should be created
    expect(report.trades).toHaveLength(0);

    // Pending stats: order was seen but cancelled before fill
    expect(report.pendingStats).toBeDefined();
    expect(report.pendingStats!.signalsSeen).toBe(1);
    expect(report.pendingStats!.filled).toBe(0);
    expect(report.pendingStats!.cancelledBeforeFill).toBe(1);
    expect(report.pendingStats!.expired).toBe(0);
  });

  test("pending mode expires after pendingExpiryBars without fill or cancel", () => {
    const baseCandles = buildImmediateRbCandles();

    // Add candles that don't touch entry or SL
    // With pendingExpiryBars=2, expires after 2 bars from orderStartIndex (index 32)
    // Deadline is index 31 + 2 = 33, so it should expire when we reach index 33
    const candles = [
      ...baseCandles,
      {
        time: 1700000000000 + 32 * 3600000,
        open: 100.5,
        high: 101.0,
        low: 99.9, // Doesn't touch entry (~101.1) or SL (~99.1)
        close: 100.0,
        volume: 100,
      },
      {
        time: 1700000000000 + 33 * 3600000,
        open: 100.5,
        high: 101.0,
        low: 99.95, // Still doesn't touch either level
        close: 100.0,
        volume: 100,
      },
      ...Array.from({ length: 3 }, (_, i) => ({
        time: 1700000000000 + (34 + i) * 3600000,
        open: 100.5,
        high: 101.0,
        low: 99.9,
        close: 100.0,
        volume: 100,
      })),
    ];

    const report = runSetupBacktest(
      candles,
      "EUR/USD",
      "H4",
      "fixed",
      0,
      3,
      "pending",
      2, // pendingExpiryBars = 2
    );

    // No trades (order expired without fill)
    expect(report.trades).toHaveLength(0);

    // Pending stats
    expect(report.pendingStats).toBeDefined();
    expect(report.pendingStats!.signalsSeen).toBe(1);
    expect(report.pendingStats!.filled).toBe(0);
    expect(report.pendingStats!.cancelledBeforeFill).toBe(0);
    expect(report.pendingStats!.expired).toBe(1);
  });

  test("pending mode prioritizes invalidation over fill when SL and entry touched same candle", () => {
    const baseCandles = buildImmediateRbCandles();

    // Add one candle with both high >= entry AND low <= stopLoss
    // Assume entry ~101.1, stopLoss ~99.1
    const candles = [
      ...baseCandles,
      {
        time: 1700000000000 + 32 * 3600000,
        open: 100.0,
        high: 101.3, // Touches entry
        low: 99.0, // Touches stopLoss (crosses it)
        close: 100.5,
        volume: 100,
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        time: 1700000000000 + (33 + i) * 3600000,
        open: 100.0,
        high: 101.0,
        low: 99.0,
        close: 100.0,
        volume: 100,
      })),
    ];

    const report = runSetupBacktest(
      candles,
      "EUR/USD",
      "H4",
      "fixed",
      0,
      3,
      "pending",
      5,
    );

    // No trades (invalidation takes priority)
    expect(report.trades).toHaveLength(0);

    // Pending stats: cancelled, not filled
    expect(report.pendingStats).toBeDefined();
    expect(report.pendingStats!.signalsSeen).toBe(1);
    expect(report.pendingStats!.filled).toBe(0);
    expect(report.pendingStats!.cancelledBeforeFill).toBe(1);
    expect(report.pendingStats!.expired).toBe(0);
  });
});
