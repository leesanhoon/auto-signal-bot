import { describe, expect, test } from "vitest";
import type { Candle } from "../../src/charts/client/ohlc-provider.js";
import { calculateLatestEma, resolveEmaExitDecision } from "../../src/charts/position-ema-exit.js";
import { calculateEma } from "../../src/charts/indicators.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCandles(
  prices: Array<{
    o: number;
    h: number;
    l: number;
    c: number;
    v?: number;
  }>,
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

// Steady uptrend: each candle closes higher
const steadyUptrend = makeCandles(
  Array.from({ length: 30 }, (_, i) => ({
    o: 100 + i,
    h: 101 + i,
    l: 99 + i,
    c: 100.5 + i,
  })),
);

// Steady downtrend: each candle closes lower
const steadyDowntrend = makeCandles(
  Array.from({ length: 30 }, (_, i) => ({
    o: 130 - i,
    h: 131 - i,
    l: 129 - i,
    c: 130.5 - i,
  })),
);

// Only 2 candles (shorter than any EMA period we'll test)
const tinyCandles = makeCandles([
  { o: 100, h: 101, l: 99, c: 100.5 },
  { o: 100.5, h: 101.5, l: 99.5, c: 101 },
]);

// ---------------------------------------------------------------------------
// calculateLatestEma
// ---------------------------------------------------------------------------

describe("calculateLatestEma", () => {
  test("returns null when candles array is empty", () => {
    expect(calculateLatestEma([], 20)).toBeNull();
  });

  test("returns null when candles.length < period", () => {
    expect(calculateLatestEma(tinyCandles, 20)).toBeNull();
  });

  test("returns a valid number when candles.length >= period", () => {
    const result = calculateLatestEma(steadyUptrend, 5);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  test("matches the last non-null element from calculateEma result", () => {
    const candles = steadyUptrend;
    const period = 5;

    const latestEmaResult = calculateLatestEma(candles, period);
    const emaSeriesResult = calculateEma(candles, period);

    // Find last non-null from the series
    let expectedEma: number | null = null;
    for (let i = emaSeriesResult.length - 1; i >= 0; i--) {
      if (emaSeriesResult[i] !== null) {
        expectedEma = emaSeriesResult[i];
        break;
      }
    }

    expect(latestEmaResult).toBeCloseTo(expectedEma as number, 5);
  });
});

// ---------------------------------------------------------------------------
// resolveEmaExitDecision
// ---------------------------------------------------------------------------

describe("resolveEmaExitDecision", () => {
  // LONG direction tests
  describe("LONG position", () => {
    test("returns STOP decision when lastClose < emaValue (triggers exit)", () => {
      const result = resolveEmaExitDecision("LONG", 99.5, 100.5, 20);

      expect(result).not.toBeNull();
      expect(result?.decision).toBe("STOP");
      expect(result?.confidence).toBe(95);
      expect(result?.managementAction).toBe("NONE");
      expect(result?.comment).toContain("xuống dưới EMA20");
      expect(result?.comment).toContain("99.50");
      expect(result?.comment).toContain("100.50");
    });

    test("returns null when lastClose >= emaValue (no exit)", () => {
      const result = resolveEmaExitDecision("LONG", 100.5, 99.5, 20);
      expect(result).toBeNull();
    });

    test("returns null when lastClose equals emaValue (no exit)", () => {
      const result = resolveEmaExitDecision("LONG", 100.0, 100.0, 20);
      expect(result).toBeNull();
    });
  });

  // SHORT direction tests
  describe("SHORT position", () => {
    test("returns STOP decision when lastClose > emaValue (triggers exit)", () => {
      const result = resolveEmaExitDecision("SHORT", 101.5, 100.5, 20);

      expect(result).not.toBeNull();
      expect(result?.decision).toBe("STOP");
      expect(result?.confidence).toBe(95);
      expect(result?.managementAction).toBe("NONE");
      expect(result?.comment).toContain("vượt lên trên EMA20");
      expect(result?.comment).toContain("101.50");
      expect(result?.comment).toContain("100.50");
    });

    test("returns null when lastClose <= emaValue (no exit)", () => {
      const result = resolveEmaExitDecision("SHORT", 100.0, 100.5, 20);
      expect(result).toBeNull();
    });

    test("returns null when lastClose equals emaValue (no exit)", () => {
      const result = resolveEmaExitDecision("SHORT", 100.0, 100.0, 20);
      expect(result).toBeNull();
    });
  });

  // Edge cases with null values
  describe("null value handling", () => {
    test("returns null when lastClose is null", () => {
      const result = resolveEmaExitDecision("LONG", null, 100.5, 20);
      expect(result).toBeNull();
    });

    test("returns null when emaValue is null", () => {
      const result = resolveEmaExitDecision("LONG", 99.5, null, 20);
      expect(result).toBeNull();
    });

    test("returns null when both lastClose and emaValue are null", () => {
      const result = resolveEmaExitDecision("LONG", null, null, 20);
      expect(result).toBeNull();
    });
  });

  // Test outcome shape/properties
  describe("outcome shape", () => {
    test("returned decision has all required properties", () => {
      const result = resolveEmaExitDecision("LONG", 99.5, 100.5, 20);

      expect(result).toHaveProperty("decision", "STOP");
      expect(result).toHaveProperty("confidence", 95);
      expect(result).toHaveProperty("comment");
      expect(result).toHaveProperty("managementAction", "NONE");
      expect(Object.keys(result!)).toEqual([
        "decision",
        "confidence",
        "comment",
        "managementAction",
      ]);
    });
  });

  // Test with different periods (comment should reflect period)
  describe("period parameter in comment", () => {
    test("comment includes correct EMA period", () => {
      const result1 = resolveEmaExitDecision("LONG", 99.5, 100.5, 20);
      expect(result1?.comment).toContain("EMA20");

      const result2 = resolveEmaExitDecision("LONG", 99.5, 100.5, 50);
      expect(result2?.comment).toContain("EMA50");

      const result3 = resolveEmaExitDecision("LONG", 99.5, 100.5, 200);
      expect(result3?.comment).toContain("EMA200");
    });
  });

  // Test price formatting in different ranges
  describe("price formatting in comments", () => {
    test("formats small prices correctly", () => {
      const result = resolveEmaExitDecision("LONG", 0.00123, 0.00456, 20);
      expect(result?.comment).toContain("0.00123");
      expect(result?.comment).toContain("0.00456");
    });

    test("formats large prices correctly", () => {
      const result = resolveEmaExitDecision("LONG", 50000.5, 50100.3, 20);
      expect(result?.comment).toContain("50000.50");
      expect(result?.comment).toContain("50100.30");
    });
  });
});
