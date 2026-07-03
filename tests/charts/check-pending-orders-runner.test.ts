import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  call: vi.fn(),
  retry: vi.fn(async (request: () => Promise<unknown>) => request()),
  loadPendingOrders: vi.fn(),
  updatePendingOrder: vi.fn(),
  saveOpenPosition: vi.fn(),
  findOpenPositionIdByPair: vi.fn(),
  validateTradeSetupForOpen: vi.fn(),
  captureVerificationChartScreenshot: vi.fn(),
  findChartForPair: vi.fn(),
  fetchCandleRangeStats: vi.fn(),
  sendMessage: vi.fn(async () => undefined),
  sendPhoto: vi.fn(async () => undefined),
  recordOpenRouterUsage: vi.fn(),
}));

vi.mock("../../src/shared/openrouter.js", () => ({ callOpenRouter: state.call }));
vi.mock("../../src/shared/retry.js", () => ({ withRetry: state.retry }));
vi.mock("../../src/shared/ai-usage.js", () => ({ recordOpenRouterUsage: state.recordOpenRouterUsage }));
vi.mock("../../src/shared/telegram.js", () => ({
  sendMessage: state.sendMessage,
  sendPhoto: state.sendPhoto,
}));
vi.mock("../../src/charts/positions-repository.js", () => ({
  loadPendingOrders: state.loadPendingOrders,
  updatePendingOrder: state.updatePendingOrder,
  saveOpenPosition: state.saveOpenPosition,
  findOpenPositionIdByPair: state.findOpenPositionIdByPair,
}));
vi.mock("../../src/charts/position-engine.js", () => ({
  validateTradeSetupForOpen: state.validateTradeSetupForOpen,
}));
vi.mock("../../src/charts/screenshot.js", () => ({
  findChartForPair: state.findChartForPair,
  captureVerificationChartScreenshot: state.captureVerificationChartScreenshot,
  fetchCandleRangeStats: state.fetchCandleRangeStats,
}));

const runner = await import("../../src/charts/check-pending-orders-runner.js");

describe("charts/check-pending-orders-runner", () => {
  beforeEach(() => {
    state.call.mockReset();
    state.retry.mockClear();
    state.loadPendingOrders.mockReset();
    state.updatePendingOrder.mockReset();
    state.saveOpenPosition.mockReset();
    state.findOpenPositionIdByPair.mockReset();
    state.validateTradeSetupForOpen.mockReset();
    state.captureVerificationChartScreenshot.mockReset();
    state.findChartForPair.mockReset();
    state.fetchCandleRangeStats.mockReset();
    state.sendMessage.mockClear();
    state.sendPhoto.mockClear();
    state.recordOpenRouterUsage.mockClear();

    state.findChartForPair.mockReturnValue({
      symbol: "EURUSD",
      name: "EUR/USD M15",
      timeframe: "M15",
      interval: "15",
      description: "",
    });
    state.captureVerificationChartScreenshot.mockResolvedValue({
      chart: { symbol: "EURUSD", name: "EUR/USD M15", timeframe: "M15", interval: "15", description: "" },
      buffer: Buffer.from("chart"),
      filepath: "/tmp/chart-m15.jpg",
      lastPrice: 1.0995,
    });
    state.fetchCandleRangeStats.mockResolvedValue({
      high: 1.0995,
      low: 1.0990,
      lastClose: 1.0993,
    });
    state.validateTradeSetupForOpen.mockReturnValue({ accepted: true, reason: null, plan: null });
    state.saveOpenPosition.mockResolvedValue(true);
    state.findOpenPositionIdByPair.mockResolvedValue(123);
  });

  function pendingOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 7,
      pair: "EUR/USD",
      direction: "LONG" as const,
      setup: "RB",
      orderType: "BUY_STOP" as const,
      entry: "1.1000",
      stopLoss: "1.0980",
      takeProfit1: "1.1040",
      takeProfit2: "1.1080",
      confidence: 82,
      reasons: ["EMA20 flat to up"],
      risks: ["False break"],
      primaryTimeframe: "M15" as const,
      sourceChartFilepath: "/tmp/chart-m15.jpg",
      status: "PENDING" as const,
      runCount: 0,
      expiryRuns: 2,
      createdAt: "2026-07-03T00:00:00.000Z",
      resolvedAt: null,
      resolvedReason: null,
      triggeredPositionId: null,
      ...overrides,
    };
  }

  test("marks a pending order as triggered and creates an open position", async () => {
    state.loadPendingOrders.mockResolvedValueOnce([pendingOrder()]);
    state.call.mockResolvedValueOnce({
      text: '{"status":"TRIGGERED","confidence":91,"comment":"Entry touched"}',
      usage: { promptTokens: 8, completionTokens: 2 },
    });

    await runner.runCheckPendingOrders();

    expect(state.sendPhoto).toHaveBeenCalledTimes(1);
    expect(state.saveOpenPosition).toHaveBeenCalledTimes(1);
    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: "TRIGGERED",
        runCount: 1,
        triggeredPositionId: 123,
      }),
    );
    expect(state.sendMessage.mock.calls.map((call) => call[0]).join("\n")).toContain("đã khớp");
  });

  test("cancels a triggered order when another open position already exists for the pair", async () => {
    state.loadPendingOrders.mockResolvedValueOnce([pendingOrder()]);
    state.call.mockResolvedValueOnce({
      text: '{"status":"TRIGGERED","confidence":91,"comment":"Entry touched"}',
      usage: { promptTokens: 8, completionTokens: 2 },
    });
    state.saveOpenPosition.mockResolvedValueOnce(false);

    await runner.runCheckPendingOrders();

    expect(state.findOpenPositionIdByPair).not.toHaveBeenCalled();
    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: "CANCELLED",
        runCount: 1,
      }),
    );
    const updatePatch = state.updatePendingOrder.mock.calls[0][1] as Record<string, unknown>;
    expect(updatePatch.triggeredPositionId).toBeUndefined();
    expect(state.sendMessage.mock.calls.map((call) => call[0]).join("\n")).toContain("đang mở");
  });

  test("marks a pending order as cancelled", async () => {
    state.loadPendingOrders.mockResolvedValueOnce([pendingOrder()]);
    state.call.mockResolvedValueOnce({
      text: '{"status":"CANCELLED","confidence":73,"comment":"Pattern failed"}',
      usage: { promptTokens: 8, completionTokens: 2 },
    });

    await runner.runCheckPendingOrders();

    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: "CANCELLED",
        runCount: 1,
      }),
    );
    expect(state.sendMessage.mock.calls.map((call) => call[0]).join("\n")).toContain("không còn hợp lệ");
  });

  test("keeps pending orders quiet until expiry and then expires them", async () => {
    state.loadPendingOrders
      .mockResolvedValueOnce([pendingOrder({ id: 8, runCount: 0, expiryRuns: 2 })])
      .mockResolvedValueOnce([pendingOrder({ id: 9, runCount: 1, expiryRuns: 2 })]);
    state.call
      .mockResolvedValueOnce({
        text: '{"status":"PENDING","confidence":61,"comment":"Still waiting"}',
        usage: { promptTokens: 8, completionTokens: 2 },
      })
      .mockResolvedValueOnce({
        text: '{"status":"PENDING","confidence":60,"comment":"Still waiting"}',
        usage: { promptTokens: 8, completionTokens: 2 },
      });

    await runner.runCheckPendingOrders();
    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      8,
      expect.objectContaining({
        runCount: 1,
      }),
    );
    expect(state.sendMessage.mock.calls.some((call) => String(call[0]).includes("quá hạn"))).toBe(false);

    state.sendMessage.mockClear();
    state.updatePendingOrder.mockClear();
    state.captureVerificationChartScreenshot.mockClear();

    await runner.runCheckPendingOrders();

    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        status: "EXPIRED",
        runCount: 2,
      }),
    );
    expect(state.sendMessage.mock.calls.map((call) => call[0]).join("\n")).toContain("đã quá hạn 2 lần kiểm tra");
  });
});
