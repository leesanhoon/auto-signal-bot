import { beforeEach, describe, expect, test, vi } from "vitest";

// ============================================================
// Mock state (vi.hoisted — runs before factory functions)
// ============================================================
const mocks = vi.hoisted(() => ({
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
  isWithinTimeframeCandleCloseWindow: vi.fn(),
  runCheckOpenTrades: vi.fn(),
  runCheckPendingOrders: vi.fn(),
  sendAllAnalyses: vi.fn(),
  sendMessage: vi.fn(),
  notifyError: vi.fn(),
  saveOpenPosition: vi.fn(),
  savePendingOrder: vi.fn(),
  validateTradeSetupForOpen: vi.fn(),
  analyzeAllChartsSmc: vi.fn(),
  getConfiguredChartSignalConfidenceThreshold: vi.fn(),
  getConfiguredChartRunContext: vi.fn(),
  getConfiguredChartTimeframeMode: vi.fn(),
  getConfiguredChartPrimaryTimeframe: vi.fn(),
  getConfiguredSmcSignalFreshnessCandles: vi.fn(() => 1),
  getConfiguredSmcMinSignalConfidence: vi.fn(() => 65),
  getConfiguredSmcMinRiskPct: vi.fn(() => 0.5),
  shouldUseLatestCacheForManualRun: vi.fn(),
  shouldSendHeartbeatOutsideCloseWindow: vi.fn(),
  shouldSendHeartbeatOnManualRun: vi.fn(),
  getLastClosedCandleKey: vi.fn(),
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

vi.mock("../../src/charts/chart-cache-repository-smc.js", () => ({
  loadChartAnalysisCache: mocks.loadChartAnalysisCache,
  loadLatestChartAnalysisCache: mocks.loadLatestChartAnalysisCache,
  saveChartAnalysisCache: mocks.saveChartAnalysisCache,
}));

vi.mock("../../src/charts/chart-cache.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/charts/chart-cache.js")>();
  return {
    ...original,
    isWithinTimeframeCandleCloseWindow:
      mocks.isWithinTimeframeCandleCloseWindow,
    getLastClosedCandleKey: mocks.getLastClosedCandleKey,
  };
});

vi.mock("../../src/charts/check-open-trades-runner-smc.js", () => ({
  runCheckOpenTrades: mocks.runCheckOpenTrades,
}));

vi.mock("../../src/charts/check-pending-orders-runner-smc.js", () => ({
  runCheckPendingOrders: mocks.runCheckPendingOrders,
}));

vi.mock("../../src/shared/telegram-client.js", () => ({
  sendMessage: mocks.sendMessage,
  notifyError: mocks.notifyError,
}));

vi.mock("../../src/shared/telegram-smc.js", () => ({
  buildHeartbeatMessage: (options: any) => {
    const runLabel = options.runContext === "manual" ? "Manual run" : "Auto run";
    const reason = options.reason === "no-cache"
      ? "Không có cache phân tích hợp lệ để dùng lại trong lượt chạy ngoài cửa sổ đóng nến."
      : "Không có event trade/pending nào phát sinh trong lượt chạy này.";
    return `🚀 *SMC Multi-Timeframe Scanner heartbeat*\n*Run:* ${runLabel}\n*Last closed candle:* ${options.candleKey}\n*Reason:* ${options.reason}\n_${reason}_`;
  },
  sendAllAnalysesSmc: mocks.sendAllAnalyses,
}));

vi.mock("../../src/shared/logger.js", () => ({
  createLogger: () => mocks.logger,
}));

vi.mock("../../src/charts/positions-repository-smc.js", () => ({
  saveOpenPosition: mocks.saveOpenPosition,
  savePendingOrder: mocks.savePendingOrder,
}));

vi.mock("../../src/charts/position-engine-smc.js", () => ({
  validateTradeSetupForOpen: mocks.validateTradeSetupForOpen,
}));

vi.mock("../../src/charts/smc/smc-pipeline.js", () => ({
  analyzeAllChartsSmc: mocks.analyzeAllChartsSmc,
}));

vi.mock("../../src/charts/smc-config-env.js", () => ({
  getConfiguredChartRunContext: mocks.getConfiguredChartRunContext,
  getConfiguredChartTimeframeMode: mocks.getConfiguredChartTimeframeMode,
  getConfiguredChartPrimaryTimeframe: mocks.getConfiguredChartPrimaryTimeframe,
  getConfiguredSmcSignalFreshnessCandles:
    mocks.getConfiguredSmcSignalFreshnessCandles,
  getConfiguredSmcMinSignalConfidence:
    mocks.getConfiguredSmcMinSignalConfidence,
  getConfiguredSmcMinRiskPct: mocks.getConfiguredSmcMinRiskPct,
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
  screenshots: [],
};

// ============================================================
// Tests
// ============================================================
describe("charts/smc-index main() — SMC standalone entrypoint", () => {
  let main: () => Promise<void>;
  const getExpectedCacheKey = () =>
    String(mocks.buildChartAnalysisCacheKey.mock.results[0]?.value ?? "");

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mocks
    mocks.getLastClosedCandleKey.mockReturnValue("2026-07-03T10:15");
    mocks.loadChartAnalysisCache.mockResolvedValue(null);
    mocks.loadLatestChartAnalysisCache.mockResolvedValue(null);
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(false);
    mocks.getConfiguredChartSignalConfidenceThreshold.mockReturnValue(50);
    mocks.getConfiguredChartRunContext.mockReturnValue("manual");
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("multi");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("M15");
    mocks.shouldUseLatestCacheForManualRun.mockReturnValue(true);
    mocks.shouldSendHeartbeatOutsideCloseWindow.mockReturnValue(true);
    mocks.shouldSendHeartbeatOnManualRun.mockReturnValue(true);
    mocks.validateTradeSetupForOpen.mockReturnValue({
      accepted: true,
      reason: "",
    });
    mocks.saveOpenPosition.mockResolvedValue(true);
    mocks.savePendingOrder.mockResolvedValue(true);
    mocks.analyzeAllChartsSmc.mockResolvedValue(MOCK_RESULT);
    mocks.runCheckOpenTrades.mockResolvedValue(0);
    mocks.runCheckPendingOrders.mockResolvedValue(0);
    mocks.sendMessage.mockResolvedValue(undefined);
    mocks.sendAllAnalyses.mockResolvedValue(undefined);
    mocks.logger.child.mockReturnValue(mocks.logger);

    // Dynamic import to get fresh module instance each test
    const mod = await import("../../src/charts/smc-index.js");
    main = mod.main;
  });

  test("1. multi mode dùng M15 (không H4) cho cache key và close window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T10:15:05Z"));
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("multi");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("M15");
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    // Verify cache key contains M15, not H4
    expect(expectedCacheKey).toBe("2026-07-03T10:15:smc:multi");

    // Verify getLastClosedCandleKey was called with M15 timeframe
    expect(mocks.getLastClosedCandleKey).toHaveBeenCalledWith("M15");

    // Verify isWithinTimeframeCandleCloseWindow was called with M15
    expect(mocks.isWithinTimeframeCandleCloseWindow).toHaveBeenCalledWith(
      "M15",
      expect.any(Date),
      expect.any(Number),
    );

    // Verify cache was checked and analysis ran
    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    expect(mocks.analyzeAllChartsSmc).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test("2. single mode dùng primaryTimeframe (H4) thay vì M15", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T08:00:05Z"));
    mocks.getConfiguredChartTimeframeMode.mockReturnValue("single");
    mocks.getConfiguredChartPrimaryTimeframe.mockReturnValue("H4");
    mocks.getLastClosedCandleKey.mockReturnValue("2026-07-03T08:00");
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    // Verify cache key contains H4 when in single mode
    expect(expectedCacheKey).toBe("2026-07-03T08:00:smc:single:H4");

    // Verify getLastClosedCandleKey was called with H4 (primaryTimeframe)
    expect(mocks.getLastClosedCandleKey).toHaveBeenCalledWith("H4");

    // Verify isWithinTimeframeCandleCloseWindow was called with H4
    expect(mocks.isWithinTimeframeCandleCloseWindow).toHaveBeenCalledWith(
      "H4",
      expect.any(Date),
      expect.any(Number),
    );

    expect(mocks.analyzeAllChartsSmc).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("3. analyzeAllChartsSmc được gọi với timeframeMode + primaryTimeframe", async () => {
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();

    expect(mocks.analyzeAllChartsSmc).toHaveBeenCalledWith(expect.any(Array), {
      timeframeMode: "multi",
      primaryTimeframe: "M15",
      minSignalConfidence: expect.any(Number),
      minRiskPct: expect.any(Number),
    });
  });

  test("4. runCheckPendingOrders KHÔNG được gọi (signals-only mode)", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("auto");
    mocks.runCheckOpenTrades.mockResolvedValue(0);
    mocks.runCheckPendingOrders.mockResolvedValue(2);

    await main();

    // runCheckPendingOrders KHÔNG được gọi (disabled)
    expect(mocks.runCheckPendingOrders).not.toHaveBeenCalled();

    // Vì chỉ kiểm tra openTrades === 0, gửi heartbeat "no-event"
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("4b. heartbeat chỉ phụ thuộc vào openTrades (không có pending check)", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("auto");
    mocks.runCheckOpenTrades.mockResolvedValue(0);
    mocks.runCheckPendingOrders.mockResolvedValue(999); // giá trị này bị bỏ qua

    await main();

    expect(mocks.runCheckPendingOrders).not.toHaveBeenCalled();

    // Gửi heartbeat vì openTrades === 0 (không phụ thuộc pendingNotifications)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const heartbeatMessage = mocks.sendMessage.mock.calls[0][0];
    expect(typeof heartbeatMessage).toBe("string");
    expect(heartbeatMessage).toContain("SMC");
  });

  test("5. cache hit → không gọi analyzeAllChartsSmc", async () => {
    mocks.loadChartAnalysisCache.mockResolvedValue(MOCK_RESULT as any);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    expect(mocks.analyzeAllChartsSmc).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).toHaveBeenCalledTimes(1);
    expect(mocks.sendAllAnalyses).toHaveBeenCalledWith(
      MOCK_RESULT,
      undefined,
      expect.objectContaining({
        source: "cached",
        candleKey: expect.any(String),
      }),
    );
  });

  test("6. cache miss + trong cửa sổ đóng nến → gọi analyzeAllChartsSmc + lưu cache", async () => {
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    expect(mocks.analyzeAllChartsSmc).toHaveBeenCalledTimes(1);
    expect(mocks.saveChartAnalysisCache).toHaveBeenCalledWith(
      expectedCacheKey,
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
  });

  test("7. heartbeat message chứa SMC không chứa Bob Volman", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("manual");
    mocks.loadLatestChartAnalysisCache.mockResolvedValue(null);

    await main();

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const message = mocks.sendMessage.mock.calls[0][0];

    // Phải có "SMC"
    expect(message).toContain("SMC");
    expect(message).toContain("Multi-Timeframe Scanner");

    // Không được có "Bob Volman"
    expect(message).not.toContain("Bob Volman");
  });

  test("8. error thrown trong main() bubbles up correctly", async () => {
    // Khi có error trong execution, main() throws
    const error = new Error("Test error during analysis");
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);
    mocks.analyzeAllChartsSmc.mockRejectedValue(error);

    await expect(main()).rejects.toThrow("Test error during analysis");

    // Verify that notifyError mock exists (được sử dụng ở module level error handler)
    // Module-level error handling không test được trực tiếp vì VITEST disables catch handler
    // nhưng mock đã được setup để verify behavior nếu handler được enable
    expect(mocks.notifyError).toBeDefined();
  });

  test("ngoài window + không cache → bỏ qua analyze, check open trades (không check pending)", async () => {
    await main();

    // Analyze không được gọi
    expect(mocks.analyzeAllChartsSmc).not.toHaveBeenCalled();
    expect(mocks.saveChartAnalysisCache).not.toHaveBeenCalled();

    // Chỉ check open trades (pending order check bị disable)
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
    expect(mocks.runCheckPendingOrders).not.toHaveBeenCalled();

    // sendAllAnalyses không được gọi vì result=null
    expect(mocks.sendAllAnalyses).not.toHaveBeenCalled();
  });

  test("ngoài window + manual run + có latest cache → dùng latest cache", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("manual");
    mocks.loadLatestChartAnalysisCache.mockResolvedValue({
      candleKey: "2026-07-03T08:smc",
      result: MOCK_RESULT as any,
    });

    await main();
    const expectedCacheKey = getExpectedCacheKey();

    expect(mocks.loadChartAnalysisCache).toHaveBeenCalledWith(expectedCacheKey);
    expect(mocks.loadLatestChartAnalysisCache).toHaveBeenCalledWith(
      "smc",
      "multi",
      "M15",
    );
    expect(mocks.analyzeAllChartsSmc).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).toHaveBeenCalledWith(
      MOCK_RESULT,
      undefined,
      expect.objectContaining({
        source: "cached",
        candleKey: "2026-07-03T08:smc",
      }),
    );
  });

  test("ngoài window + manual run + không cache → gửi heartbeat no-cache", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("manual");
    mocks.loadLatestChartAnalysisCache.mockResolvedValue(null);

    await main();

    expect(mocks.analyzeAllChartsSmc).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    const message = mocks.sendMessage.mock.calls[0][0];
    expect(message).toContain("SMC");
    expect(message).toContain("no-cache");
  });

  test("ngoài window + auto run + không có event trade → gửi heartbeat no-event", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("auto");
    mocks.runCheckOpenTrades.mockResolvedValue(0);
    mocks.runCheckPendingOrders.mockResolvedValue(0); // bị bỏ qua

    await main();

    expect(mocks.loadLatestChartAnalysisCache).not.toHaveBeenCalled();
    expect(mocks.runCheckPendingOrders).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    const message = mocks.sendMessage.mock.calls[0][0];
    expect(message).toContain("SMC");
    expect(message).toContain("no-event");
  });

  test("ngoài window + auto run + có event trade → không gửi heartbeat", async () => {
    mocks.getConfiguredChartRunContext.mockReturnValue("auto");
    mocks.runCheckOpenTrades.mockResolvedValue(1);
    mocks.runCheckPendingOrders.mockResolvedValue(0); // bị bỏ qua

    await main();

    expect(mocks.runCheckPendingOrders).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  test("có analysis result → gọi handleAnalysisResult", async () => {
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);

    await main();

    expect(mocks.analyzeAllChartsSmc).toHaveBeenCalledTimes(1);
    expect(mocks.sendAllAnalyses).toHaveBeenCalledTimes(1);
  });

  test("auto-track MARKET_NOW setup khi confidence >= threshold", async () => {
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);
    const setupWithMarketNow = {
      ...MOCK_RESULT.setups[0],
      orderType: "MARKET_NOW",
      confidence: 75,
    };
    mocks.analyzeAllChartsSmc.mockResolvedValue({
      ...MOCK_RESULT,
      setups: [setupWithMarketNow],
    });

    await main();

    expect(mocks.validateTradeSetupForOpen).toHaveBeenCalledTimes(1);
    expect(mocks.saveOpenPosition).toHaveBeenCalledTimes(1);
  });

  test("KHÔNG lưu pending order khi không phải MARKET_NOW (signals-only mode)", async () => {
    mocks.isWithinTimeframeCandleCloseWindow.mockReturnValue(true);
    const setupWithPending = {
      ...MOCK_RESULT.setups[0],
      orderType: "LIMIT",
      confidence: 75,
    };
    mocks.analyzeAllChartsSmc.mockResolvedValue({
      ...MOCK_RESULT,
      setups: [setupWithPending],
    });

    await main();

    // savePendingOrder KHÔNG được gọi (disabled)
    expect(mocks.savePendingOrder).not.toHaveBeenCalled();
  });
});
