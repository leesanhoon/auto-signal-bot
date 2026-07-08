import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";

const mocks = vi.hoisted(() => ({
  fetchOhlcHistory: vi.fn(),
  calculateEma: vi.fn(),
  calculateAtr: vi.fn(),
  averageAtr: vi.fn(),
  classifyTrend: vi.fn(),
  isTradableWindow: vi.fn(),
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

vi.mock("../../src/charts/ohlc-provider.js", () => ({
  fetchOhlcHistory: mocks.fetchOhlcHistory,
}));

vi.mock("../../src/charts/indicators.js", () => ({
  calculateEma: mocks.calculateEma,
  calculateAtr: mocks.calculateAtr,
  averageAtr: mocks.averageAtr,
  classifyTrend: mocks.classifyTrend,
  isTradableWindow: mocks.isTradableWindow,
}));

vi.mock("../../src/charts/setups/dd.js", () => ({ detectDd: mocks.detectDd }));
vi.mock("../../src/charts/setups/fb.js", () => ({ detectFb: mocks.detectFb }));
vi.mock("../../src/charts/setups/bb.js", () => ({ detectBb: mocks.detectBb }));
vi.mock("../../src/charts/setups/rb.js", () => ({ detectRb: mocks.detectRb }));
vi.mock("../../src/charts/setups/arb.js", () => ({ detectArb: mocks.detectArb }));
vi.mock("../../src/charts/setups/irb.js", () => ({ detectIrb: mocks.detectIrb }));
vi.mock("../../src/charts/setup-sb-runner.js", () => ({ runSbDetection: mocks.runSbDetection }));
vi.mock("../../src/charts/signal-assembly.js", () => ({
  buildTradeSetupFromSignal: mocks.buildTradeSetupFromSignal,
  buildPairSummaryFromContext: mocks.buildPairSummaryFromContext,
}));
vi.mock("../../src/charts/setup-resolver.js", () => ({
  resolveSetupConflicts: mocks.resolveSetupConflicts,
}));

const { analyzeAllChartsDeterministic } = await import("../../src/charts/deterministic-pipeline.js");

describe("deterministic pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTradableWindow.mockReturnValue(true);
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
    mocks.calculateEma.mockReturnValue([1, 1, 1]);
    mocks.calculateAtr.mockReturnValue([0.5, 0.5, 0.5]);

    const detectedAtLastIndex = vi.fn((_candles: Candle[], i: number) =>
      i === 30
        ? {
            setup: "RB",
            pair: "EUR/USD",
            timeframe: "H4",
            direction: "LONG",
            entry: 1.16,
            stopLoss: 1.0,
            takeProfit1: 1.2,
            takeProfit2: 1.25,
            confidence: 88,
            triggerIndex: i,
            ruleTrace: ["last candle"],
          }
        : null,
    );
    mocks.detectDd.mockReturnValue(null);
    mocks.detectFb.mockReturnValue(null);
    mocks.detectBb.mockReturnValue(null);
    mocks.detectRb.mockImplementation(detectedAtLastIndex);
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
  });
});
