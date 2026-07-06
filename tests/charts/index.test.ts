import { beforeEach, describe, expect, test, vi } from "vitest";

// ============================================================
// Mock state (vi.hoisted — runs before factory functions)
// ============================================================
const mocks = vi.hoisted(() => ({
  captureAllCharts: vi.fn(),
  analyzeAllCharts: vi.fn(),
  loadChartAnalysisCache: vi.fn(),
  saveChartAnalysisCache: vi.fn(),
  isWithinCandleCloseWindow: vi.fn(),
  runCheckOpenTrades: vi.fn(),
  runCheckPendingOrders: vi.fn(),
  sendAllAnalyses: vi.fn(),
  notifyError: vi.fn(),
  saveOpenPosition: vi.fn(),
  savePendingOrder: vi.fn(),
  validateTradeSetupForOpen: vi.fn(),
  getConfiguredChartSignalConfidenceThreshold: vi.fn(),
  getConfiguredChartEngineMode: vi.fn(),
}));

// ============================================================
// Hoisted vi.mock calls — these are hoisted to top of file
// ============================================================
vi.mock("../../src/charts/screenshot.js", () => ({
  captureAllCharts: mocks.captureAllCharts,
}));

vi.mock("../../src/charts/analyzer.js", () => ({
  analyzeAllCharts: mocks.analyzeAllCharts,
}));

vi.mock("../../src/charts/chart-cache-repository.js", () => ({
  loadChartAnalysisCache: mocks.loadChartAnalysisCache,
  saveChartAnalysisCache: mocks.saveChartAnalysisCache,
}));

vi.mock("../../src/charts/chart-cache.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/charts/chart-cache.js")>();
  return {
    ...original,
    isWithinCandleCloseWindow: mocks.isWithinCandleCloseWindow,
  };
});

vi.mock("../../src/charts/check-open-trades-runner.js", () => ({
  runCheckOpenTrades: mocks.runCheckOpenTrades,
}));

vi.mock("../../src/charts/check-pending-orders-runner.js", () => ({
  runCheckPendingOrders: mocks.runCheckPendingOrders,
}));

vi.mock("../../src/shared/telegram.js", () => ({
  sendAllAnalyses: mocks.sendAllAnalyses,
  notifyError: mocks.notifyError,
}));

vi.mock("../../src/charts/positions-repository.js", () => ({
  saveOpenPosition: mocks.saveOpenPosition,
  savePendingOrder: mocks.savePendingOrder,
}));

vi.mock("../../src/charts/position-engine.js", () => ({
  validateTradeSetupForOpen: mocks.validateTradeSetupForOpen,
}));

vi.mock("../../src/charts/chart-config-env.js", () => ({
  getConfiguredChartSignalConfidenceThreshold: mocks.getConfiguredChartSignalConfidenceThreshold,
  getConfiguredChartEngineMode: mocks.getConfiguredChartEngineMode,
}));

// ============================================================
// Mock data
// ============================================================
const CANDLE_KEY = "2026-07-03T12";

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
describe("charts/index main() — H4 close guard", () => {
  let main: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mocks
    mocks.loadChartAnalysisCache.mockResolvedValue(null);
    mocks.isWithinCandleCloseWindow.mockReturnValue(false);
    mocks.getConfiguredChartSignalConfidenceThreshold.mockReturnValue(50);
    mocks.getConfiguredChartEngineMode.mockReturnValue("ai");
    mocks.validateTradeSetupForOpen.mockReturnValue({ accepted: true, reason: "" });
    mocks.saveOpenPosition.mockResolvedValue(true);
    mocks.savePendingOrder.mockResolvedValue(true);
    mocks.captureAllCharts.mockResolvedValue([{ filepath: "/tmp/chart.png" }]);
    mocks.analyzeAllCharts.mockResolvedValue(MOCK_RESULT);
    mocks.runCheckOpenTrades.mockResolvedValue(undefined);
    mocks.runCheckPendingOrders.mockResolvedValue(undefined);

    // Dynamic import to get fresh module instance each test
    const mod = await import("../../src/charts/index.js");
    main = mod.main;
  });

  test("không trong window + không cache → bỏ qua capture+analyze, vẫn check trade/pending", async () => {
    await main();

    // Capture + analyze không được gọi
    expect(mocks.captureAllCharts).not.toHaveBeenCalled();
    expect(mocks.analyzeAllCharts).not.toHaveBeenCalled();
    expect(mocks.saveChartAnalysisCache).not.toHaveBeenCalled();

    // Trade + pending runner vẫn được gọi
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
    expect(mocks.runCheckPendingOrders).toHaveBeenCalledTimes(1);

    // sendAllAnalyses không được gọi vì result=null
    expect(mocks.sendAllAnalyses).not.toHaveBeenCalled();
  });

  test("có cache (bất kể window) → dùng cache, không capture+analyze", async () => {
    mocks.loadChartAnalysisCache.mockResolvedValue(MOCK_RESULT as any);

    await main();

    expect(mocks.captureAllCharts).not.toHaveBeenCalled();
    expect(mocks.analyzeAllCharts).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).toHaveBeenCalledTimes(1);
    expect(mocks.sendAllAnalyses).toHaveBeenCalledWith(MOCK_RESULT);
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
    expect(mocks.runCheckPendingOrders).toHaveBeenCalledTimes(1);
  });

  test("không cache + trong window → capture+analyze + check trade/pending", async () => {
    mocks.isWithinCandleCloseWindow.mockReturnValue(true);

    await main();

    expect(mocks.captureAllCharts).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeAllCharts).toHaveBeenCalledTimes(1);
    expect(mocks.saveChartAnalysisCache).toHaveBeenCalledWith(
      expect.any(String),
      MOCK_RESULT,
    );
    expect(mocks.sendAllAnalyses).toHaveBeenCalledTimes(1);
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
    expect(mocks.runCheckPendingOrders).toHaveBeenCalledTimes(1);
  });

  test("có cache + trong window → ưu tiên cache, không capture+analyze", async () => {
    mocks.loadChartAnalysisCache.mockResolvedValue(MOCK_RESULT as any);
    mocks.isWithinCandleCloseWindow.mockReturnValue(true);

    await main();

    // Cache hit → bỏ qua capture+analyze dù đang trong window
    expect(mocks.captureAllCharts).not.toHaveBeenCalled();
    expect(mocks.analyzeAllCharts).not.toHaveBeenCalled();
    expect(mocks.sendAllAnalyses).toHaveBeenCalledTimes(1);
    expect(mocks.runCheckOpenTrades).toHaveBeenCalledTimes(1);
    expect(mocks.runCheckPendingOrders).toHaveBeenCalledTimes(1);
  });
});