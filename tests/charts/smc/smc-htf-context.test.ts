import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchOhlcHistory: vi.fn(),
}));

vi.mock("../../../src/charts/ohlc-provider.js", () => ({
  fetchOhlcHistory: mocks.fetchOhlcHistory,
}));

import type { Candle } from "../../../src/charts/ohlc-provider.js";
import {
  buildHtfContext,
  buildRollingHtfContexts,
  computeHtfContextFromCandles,
  getHtfTimeframeFor,
  type HtfContext,
} from "../../../src/charts/smc/smc-htf-context.js";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 100 };
}

const bullishBiasCandles: Candle[] = [
  candle(1, 100, 102, 98, 100),
  candle(2, 100, 103, 99, 101),
  candle(3, 101, 105, 100, 104),
  candle(4, 104, 106, 102, 103),
  candle(5, 103, 104, 100, 101),
  candle(6, 101, 105, 100, 104),
  candle(7, 104, 108, 103, 107),
  candle(8, 107, 112, 106, 111),
  candle(9, 111, 116, 110, 115),
  candle(10, 115, 125, 114, 124),
];

const bearishBiasCandles: Candle[] = [
  candle(1, 100, 101, 99, 100),
  candle(2, 100, 103, 99, 102),
  candle(3, 102, 106, 101, 105),
  candle(4, 105, 104, 100, 101),
  candle(5, 101, 102, 97, 99),
  candle(6, 99, 101, 99, 100),
  candle(7, 100, 102, 100, 101),
  candle(8, 101, 102, 96, 96),
  candle(9, 96, 98, 95, 97),
  candle(10, 97, 99, 96, 98),
];

describe("getHtfTimeframeFor", () => {
  test("M15 maps to H4", () => {
    expect(getHtfTimeframeFor("M15")).toBe("H4");
  });

  test("H4 maps to D1", () => {
    expect(getHtfTimeframeFor("H4")).toBe("D1");
  });

  test("D1 returns null (no higher timeframe)", () => {
    expect(getHtfTimeframeFor("D1")).toBeNull();
  });
});

describe("computeHtfContextFromCandles", () => {
  test("returns valid HtfContext with LONG bias and swings from bullish candles", () => {
    const context = computeHtfContextFromCandles("H4", bullishBiasCandles);
    expect(context).not.toBeNull();
    expect(context!.timeframe).toBe("H4");
    expect(context!.bias).toBe("LONG");
    expect(context!.swings.length).toBeGreaterThan(0);
    expect(context!.candlesLength).toBe(10);
  });

  test("returns valid HtfContext with SHORT bias and swings from bearish candles", () => {
    const context = computeHtfContextFromCandles("H4", bearishBiasCandles);
    expect(context).not.toBeNull();
    expect(context!.timeframe).toBe("H4");
    expect(context!.bias).toBe("SHORT");
    expect(context!.swings.length).toBeGreaterThan(0);
    expect(context!.candlesLength).toBe(10);
  });

  test("returns null when candles array is empty", () => {
    const context = computeHtfContextFromCandles("H4", []);
    expect(context).toBeNull();
  });
});

describe("buildHtfContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("calls fetchOhlcHistory with H4 timeframe when entryTimeframe is M15", async () => {
    mocks.fetchOhlcHistory.mockResolvedValue(bullishBiasCandles);

    const context = await buildHtfContext("EURUSD", "M15", 200);

    expect(mocks.fetchOhlcHistory).toHaveBeenCalledWith("EURUSD", "H4", 200);
    expect(context).not.toBeNull();
    expect(context!.timeframe).toBe("H4");
  });

  test("calls fetchOhlcHistory with D1 timeframe when entryTimeframe is H4", async () => {
    mocks.fetchOhlcHistory.mockResolvedValue(bullishBiasCandles);

    const context = await buildHtfContext("EURUSD", "H4", 200);

    expect(mocks.fetchOhlcHistory).toHaveBeenCalledWith("EURUSD", "D1", 200);
    expect(context).not.toBeNull();
    expect(context!.timeframe).toBe("D1");
  });

  test("returns null and does not call fetchOhlcHistory when entryTimeframe is D1", async () => {
    const context = await buildHtfContext("EURUSD", "D1", 200);

    expect(mocks.fetchOhlcHistory).not.toHaveBeenCalled();
    expect(context).toBeNull();
  });

  test("returns null when fetchOhlcHistory returns an Error", async () => {
    mocks.fetchOhlcHistory.mockResolvedValue(new Error("Network error"));

    const context = await buildHtfContext("EURUSD", "M15", 200);

    expect(context).toBeNull();
  });

  test("returns valid HtfContext with correct data from successful fetch", async () => {
    mocks.fetchOhlcHistory.mockResolvedValue(bullishBiasCandles);

    const context = await buildHtfContext("EURUSD", "M15", 200);

    expect(context).not.toBeNull();
    expect(context!.timeframe).toBe("H4");
    expect(context!.bias).toBe("LONG");
    expect(context!.candlesLength).toBe(10);
  });
});

describe("buildRollingHtfContexts", () => {
  const D1_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const H4_INTERVAL_MS = 4 * 60 * 60 * 1000;

  test("look-ahead prevention: entry candle BEFORE D1 closes should not include that D1 candle", () => {
    const d1Candle = candle(1000, 100, 105, 99, 102);
    const htfCandles = [d1Candle];

    const entryCandle = candle(1000 + 2 * H4_INTERVAL_MS, 100, 101, 99, 100);
    const entryCandles = [entryCandle];

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results.length).toBe(1);
    expect(results[0]).toBeNull();
  });

  test("entry candle at exact D1 close time should include that D1 candle", () => {
    const d1Candle = candle(1000, 100, 105, 99, 102);
    const htfCandles = [d1Candle];

    const entryCandle = candle(1000 + D1_INTERVAL_MS, 100, 101, 99, 100);
    const entryCandles = [entryCandle];

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results.length).toBe(1);
    expect(results[0]).not.toBeNull();
    expect(results[0]!.candlesLength).toBe(1);
  });

  test("entry candle after D1 closes should include that D1 candle", () => {
    const d1Candle = candle(1000, 100, 105, 99, 102);
    const htfCandles = [d1Candle];

    const entryCandle = candle(1000 + D1_INTERVAL_MS + 1000, 100, 101, 99, 100);
    const entryCandles = [entryCandle];

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results.length).toBe(1);
    expect(results[0]).not.toBeNull();
    expect(results[0]!.candlesLength).toBe(1);
  });

  test("multiple entry candles within same unclosed D1 should share same context (null)", () => {
    const d1Candle = candle(1000, 100, 105, 99, 102);
    const htfCandles = [d1Candle];

    const entryCandles = [
      candle(1000 + H4_INTERVAL_MS, 100, 101, 99, 100),
      candle(1000 + 2 * H4_INTERVAL_MS, 100, 101, 99, 100),
      candle(1000 + 3 * H4_INTERVAL_MS, 100, 101, 99, 100),
    ];

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results.length).toBe(3);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).toBeNull();
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
  });

  test("cache is reused when boundary doesn't change between consecutive entries", () => {
    const d1Candles = [candle(1000, 100, 105, 99, 102), candle(1000 + D1_INTERVAL_MS, 102, 107, 101, 104)];
    const htfCandles = d1Candles;

    const entryCandles = [
      candle(1000 + D1_INTERVAL_MS + 1000, 100, 101, 99, 100),
      candle(1000 + D1_INTERVAL_MS + 2000, 100, 101, 99, 100),
    ];

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results.length).toBe(2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();
    expect(results[0]).toBe(results[1]);
    expect(results[0]!.candlesLength).toBe(1);
  });

  test("cache is updated when boundary changes (new D1 candle closes)", () => {
    const d1Candles = [candle(1000, 100, 105, 99, 102), candle(1000 + D1_INTERVAL_MS, 102, 107, 101, 104)];
    const htfCandles = d1Candles;

    const entryCandles = [
      candle(1000 + D1_INTERVAL_MS + 1000, 100, 101, 99, 100),
      candle(1000 + 2 * D1_INTERVAL_MS + 1000, 100, 101, 99, 100),
    ];

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results.length).toBe(2);
    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();
    expect(results[0]).not.toBe(results[1]);
    expect(results[0]!.candlesLength).toBe(1);
    expect(results[1]!.candlesLength).toBe(2);
  });

  test("empty entry candles returns empty results array", () => {
    const htfCandles = [candle(1000, 100, 105, 99, 102)];
    const entryCandles: Candle[] = [];

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results).toEqual([]);
  });

  test("empty HTF candles returns all null contexts", () => {
    const htfCandles: Candle[] = [];
    const entryCandles = [
      candle(1000, 100, 101, 99, 100),
      candle(2000, 100, 101, 99, 100),
    ];

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results.length).toBe(2);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
  });

  test("realistic case: 15 D1 candles with bullish bias and 40 H4 entries shows progression", () => {
    const d1Candles = [
      candle(1000, 100, 102, 98, 100),
      candle(2000, 100, 103, 99, 101),
      candle(3000, 101, 105, 100, 104),
      candle(4000, 104, 106, 102, 103),
      candle(5000, 103, 104, 100, 101),
      candle(6000, 101, 105, 100, 104),
      candle(7000, 104, 108, 103, 107),
      candle(8000, 107, 112, 106, 111),
      candle(9000, 111, 116, 110, 115),
      candle(10000, 115, 125, 114, 124),
      candle(11000, 124, 130, 123, 129),
      candle(12000, 129, 135, 128, 133),
      candle(13000, 133, 140, 132, 138),
      candle(14000, 138, 145, 137, 143),
      candle(15000, 143, 150, 142, 148),
    ];
    const htfCandles = d1Candles;

    const entryCandles: Candle[] = [];
    for (let i = 0; i < 40; i += 1) {
      const time = 1000 + i * H4_INTERVAL_MS;
      entryCandles.push(candle(time, 100 + i * 0.5, 101 + i * 0.5, 99 + i * 0.5, 100 + i * 0.5));
    }

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results.length).toBe(40);

    const firstNullCount = results.filter((r) => r === null).length;
    expect(firstNullCount).toBeGreaterThan(0);

    const contextsWithBias = results.filter((r) => r !== null && r.bias !== null);
    expect(contextsWithBias.length).toBeGreaterThan(0);

    const lastContext = results[results.length - 1];
    expect(lastContext).not.toBeNull();
    expect(lastContext!.candlesLength).toBe(15);
    expect(lastContext!.bias).toBe("LONG");
  });

  test("respects H4 interval for entry timeframe H4 with D1 HTF", () => {
    const d1TimeMs = 1000;
    const d1Candle = candle(d1TimeMs, 100, 105, 99, 102);

    const entryCandles = [
      candle(d1TimeMs + H4_INTERVAL_MS, 100, 101, 99, 100),
      candle(d1TimeMs + 2 * H4_INTERVAL_MS, 100, 101, 99, 100),
      candle(d1TimeMs + 3 * H4_INTERVAL_MS, 100, 101, 99, 100),
      candle(d1TimeMs + 4 * H4_INTERVAL_MS, 100, 101, 99, 100),
      candle(d1TimeMs + 5 * H4_INTERVAL_MS, 100, 101, 99, 100),
      candle(d1TimeMs + D1_INTERVAL_MS, 100, 101, 99, 100),
      candle(d1TimeMs + D1_INTERVAL_MS + H4_INTERVAL_MS, 100, 101, 99, 100),
    ];

    const results = buildRollingHtfContexts("D1", [d1Candle], entryCandles);

    for (let i = 0; i < 5; i += 1) {
      expect(results[i]).toBeNull();
    }
    expect(results[5]).not.toBeNull();
    expect(results[5]!.candlesLength).toBe(1);
    expect(results[6]).not.toBeNull();
    expect(results[6]!.candlesLength).toBe(1);
  });

  test("two-pointer efficiency: does not recalculate for sorted inputs", () => {
    const d1Candles = [
      candle(1000, 100, 105, 99, 102),
      candle(2000, 102, 107, 101, 104),
      candle(3000, 104, 110, 103, 108),
    ];
    const htfCandles = d1Candles;

    const entryCandles: Candle[] = [];
    for (let i = 0; i < 15; i += 1) {
      entryCandles.push(candle(1000 + i * H4_INTERVAL_MS, 100, 101, 99, 100));
    }

    const results = buildRollingHtfContexts("D1", htfCandles, entryCandles);

    expect(results.length).toBe(15);
    let contextTransitions = 0;
    for (let i = 1; i < results.length; i += 1) {
      if (results[i] !== results[i - 1]) {
        contextTransitions += 1;
      }
    }

    expect(contextTransitions).toBeLessThanOrEqual(3);
  });
});
