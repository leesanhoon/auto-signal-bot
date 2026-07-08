import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchOhlcHistory: vi.fn(),
  analyzeAllChartsSmc: vi.fn(),
}));

vi.mock("../../../src/charts/ohlc-provider.js", () => ({
  fetchOhlcHistory: mocks.fetchOhlcHistory,
}));

import { analyzeAllChartsSmc } from "../../../src/charts/smc/smc-pipeline.js";
import type { Candle } from "../../../src/charts/ohlc-provider.js";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 100 };
}

const candles: Candle[] = [
  candle(1, 100, 101, 99, 100),
  candle(2, 100, 102, 98, 101),
  candle(3, 101, 105, 100, 104),
  candle(4, 104, 103, 97, 98),
  candle(5, 98, 106, 96, 105),
  candle(6, 105, 108, 103, 107),
  candle(7, 107, 111, 106, 110),
  candle(8, 110, 113, 109, 112),
  candle(9, 112, 116, 111, 115),
  candle(10, 115, 118, 114, 117),
  candle(11, 117, 120, 116, 119),
  candle(12, 119, 122, 118, 121),
  candle(13, 121, 125, 120, 124),
  candle(14, 124, 126, 123, 125),
  candle(15, 125, 128, 124, 127),
  candle(16, 127, 129, 126, 128),
  candle(17, 128, 131, 127, 130),
  candle(18, 130, 134, 129, 133),
  candle(19, 133, 136, 132, 135),
  candle(20, 135, 138, 134, 137),
];

describe("analyzeAllChartsSmc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOhlcHistory.mockResolvedValue(candles);
  });

  test("fetches expected symbol/timeframe/count", async () => {
    await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], { timeframeMode: "single", primaryTimeframe: "M15" });
    expect(mocks.fetchOhlcHistory).toHaveBeenCalledWith("OANDA:XAUUSD", "M15", 200);
  });

  test("no candles becomes skipped/no throw", async () => {
    mocks.fetchOhlcHistory.mockResolvedValue([]);
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }]);
    expect(result.analysisStats?.skippedPairs).toBe(1);
    expect(result.setups).toHaveLength(0);
  });

  test("fixture with bullish structure returns one smc setup", async () => {
    const result = await analyzeAllChartsSmc([{ pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" }], { timeframeMode: "multi" });
    expect(result.setups.length).toBeGreaterThanOrEqual(1);
    expect(result.setups[0].detectionSource).toBe("smc");
  });

  test("analysis stats are populated", async () => {
    const result = await analyzeAllChartsSmc([
      { pair: "XAUTUSDT", symbol: "OANDA:XAUUSD" },
      { pair: "EURUSDT", symbol: "OANDA:EURUSD" },
    ]);
    expect(result.analysisStats).toMatchObject({
      attemptedPairs: 2,
      okPairs: 2,
      noSetupPairs: 0,
      skippedPairs: 0,
      setupCount: result.setups.length,
    });
  });
});
