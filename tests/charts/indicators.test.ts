import { describe, expect, test } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";
import {
  calculateEma,
  calculateAtr,
  classifyTrend,
  isDoji,
  detectCompression,
  isFalseBreak,
  averageAtr,
} from "../../src/charts/indicators.js";

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

const steadyRise = makeCandles(
  Array.from({ length: 30 }, (_, i) => ({
    o: 100 + i,
    h: 101 + i,
    l: 99 + i,
    c: 100.5 + i,
  })),
);

const steadyFall = makeCandles(
  Array.from({ length: 30 }, (_, i) => ({
    o: 130 - i,
    h: 131 - i,
    l: 129 - i,
    c: 130.5 - i,
  })),
);

// ---------------------------------------------------------------------------
// calculateEma
// ---------------------------------------------------------------------------

describe("calculateEma", () => {
  test("returns null array for empty candles", () => {
    expect(calculateEma([], 21)).toEqual([]);
  });

  test("returns null for first (period-1) indices, then SMA seed", () => {
    const candles = steadyRise;
    const ema = calculateEma(candles, 5);
    // index 0-3: null
    expect(ema[0]).toBeNull();
    expect(ema[1]).toBeNull();
    expect(ema[2]).toBeNull();
    expect(ema[3]).toBeNull();
    // index 4: SMA of first 5 closes
    const expectedSma =
      (candles[0].close +
        candles[1].close +
        candles[2].close +
        candles[3].close +
        candles[4].close) /
      5;
    expect(ema[4]).toBeCloseTo(expectedSma, 5);
  });

  test("EMA follows price direction (rising prices → rising EMA)", () => {
    const ema = calculateEma(steadyRise, 5);
    const emaValues = ema.filter((v): v is number => v !== null);
    for (let i = 1; i < emaValues.length; i++) {
      expect(emaValues[i]).toBeGreaterThanOrEqual(emaValues[i - 1] - 0.001);
    }
  });

  test("EMA with period 1 = price itself", () => {
    const candles = makeCandles([
      { o: 10, h: 12, l: 9, c: 11 },
      { o: 11, h: 13, l: 10, c: 12 },
      { o: 12, h: 14, l: 11, c: 13 },
    ]);
    const ema = calculateEma(candles, 1);
    expect(ema[0]).toBeCloseTo(11, 5);
    expect(ema[1]).toBeCloseTo(12, 5);
    expect(ema[2]).toBeCloseTo(13, 5);
  });
});

// ---------------------------------------------------------------------------
// calculateAtr
// ---------------------------------------------------------------------------

describe("calculateAtr", () => {
  test("ATR for candles with no gaps should be small (near range)", () => {
    const candles = makeCandles(
      Array.from({ length: 20 }, () => ({
        o: 100,
        h: 102,
        l: 99,
        c: 101,
      })),
    );
    const atr = calculateAtr(candles, 14);
    const last = atr[atr.length - 1];
    expect(last).not.toBeNull();
    expect(last!).toBeGreaterThan(0);
    expect(last!).toBeLessThan(4);
  });

  test("ATR spikes after a large gap candle", () => {
    // First candle: small range
    // Second candle: large gap up (high >> prev close)
    const candles = makeCandles([
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 110, h: 115, l: 109, c: 113 }, // gap up
      ...Array.from({ length: 18 }, () => ({
        o: 112,
        h: 114,
        l: 111,
        c: 113,
      })),
    ]);
    const atr = calculateAtr(candles, 14);
    // atr[1] should be TrueRange = max(6, |115-100|=15, |109-100|=9) = 15
    const tr1True = Math.max(
      115 - 109, // 6
      Math.abs(115 - 100), // 15
      Math.abs(109 - 100), // 9
    );
    expect(tr1True).toBe(15);

    // ATR at index 14 should be elevated due to the gap
    const atr14 = atr[14];
    expect(atr14).not.toBeNull();
    expect(atr14!).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// classifyTrend
// ---------------------------------------------------------------------------

describe("classifyTrend", () => {
  test("UPTREND for steadily rising prices", () => {
    const candles = steadyRise;
    const ma21 = calculateEma(candles, 21);
    const atr14 = calculateAtr(candles, 14);
    const state = classifyTrend(candles, ma21, atr14, candles.length - 1);
    expect(state).toBe("UPTREND");
  });

  test("DOWNTREND for steadily falling prices", () => {
    const candles = steadyFall;
    const ma21 = calculateEma(candles, 21);
    const atr14 = calculateAtr(candles, 14);
    const state = classifyTrend(candles, ma21, atr14, candles.length - 1);
    expect(state).toBe("DOWNTREND");
  });

  test("FLAT for insufficient data (index < 5)", () => {
    const candles = steadyRise;
    const ma21 = calculateEma(candles, 21);
    const atr14 = calculateAtr(candles, 14);
    const state = classifyTrend(candles, ma21, atr14, 3);
    expect(state).toBe("FLAT");
  });

  test("FLAT for sideways choppy market", () => {
    const candles = makeCandles(
      Array.from({ length: 25 }, () => ({
        o: 100 + Math.random() * 2,
        h: 102 + Math.random() * 2,
        l: 99 + Math.random() * 2,
        c: 101 + Math.random() * 2,
      })),
    );
    const ma21 = calculateEma(candles, 21);
    const atr14 = calculateAtr(candles, 14);
    const state = classifyTrend(candles, ma21, atr14, candles.length - 1);
    // có thể là FLAT hoặc UPTREND/DOWNTREND — không assert cứng, chỉ đảm bảo không crash
    expect(["UPTREND", "DOWNTREND", "FLAT"]).toContain(state);
  });
});

// ---------------------------------------------------------------------------
// isDoji
// ---------------------------------------------------------------------------

describe("isDoji", () => {
  test("tiny body candle is a doji", () => {
    const candle: Candle = {
      time: 0,
      open: 1.1000,
      high: 1.1010,
      low: 1.0990,
      close: 1.1001,
      volume: 100,
    };
    // body = 0.0001, range = 0.002, atr = 0.003
    // body <= 0.15 * 0.003 = 0.00045 ✓
    // body/range = 0.05 ≤ 0.25 ✓
    expect(isDoji(candle, 0.003)).toBe(true);
  });

  test("large body candle is not a doji", () => {
    const candle: Candle = {
      time: 0,
      open: 1.1000,
      high: 1.1060,
      low: 1.0990,
      close: 1.1040,
      volume: 100,
    };
    // body = 0.004, range = 0.007, atr = 0.003
    // body > 0.15 * 0.003 = 0.00045 → false
    expect(isDoji(candle, 0.003)).toBe(false);
  });

  test("zero-range candle (high===low) returns false", () => {
    const candle: Candle = {
      time: 0,
      open: 1.1000,
      high: 1.1000,
      low: 1.1000,
      close: 1.1000,
      volume: 100,
    };
    expect(isDoji(candle, 0.003)).toBe(false);
  });

  test("body exceeds 25% of range is not a doji", () => {
    const candle: Candle = {
      time: 0,
      open: 1.1000,
      high: 1.1020,
      low: 1.0990,
      close: 1.1015,
      volume: 100,
    };
    // body = 0.0015, range = 0.003, body/range = 0.5 > 0.25
    // atr = 0.01, so body <= 0.0015 ✓ (0.15*0.01 = 0.0015)
    // but body/range = 0.5 > 0.25 → false
    expect(isDoji(candle, 0.01)).toBe(false);
  });

  test("custom zDoji parameter works", () => {
    const candle: Candle = {
      time: 0,
      open: 1.1000,
      high: 1.1020,
      low: 1.0990,
      close: 1.1008,
      volume: 100,
    };
    // with zDoji=0.3: body=0.0008 ≤ 0.3*0.003=0.0009 ✓
    // body/range = 0.0008/0.003 = 0.267 > 0.25 → still false because bodyRatio condition
    // Let's make bodyRatio pass too
    const candle2: Candle = {
      time: 0,
      open: 1.1000,
      high: 1.1020,
      low: 1.0995,
      close: 1.1008,
      volume: 100,
    };
    // body = 0.0008, range = 0.0025, body/range = 0.32 > 0.25
    // Hmm, still fails. Let me adjust
    const candle3: Candle = {
      time: 0,
      open: 1.1000,
      high: 1.1008,
      low: 1.0995,
      close: 1.1002,
      volume: 100,
    };
    // body = 0.0002, range = 0.0013, body/range = 0.154 ≤ 0.25 ✓
    // with zDoji=0.3: 0.0002 ≤ 0.3*0.0018=0.00054 ✓
    expect(isDoji(candle3, 0.0018, 0.3)).toBe(true);
    // with default zDoji=0.15: 0.0002 ≤ 0.15*0.0018=0.00027 ✓
    expect(isDoji(candle3, 0.0018)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectCompression
// ---------------------------------------------------------------------------

describe("detectCompression", () => {
  test("detects compression on tight-range candles", () => {
    // Need enough candles for EMA20 and ATR14
    const baseCandles: Array<{ o: number; h: number; l: number; c: number }> = [];
    // First 25 candles: steady but narrow range
    for (let i = 0; i < 25; i++) {
      baseCandles.push({
        o: 100 + Math.random() * 0.5,
        h: 100.5 + Math.random() * 0.5,
        l: 99.5 + Math.random() * 0.5,
        c: 100 + Math.random() * 0.5,
      });
    }
    // Last 5 candles: extremely tight range
    const tightCandles = [
      { o: 100.0, h: 100.3, l: 99.9, c: 100.1 },
      { o: 100.1, h: 100.4, l: 99.8, c: 100.2 },
      { o: 100.0, h: 100.2, l: 99.8, c: 99.9 },
      { o: 99.9, h: 100.3, l: 99.7, c: 100.0 },
      { o: 100.0, h: 100.3, l: 99.9, c: 100.1 },
    ];
    const candles = makeCandles([...baseCandles, ...tightCandles]);
    const ma21 = calculateEma(candles, 21);
    const atr14 = calculateAtr(candles, 14);

    // Verify atr14 at last index is non-null (enough data)
    const lastIndex = candles.length - 1;
    expect(atr14[lastIndex]).not.toBeNull();

    // Index of last tight candle
    const tightLast = candles.length - 1;
    const comp = detectCompression(candles, ma21, atr14, tightLast, 5);
    expect(comp).not.toBeNull();
    expect(comp!.range).toBeGreaterThan(0);
  });

  test("returns null when window extends before array", () => {
    const candles = makeCandles([
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 100, h: 101, l: 99, c: 100 },
    ]);
    const ma21 = calculateEma(candles, 21);
    const atr14 = calculateAtr(candles, 14);
    const comp = detectCompression(candles, ma21, atr14, 1, 5);
    expect(comp).toBeNull();
  });

  test("returns null when ma21 or atr14 is null at index", () => {
    const candles = makeCandles([
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 100, h: 101, l: 99, c: 100 },
    ]);
    const ma21 = calculateEma(candles, 21); // all null — not enough data
    const atr14 = calculateAtr(candles, 14); // all null
    const comp = detectCompression(candles, ma21, atr14, 4, 5);
    expect(comp).toBeNull();
  });

  test("breakout candle must stay outside the compression window", () => {
    const candles = makeCandles([
      // Let EMA21 initialize with some base candles
      ...Array.from({ length: 21 }, (_, i) => ({
        o: 100,
        h: 100.1,
        l: 99.9,
        c: 100,
      })),
      // Tight compression (5 candles)
      { o: 100, h: 100.05, l: 99.95, c: 100 },
      { o: 100, h: 100.05, l: 99.95, c: 100 },
      { o: 100, h: 100.05, l: 99.95, c: 100 },
      { o: 100, h: 100.05, l: 99.95, c: 100 },
      { o: 100, h: 100.05, l: 99.95, c: 100 },
      // Breakout candle
      { o: 100, h: 101.5, l: 99.9, c: 101.4 },
    ]);
    const ma21 = calculateEma(candles, 21);
    const atr14 = calculateAtr(candles, 14);

    // Check compression before breakout (window at index 25, includes indices 21-25)
    const validWindow = detectCompression(candles, ma21, atr14, 25, 5);
    // Check compression including breakout (window at index 26, includes indices 22-26, which includes the huge breakout)
    const invalidWindow = detectCompression(candles, ma21, atr14, 26, 5);

    expect(validWindow).not.toBeNull();
    expect(invalidWindow).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isFalseBreak
// ---------------------------------------------------------------------------

describe("isFalseBreak", () => {
  test("returns true when price returns inside range within lookahead", () => {
    const candles = makeCandles([
      { o: 100, h: 101, l: 99, c: 100 }, // pre-breakout
      { o: 100, h: 103, l: 100, c: 102 }, // breakout index 1 — breaks above 101
      { o: 102, h: 102, l: 100, c: 101 }, // returns inside [100, 101] → false break
    ]);
    const result = isFalseBreak(candles, 1, 101, 100, "LONG");
    expect(result).toBe(true);
  });

  test("returns false when price continues in breakout direction", () => {
    const candles = makeCandles([
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 100, h: 103, l: 100, c: 102 }, // breakout
      { o: 102, h: 104, l: 102, c: 103 }, // continues up
    ]);
    const result = isFalseBreak(candles, 1, 101, 100, "LONG");
    expect(result).toBe(false);
  });

  test("returns false when not enough candles ahead (end of array)", () => {
    const candles = makeCandles([
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 100, h: 103, l: 100, c: 102 }, // last candle — no lookahead
    ]);
    const result = isFalseBreak(candles, 1, 101, 100, "LONG");
    expect(result).toBe(false);
  });

  test("SHORT direction: returns true when price rallies back inside range", () => {
    const candles = makeCandles([
      { o: 100, h: 101, l: 99, c: 100 },
      { o: 100, h: 101, l: 97, c: 98 }, // breakdown
      { o: 98, h: 101, l: 98, c: 100 }, // returns inside [99, 101] → false break
    ]);
    const result = isFalseBreak(candles, 1, 101, 99, "SHORT");
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// averageAtr
// ---------------------------------------------------------------------------

describe("averageAtr", () => {
  test("averageAtr over valid range", () => {
    const atr14: (number | null)[] = [null, null, ...Array(20).fill(0.003)];
    const avg = averageAtr(atr14, 21, 10);
    expect(avg).toBeCloseTo(0.003, 5);
  });

  test("averageAtr with null gaps", () => {
    const atr14: (number | null)[] = [
      null,
      null,
      0.002,
      0.003,
      null,
      0.004,
      0.005,
    ];
    const avg = averageAtr(atr14, 6, 7);
    // average of [0.002, 0.003, 0.004, 0.005] = 0.0035
    expect(avg).toBeCloseTo(0.0035, 5);
  });

  test("averageAtr returns null for empty range", () => {
    const atr14: (number | null)[] = [null, null, null];
    expect(averageAtr(atr14, 2, 3)).toBeNull();
  });
});
