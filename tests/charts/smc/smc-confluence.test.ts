import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchOhlcHistory: vi.fn(),
}));

vi.mock("../../../src/charts/ohlc-provider.js", () => ({
  fetchOhlcHistory: mocks.fetchOhlcHistory,
}));

import type { Candle } from "../../../src/charts/ohlc-provider.js";
import {
  checkMultiTimeframeConfluence,
  detectTimeframeBias,
} from "../../../src/charts/smc/smc-confluence.js";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 100 };
}

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

const flatCandles: Candle[] = [
  candle(1, 100, 101, 99, 100),
  candle(2, 100, 101, 99, 100),
  candle(3, 100, 101, 99, 100),
  candle(4, 100, 101, 99, 100),
  candle(5, 100, 101, 99, 100),
  candle(6, 100, 101, 99, 100),
  candle(7, 100, 101, 99, 100),
  candle(8, 100, 101, 99, 100),
  candle(9, 100, 101, 99, 100),
  candle(10, 100, 101, 99, 100),
];

describe("detectTimeframeBias", () => {
  test("returns SHORT when recent structure turns bearish", () => {
    expect(detectTimeframeBias(bearishBiasCandles)).toBe("SHORT");
  });

  test("returns null when no clear structure break exists", () => {
    expect(detectTimeframeBias(flatCandles)).toBeNull();
  });
});

describe("checkMultiTimeframeConfluence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns agreementCount 2 when H1 and M30 both agree", async () => {
    mocks.fetchOhlcHistory.mockImplementation(async (_symbol: string, timeframe: string) => {
      if (timeframe === "H1" || timeframe === "M30") return bearishBiasCandles;
      return new Error("unexpected timeframe");
    });

    const result = await checkMultiTimeframeConfluence("OANDA:XAUUSD", "SHORT");
    expect(result).toEqual({
      agreementCount: 2,
      biases: [
        { timeframe: "H1", direction: "SHORT" },
        { timeframe: "M30", direction: "SHORT" },
      ],
      agreeingTimeframes: ["H1", "M30"],
    });
  });

  test("does not throw when one timeframe fetch fails", async () => {
    mocks.fetchOhlcHistory.mockImplementation(async (_symbol: string, timeframe: string) => {
      if (timeframe === "H1") return new Error("network error");
      if (timeframe === "M30") return bearishBiasCandles;
      return new Error("unexpected timeframe");
    });

    const result = await checkMultiTimeframeConfluence("OANDA:XAUUSD", "SHORT");
    expect(result).toEqual({
      agreementCount: 1,
      biases: [
        { timeframe: "H1", direction: null },
        { timeframe: "M30", direction: "SHORT" },
      ],
      agreeingTimeframes: ["M30"],
    });
  });
});
