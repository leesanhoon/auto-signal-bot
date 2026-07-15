import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Candle } from "../../src/charts/client/ohlc-provider.js";

const mocks = vi.hoisted(() => ({
  fetchOhlcHistory: vi.fn(),
  calculateEma: vi.fn(),
  calculateAtr: vi.fn(),
  averageAtr: vi.fn(),
  classifyTrend: vi.fn(),
  detectDd: vi.fn(),
  detectFb: vi.fn(),
  detectBb: vi.fn(),
  detectRb: vi.fn(),
  detectArb: vi.fn(),
  detectIrb: vi.fn(),
  runSbDetection: vi.fn(),
  buildTradeSetupFromSignal: vi.fn(),
  buildPairSummaryFromContext: vi.fn(),
  resolveSetupConflicts: vi.fn(),
}));

vi.mock("../../src/charts/client/ohlc-provider.js", () => ({
  fetchOhlcHistory: mocks.fetchOhlcHistory,
}));

vi.mock("../../src/charts/service/indicators.js", () => ({
  calculateEma: mocks.calculateEma,
  calculateAtr: mocks.calculateAtr,
  averageAtr: mocks.averageAtr,
  classifyTrend: mocks.classifyTrend,
}));

vi.mock("../../src/charts/service/setups/dd.js", () => ({ detectDd: mocks.detectDd }));
vi.mock("../../src/charts/service/setups/fb.js", () => ({ detectFb: mocks.detectFb }));
vi.mock("../../src/charts/service/setups/bb.js", () => ({ detectBb: mocks.detectBb }));
vi.mock("../../src/charts/service/setups/rb.js", () => ({ detectRb: mocks.detectRb }));
vi.mock("../../src/charts/service/setups/arb.js", () => ({ detectArb: mocks.detectArb }));
vi.mock("../../src/charts/service/setups/irb.js", () => ({ detectIrb: mocks.detectIrb }));
vi.mock("../../src/charts/setup-sb-runner.js", () => ({ runSbDetection: mocks.runSbDetection }));
vi.mock("../../src/charts/service/signal-assembly.js", () => ({
  buildTradeSetupFromSignal: mocks.buildTradeSetupFromSignal,
  buildPairSummaryFromContext: mocks.buildPairSummaryFromContext,
}));
vi.mock("../../src/charts/service/setup-resolver.js", () => ({
  resolveSetupConflicts: mocks.resolveSetupConflicts,
}));

const { analyzeAllChartsDeterministic } = await import("../../src/charts/service/deterministic-pipeline.js");

describe("deterministic pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.averageAtr.mockReturnValue(1);
    mocks.classifyTrend.mockReturnValue("UPTREND");
    mocks.runSbDetection.mockImplementation((_candles, signals) => ({ resolved: signals }));
    mocks.resolveSetupConflicts.mockImplementation((signals) => signals);
    mocks.buildPairSummaryFromContext.mockImplementation((pair) => ({
      pair,
      trend: "Tăng",
      emaProximity: "gần",
      status: "Có setup chờ xác nhận",
      confidence: 70,
    }));
    mocks.buildTradeSetupFromSignal.mockImplementation((signal) => ({
      pair: signal.pair,
      direction: signal.direction,
      setup: signal.setup,
      reasons: [],
      risks: [],
      confidence: signal.confidence,
      entry: "1.0000",
      stopLoss: "0.9990",
      takeProfit1: "1.0010",
      takeProfit2: "1.0020",
      riskReward: "1:1",
      summary: "test",
      orderType: "BUY_STOP",
      primaryTimeframe: signal.timeframe,
    }));
  });

  test("anchors detectors on the last closed candle returned by fetchOhlcHistory", async () => {
    const candles: Candle[] = Array.from({ length: 31 }, (_, i) => ({
      time: (i + 1) * 1000,
      open: 1 + i * 0.001,
      high: 1.1 + i * 0.001,
      low: 0.9 + i * 0.001,
      close: 1.05 + i * 0.001,
      volume: 10 + i,
    }));
    mocks.fetchOhlcHistory.mockResolvedValue(candles);
    mocks.calculateEma.mockReturnValue(candles.map(() => 1));
    mocks.calculateAtr.mockReturnValue(candles.map(() => 0.5));

    const detectedAtLastIndex = vi.fn((_candles: Candle[], i: number) =>
      i === 30
        ? {
            setup: "BB",
            pair: "EUR/USD",
            timeframe: "H4",
            direction: "LONG",
            entry: 1.16,
            stopLoss: 1.0,
            takeProfit: 1.32,
            confidence: 88,
            triggerIndex: i,
            ruleTrace: ["last candle"],
          }
        : null,
    );
    mocks.detectDd.mockReturnValue(null);
    mocks.detectFb.mockReturnValue(null);
    mocks.detectBb.mockImplementation(detectedAtLastIndex);
    mocks.detectRb.mockReturnValue(null);
    mocks.detectArb.mockReturnValue(null);
    mocks.detectIrb.mockReturnValue(null);

    const result = await analyzeAllChartsDeterministic([{ pair: "EUR/USD", symbol: "OANDA:EURUSD" }], {
      timeframeMode: "single",
      primaryTimeframe: "H4",
    });

    expect(mocks.fetchOhlcHistory).toHaveBeenCalledWith("OANDA:EURUSD", "H4", 200);
    expect(detectedAtLastIndex).toHaveBeenCalledWith(candles, 30, expect.any(Object));
    expect(result.setups).toHaveLength(1);
    expect(result.setups[0].pair).toBe("EUR/USD");
    expect(result.summaries[0].pair).toBe("EUR/USD");
    expect(result.analysisStats).toEqual({
      attemptedPairs: 1,
      okPairs: 1,
      noSetupPairs: 0,
      skippedPairs: 0,
      setupCount: 1,
    });
  });

  test("only scans the single most recently closed candle (lookback = 1)", async () => {
    const candles: Candle[] = Array.from({ length: 41 }, (_, i) => ({
      time: (i + 1) * 1000,
      open: 1 + i * 0.001,
      high: 1.1 + i * 0.001,
      low: 0.9 + i * 0.001,
      close: 1.05 + i * 0.001,
      volume: 10 + i,
    }));
    mocks.fetchOhlcHistory.mockResolvedValue(candles);
    mocks.calculateEma.mockReturnValue(candles.map(() => 1));
    mocks.calculateAtr.mockReturnValue(candles.map(() => 0.5));

    const scannedIndices: number[] = [];
    const recordIndex = vi.fn((_candles: Candle[], i: number) => {
      scannedIndices.push(i);
      return null;
    });
    mocks.detectDd.mockImplementation(recordIndex);
    mocks.detectFb.mockImplementation(recordIndex);
    mocks.detectBb.mockImplementation(recordIndex);
    mocks.detectRb.mockImplementation(recordIndex);
    mocks.detectArb.mockImplementation(recordIndex);
    mocks.detectIrb.mockImplementation(recordIndex);

    await analyzeAllChartsDeterministic([{ pair: "EUR/USD", symbol: "OANDA:EURUSD" }], {
      timeframeMode: "single",
      primaryTimeframe: "H4",
    });

    // lastIndex is 40 (41 candles, 0-based). Only index 40 should ever be scanned.
    // This distinguishes from the old formula Math.max(30, lastIndex - 5) = Math.max(30, 35) = 35,
    // which would have scanned indices 35-40 (6 candles total).
    expect(new Set(scannedIndices)).toEqual(new Set([40]));
  });

  test("records skippedPairs when runtime filter rejects a pair", async () => {
    const candles: Candle[] = Array.from({ length: 31 }, (_, i) => ({
      time: (i + 1) * 1000,
      open: 1 + i * 0.001,
      high: 1.1 + i * 0.001,
      low: 0.9 + i * 0.001,
      close: 1.05 + i * 0.001,
      volume: 10 + i,
    }));
    mocks.fetchOhlcHistory.mockResolvedValue(candles);
    mocks.calculateEma.mockReturnValue(candles.map(() => 1));
    mocks.calculateAtr.mockReturnValue(candles.map(() => 0.1));
    mocks.averageAtr.mockReturnValue(1); // ATR floor = 0.3 * 1 = 0.3 > atrLast (0.1) -> reject
    mocks.detectDd.mockReturnValue(null);
    mocks.detectFb.mockReturnValue(null);
    mocks.detectBb.mockReturnValue(null);
    mocks.detectRb.mockReturnValue(null);
    mocks.detectArb.mockReturnValue(null);
    mocks.detectIrb.mockReturnValue(null);

    const result = await analyzeAllChartsDeterministic([{ pair: "EUR/USD", symbol: "OANDA:EURUSD" }], {
      timeframeMode: "single",
      primaryTimeframe: "H4",
    });

    expect(result.summaries).toHaveLength(0);
    expect(result.setups).toHaveLength(0);
    expect(result.noSetupReason).toContain("ATR data chua du hoac ngoai khung giao dich hop le");
    expect(result.analysisStats).toEqual({
      attemptedPairs: 1,
      okPairs: 0,
      noSetupPairs: 0,
      skippedPairs: 1,
      setupCount: 0,
    });
  });
});
