import { beforeEach, describe, expect, test, vi } from "vitest";
import { getChartScannerErrorScope } from "../../src/charts/index.js";

// ============================================================
// Mock state (vi.hoisted — runs before factory functions)
// ============================================================
const mocks = vi.hoisted(() => ({
  captureAllCharts: vi.fn(),
  getCharts: vi.fn(),
  getChartsForTimeframeMode: vi.fn(),
  buildChartAnalysisCacheKey: vi.fn(
    (
      candleKey: string,
      engineMode: string,
      timeframeMode: string,
      primaryTimeframe?: string,
    ) =>
      timeframeMode === "single"
        ? `${candleKey}:${engineMode}:${timeframeMode}:${primaryTimeframe ?? "M15"}`
        : `${candleKey}:${engineMode}:${timeframeMode}`,
  ),
  loadChartAnalysisCache: vi.fn(),
  loadLatestChartAnalysisCache: vi.fn(),
  saveChartAnalysisCache: vi.fn(),
  isWithinCandleCloseWindow: vi.fn(),
  isWithinTimeframeCandleCloseWindow: vi.fn(),
  runCheckOpenTrades: vi.fn(),
  runCheckPendingOrders: vi.fn(),
  sendAllAnalyses: vi.fn(),
  sendMessage: vi.fn(),
  buildHeartbeatMessage: vi.fn(),
  notifyError: vi.fn(),
  saveOpenPosition: vi.fn(),
  savePendingOrder: vi.fn(),
  validateTradeSetupForOpen: vi.fn(),
  analyzeAllChartsDeterministic: vi.fn(),
  openBinanceFuturesPosition: vi.fn(),
  pollPendingEntryOrders: vi.fn(),
  findOpenPositionIdByPair: vi.fn(),
  loadOpenPairs: vi.fn(),
  applySignalFreshnessGuard: vi.fn(),
  saveBinancePendingEntryOrder: vi.fn(),
  updateBinanceEntryOrderStatus: vi.fn(),
  getPendingEntryOrderPositions: vi.fn(),
  isBinanceLiveTradingEnabled: vi.fn(),
  isBinanceLiveTradingEnabledVolman: vi.fn(),
  getConfiguredChartSignalConfidenceThreshold: vi.fn(),
  getConfiguredChartEngineMode: vi.fn(),
  getConfiguredChartTradingSystem: vi.fn(),
  getConfiguredChartRunContext: vi.fn(),
  getConfiguredChartTimeframeMode: vi.fn(),
  getConfiguredChartPrimaryTimeframe: vi.fn(),
  shouldUseLatestCacheForManualRun: vi.fn(),
  shouldSendHeartbeatOutsideCloseWindow: vi.fn(),
  shouldSendHeartbeatOnManualRun: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  },
}));

// ============================================================
// Hoisted vi.mock calls — these are hoisted to top of file
// ============================================================
vi.mock("../../src/charts/analyzer-common.js", () => ({
  buildChartAnalysisCacheKey: mocks.buildChartAnalysisCacheKey,
}));

vi.mock("../../src/charts/repository/chart-cache-repository-volman.js", () => ({
  loadChartAnalysisCache: mocks.loadChartAnalysisCache,
  loadLatestChartAnalysisCache: mocks.loadLatestChartAnalysisCache,
  saveChartAnalysisCache: mocks.saveChartAnalysisCache,
}));

vi.mock("../../src/charts/chart-cache.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/charts/chart-cache.js")>();
  return {
    ...original,
    isWithinCandleCloseWindow: mocks.isWithinCandleCloseWindow,
    isWithinTimeframeCandleCloseWindow:
      mocks.isWithinTimeframeCandleCloseWindow,
  };
});

vi.mock("../../src/charts/check-open-trades-runner-volman.js", () => ({
  runCheckOpenTrades: mocks.runCheckOpenTrades,
}));

// vi.mock("../../src/charts/check-pending-orders-runner-volman.js", () => ({
//   runCheckPendingOrders: mocks.runCheckPendingOrders,
// }));

vi.mock("../../src/shared/notification/telegram-client.js", () => ({
  sendMessage: mocks.sendMessage,
  notifyError: mocks.notifyError,
}));

vi.mock("../../src/shared/telegram-volman.js", () => ({
  buildHeartbeatMessage: mocks.buildHeartbeatMessage,
  sendAllAnalysesVolman: mocks.sendAllAnalyses,
}));

vi.mock("../../src/shared/infra/logger.js", () => ({
  createLogger: () => mocks.logger,
}));

vi.mock("../../src/charts/repository/positions-repository-volman.js", () => ({
  saveOpenPosition: mocks.saveOpenPosition,
  savePendingOrder: mocks.savePendingOrder,
  findOpenPositionIdByPair: mocks.findOpenPositionIdByPair,
  loadOpenPairs: mocks.loadOpenPairs,
  saveBinancePendingEntryOrder: mocks.saveBinancePendingEntryOrder,
  updateBinanceEntryOrderStatus: mocks.updateBinanceEntryOrderStatus,
  getPendingEntryOrderPositions: mocks.getPendingEntryOrderPositions,
}));

vi.mock("../../src/charts/position-engine-volman.js", () => ({
  validateTradeSetupForOpen: mocks.validateTradeSetupForOpen,
}));

vi.mock("../../src/charts/signal-freshness.js", () => ({
  applySignalFreshnessGuard: mocks.applySignalFreshnessGuard,
}));

vi.mock("../../src/charts/deterministic-pipeline.js", () => ({
  analyzeAllChartsDeterministic: mocks.analyzeAllChartsDeterministic,
}));

vi.mock("../../src/charts/volman-charts.config.js", () => ({
  getCharts: mocks.getCharts,
  getChartsForTimeframeMode: mocks.getChartsForTimeframeMode,
}));

vi.mock("../../src/charts/binance-execution-volman.js", () => ({
  openBinanceFuturesPosition: mocks.openBinanceFuturesPosition,
  pollPendingEntryOrders: mocks.pollPendingEntryOrders,
}));

vi.mock("../../src/charts/model/binance-futures-config-env.js", () => ({
  isBinanceLiveTradingEnabled: mocks.isBinanceLiveTradingEnabled,
  isBinanceLiveTradingEnabledVolman: mocks.isBinanceLiveTradingEnabledVolman,
  isBinanceHonorOrderTypeEnabledVolman: () => false,
  getConfiguredBinanceEntryOrderExpiryMinutes: () => 60,
  getConfiguredBinanceWorkingType: () => undefined,
}));

vi.mock("../../src/charts/model/volman-config-env.js", () => ({
  getConfiguredChartSignalConfidenceThreshold:
    mocks.getConfiguredChartSignalConfidenceThreshold,
  getConfiguredChartEngineMode: mocks.getConfiguredChartEngineMode,
  getConfiguredChartRunContext: mocks.getConfiguredChartRunContext,
  getConfiguredChartTimeframeMode: mocks.getConfiguredChartTimeframeMode,
  getConfiguredChartPrimaryTimeframe: mocks.getConfiguredChartPrimaryTimeframe,
  shouldUseLatestCacheForManualRun: mocks.shouldUseLatestCacheForManualRun,
  shouldSendHeartbeatOutsideCloseWindow:
    mocks.shouldSendHeartbeatOutsideCloseWindow,
  shouldSendHeartbeatOnManualRun: mocks.shouldSendHeartbeatOnManualRun,
}));

// ============================================================
// Mock data
// ============================================================
const MOCK_RESULT = {
  summaries: [
    { pair: "EUR/USD", trend: "LONG", status: "tích lũy", confidence: 80 },
  ],
  setups: [
    {
      pair: "EUR/USD",
      direction: "LONG" as const,
      setup: "RB",
      reasons: ["EMA20 dốc lên"],
      risks: ["Khối lượng yếu"],
      confidence: 75,
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1080",
      takeProfit2: "1.1120",
      riskReward: "1:2",
      summary: "Setup long",
    },
  ],
  noSetupReason: "",
};

// ============================================================
// Tests
// ============================================================
describe("charts/index main() — H4 close guard", () => {
  let main: () => Promise<void>;
  const getExpectedCacheKey = () =>
    String(mocks.buildChartAnalysisCacheKey.mock.results[0]?.value ?? "");

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mocks
    mocks.loadChartAnalysisCache.mockResolvedValue(null);
    mocks.loadLatestChartAnalysisCache.mockResolvedValue(null);
    mocks.isWithinCandleCloseWindow.mockReturnValue(false);
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(false);
    mocks.getConfiguredChartSignalConfidenceThreshold.mockReturnValue(50);
    mocks.getConfiguredChartEngineMode.mockReturnValue("ai");
    mocks.getConfiguredChartTradingSystem.mockReturnValue("bob-volman");
    mocks.getConfiguredChartRunContext.mockReturnValue("manual");
    // This describe block tests single-timeframe (H4) scan behavior specifically — "multi"
    // mode now genuinely loops over M15/H1/H4 independently (see the dedicated
    // "multi-timeframe scanning" describe block below), so it no longer collapses to "just
    // H4" the way it used to.
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("single");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("H4");
    mocks.shouldUseLatestCacheForManualRun.mockReturnValue(true);
    mocks.shouldSendHeartbeatOutsideCloseWindow.mockReturnValue(true);
    mocks.shouldSendHeartbeatOnManualRun.mockReturnValue(true);
    mocks.validateTradeSetupForOpen.mockReturnValue({
      accepted: true,
      reason: "",
    });
    mocks.applySignalFreshnessGuard.mockImplementation((setup) =>
      Promise.resolve({ ...setup, noSetupReason: undefined }),
    );
    mocks.saveOpenPosition.mockResolvedValue(true);
    mocks.loadOpenPairs.mockResolvedValue(new Set());
    mocks.captureAllCharts.mockResolvedValue([{ filepath: "/tmp/chart.png" }]);
    mocks.getCharts.mockResolvedValue([]);
    mocks.getChartsForTimeframeMode.mockResolvedValue([]);
    mocks.analyzeAllChartsDeterministic.mockResolvedValue(MOCK_RESULT);
    mocks.runCheckOpenTrades.mockResolvedValue(0);
    mocks.pollPendingEntryOrders.mockResolvedValue(undefined);
    mocks.openBinanceFuturesPosition.mockResolvedValue(undefined);
    mocks.findOpenPositionIdByPair.mockResolvedValue(null);
    mocks.isBinanceLiveTradingEnabled.mockReturnValue(false);
    mocks.isBinanceLiveTradingEnabledVolman.mockReturnValue(false);
    mocks.sendMessage.mockResolvedValue(undefined);
    mocks.sendAllAnalyses.mockResolvedValue(undefined);
    mocks.buildHeartbeatMessage.mockReturnValue("HEARTBEAT");
    mocks.logger.child.mockReturnValue(mocks.logger);

    // Dynamic import to get fresh module instance each test
    const mod = await import("../../src/charts/index.js");
    main = mod.main;
  });

  test("không trong window + không cache → bỏ qua capture+analyze, check trade (không check pending)", async () => {
    await main();

    // Capture + analyze không được gọi
    expect(mocks.captureAllCharts).not.toHaveBeenCalled();
    expect(mocks.saveChartAnalysisCache).not.toHaveBeenCalled();

    // Chỉ check open trades (pending order check bị disable)
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
    expect(mocks.savePendingOrder).not.toHaveBeenCalled();

    // sendAllAnalyses không được gọi vì result=null
    expect(mocks.sendAllAnalyses).not.toHaveBeenCalled();
  });

  test("có cache (bất kể window) → dùng cache, không capture+analyze", async () => {
    mocks.loadChartAnalysisCache.mockResolvedValue(MOCK_RESULT as any);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledTimes(1);
    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    expect(mocks.captureAllCharts).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).toHaveBeenCalledTimes(1);
    expect(mocks.sendAllAnalyses).toHaveBeenCalledWith(
      MOCK_RESULT,
      undefined,
      expect.objectContaining({
        source: "cached",
        candleKey: expect.any(String),
      }),
    );
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
  });

  test("không cache + trong window → capture+analyze + check trade/pending", async () => {
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    expect(mocks.captureAllCharts).not.toHaveBeenCalled();
    expect(mocks.analyzeAllChartsDeterministic).toHaveBeenCalledTimes(1);
    expect(mocks.saveChartAnalysisCache).toHaveBeenCalledWith(
      expect.any(String),
      MOCK_RESULT,
    );

    expect(mocks.sendAllAnalyses).toHaveBeenCalledWith(
      MOCK_RESULT,
      undefined,
      expect.objectContaining({
        source: "live",
        candleKey: expect.any(String),
      }),
    );
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
  });

  test("có cache + trong window → ưu tiên cache, không capture+analyze", async () => {
    mocks.loadChartAnalysisCache.mockResolvedValue(MOCK_RESULT as any);
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    // Cache hit → bỏ qua capture+analyze dù đang trong window
    expect(mocks.captureAllCharts).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).toHaveBeenCalledTimes(1);
    expect(mocks.sendAllAnalyses).toHaveBeenCalledWith(
      MOCK_RESULT,
      undefined,
      expect.objectContaining({
        source: "cached",
        candleKey: expect.any(String),
      }),
    );
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
  });

  test("ngoài window + manual run + không có cache hiện tại nhưng có latest cache → dùng latest cache", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("manual");
    mocks.loadLatestChartAnalysisCache.mockResolvedValue({
      candleKey: "2026-07-03T08:deterministic",
      result: MOCK_RESULT as any,
    });

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledTimes(1);
    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    expect(mocks.loadLatestChartAnalysisCache).toHaveBeenCalledWith(
      "deterministic",
      "single",
      "H4",
    );
    expect(mocks.captureAllCharts).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).toHaveBeenCalledWith(MOCK_RESULT, undefined, {
      source: "cached",
      candleKey: "2026-07-03T08:deterministic",
      timeframe: "H4",
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  test("ngoài window + manual run + không có cache → không gửi heartbeat", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("manual");
    mocks.loadLatestChartAnalysisCache.mockResolvedValue(null);

    await main();

    expect(mocks.captureAllCharts).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).not.toHaveBeenCalled();
    expect(mocks.buildHeartbeatMessage).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  test("ngoài window + auto run + không có event khác → không gửi heartbeat", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("auto");
    mocks.runCheckOpenTrades.mockResolvedValue(0);

    await main();

    expect(mocks.loadLatestChartAnalysisCache).not.toHaveBeenCalled();
    expect(mocks.buildHeartbeatMessage).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  test("ngoài window + auto run + có event trade/pending → không gửi heartbeat", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("auto");
    mocks.runCheckOpenTrades.mockResolvedValue(1);

    await main();

    expect(mocks.buildHeartbeatMessage).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  test("deterministic single mode M15 dùng timeframe runtime cho cache key và close window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T10:15:05Z"));
    mocks.getConfiguredChartEngineMode.mockReturnValue("deterministic");
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("single");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("M15");
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(expectedCacheKey).toBe("2026-07-03T10:15:deterministic:single:M15");
    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    expect(mocks.analyzeAllChartsDeterministic).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeAllChartsDeterministic).toHaveBeenCalledWith(
      expect.any(Array),
      { timeframeMode: "single", primaryTimeframe: "M15" },
    );
    expect(mocks.saveChartAnalysisCache).toHaveBeenCalledWith(
      expectedCacheKey,
      MOCK_RESULT,
    );
    vi.useRealTimers();
  });

  test("deterministic single mode D1 vẫn dùng runtime timeframe cho cache key và close window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T00:00:05Z"));
    mocks.getConfiguredChartEngineMode.mockReturnValue("deterministic");
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("single");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("D1");
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(expectedCacheKey).toBe("2026-07-04T00:deterministic:single:D1");
    expect(mocks.analyzeAllChartsDeterministic).toHaveBeenCalledWith(
      expect.any(Array),
      { timeframeMode: "single", primaryTimeframe: "D1" },
    );
    expect(mocks.saveChartAnalysisCache).toHaveBeenCalledWith(
      expectedCacheKey,
      MOCK_RESULT,
    );
    vi.useRealTimers();
  });

  test("deterministic single mode truyền timeframe thực xuống pipeline", async () => {
    mocks.getConfiguredChartEngineMode.mockReturnValue("deterministic");
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("single");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("D1");
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    expect(mocks.analyzeAllChartsDeterministic).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeAllChartsDeterministic).toHaveBeenCalledWith(
      expect.any(Array),
      { timeframeMode: "single", primaryTimeframe: "D1" },
    );
    expect(mocks.saveChartAnalysisCache).toHaveBeenCalledWith(
      expectedCacheKey,
      MOCK_RESULT,
    );
  });

  test("final Run complete log dùng analysisStats.attemptedPairs khi có stats", async () => {
    mocks.getConfiguredChartEngineMode.mockReturnValue("deterministic");
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("single");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("M15");
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);
    mocks.analyzeAllChartsDeterministic.mockResolvedValue({
      summaries: [],
      setups: [],
      noSetupReason: "",
      analysisStats: {
        attemptedPairs: 8,
        okPairs: 0,
        skippedPairs: 8,
        setupCount: 0,
      },
    } as any);

    await main();

    const runCompleteCall = mocks.logger.info.mock.calls.find(
      ([message]) => message === "Run complete",
    );

    expect(runCompleteCall).toBeDefined();
    expect(runCompleteCall?.[1]).toMatchObject({
      scannedPairs: 8,
      attemptedPairs: 8,
      summaryPairs: 0,
      skippedPairs: 8,
      setupCount: 0,
      engineMode: "bob-volman",
    });
  });

  test("fatal error scope follows the selected trading system", () => {
    expect(getChartScannerErrorScope()).toBe(
      "Bob Volman multi-timeframe scanner",
    );
  });

  test("ngoài window + manual run + Volman + có latest cache thì dùng latest cache label deterministic", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("manual");
    mocks.loadLatestChartAnalysisCache.mockResolvedValue({
      candleKey: "2026-07-03T08:deterministic",
      result: MOCK_RESULT as any,
    });

    await main();

    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledTimes(1);
    expect(mocks.loadLatestChartAnalysisCache).toHaveBeenCalledWith(
      "deterministic",
      "single",
      "H4",
    );
    expect(mocks.analyzeAllChartsDeterministic).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).toHaveBeenCalledWith(
      MOCK_RESULT,
      undefined,
      expect.objectContaining({
        source: "cached",
        candleKey: "2026-07-03T08:deterministic",
      }),
    );
  });

  test("loadOpenPairs trả về cặp có setup → loại khỏi result.setups, không gửi Telegram, không save position", async () => {
    // Setup cache với setup EUR/USD
    mocks.loadChartAnalysisCache.mockResolvedValue(MOCK_RESULT as any);
    // loadOpenPairs trả về EUR/USD đã có vị thế mở
    mocks.loadOpenPairs.mockResolvedValue(new Set(["EUR/USD"]));

    await main();

    // sendAllAnalyses được gọi nhưng result.setups phải rỗng (setup đã bị lọc)
    expect(mocks.sendAllAnalyses).toHaveBeenCalledTimes(1);
    const sendAllAnalysesCall = mocks.sendAllAnalyses.mock.calls[0];
    const resultPassed = sendAllAnalysesCall[0];
    expect(resultPassed.setups).toHaveLength(0);

    // saveOpenPosition không được gọi (setup đã bị lọc trước vòng auto-track)
    expect(mocks.saveOpenPosition).not.toHaveBeenCalled();

    // noSetupReason phải chứa lý do lọc open position
    expect(resultPassed.noSetupReason).toContain("Đã có vị thế mở");
  });

  test("mỗi process chỉ scan đúng 1 timeframe đã cấu hình (M15/H1/H4 chạy dưới dạng 3 scheduled task riêng, không loop trong 1 process)", async () => {
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("single");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("M15");
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();

    expect(mocks.analyzeAllChartsDeterministic).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeAllChartsDeterministic.mock.calls[0][1]).toMatchObject({
      timeframeMode: "single",
      primaryTimeframe: "M15",
    });
    expect(mocks.sendAllAnalyses).toHaveBeenCalledTimes(1);
  });

  test("runCheckOpenTrades/pollPendingEntryOrders được gọi không kèm timeframe — quét mọi timeframe dù process này chỉ scan 1", async () => {
    // Vị thế/lệnh chờ có thể đến từ bất kỳ process nào trong 3 scheduled task (M15/H1/H4)
    // — process nào chạy cũng phải kiểm tra được tất cả, không chỉ timeframe của chính nó.
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("single");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("M15");
    mocks.isBinanceLiveTradingEnabled.mockReturnValue(true);
    mocks.isBinanceLiveTradingEnabledVolman.mockReturnValue(true);

    await main();

    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledWith();
    expect(mocks.pollPendingEntryOrders).toHaveBeenCalledTimes(1);
    expect(mocks.pollPendingEntryOrders).toHaveBeenCalledWith();
  });
});
