import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  findChartForPair: vi.fn(),
  fetchCandleRangeStats: vi.fn(),
  loadPendingOrders: vi.fn(),
  updatePendingOrder: vi.fn(),
  saveOpenPosition: vi.fn(),
  findOpenPositionIdByPair: vi.fn(),
  validateTradeSetupForOpen: vi.fn(),
  sendMessage: vi.fn(async () => undefined),
}));

vi.mock("../../src/charts/screenshot.js", () => ({
  findChartForPair: state.findChartForPair,
  fetchCandleRangeStats: state.fetchCandleRangeStats,
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
vi.mock("../../src/shared/telegram.js", () => ({
  sendMessage: state.sendMessage,
}));

let runner: any;

beforeAll(async () => {
  runner = await import("../../src/charts/check-pending-orders-runner.js");
});

describe("charts/check-pending-orders-runner", () => {
  beforeEach(() => {
    state.findChartForPair.mockReset();
    state.fetchCandleRangeStats.mockReset();
    state.loadPendingOrders.mockReset();
    state.updatePendingOrder.mockReset();
    state.saveOpenPosition.mockReset();
    state.findOpenPositionIdByPair.mockReset();
    state.validateTradeSetupForOpen.mockReset();
    state.sendMessage.mockClear();

    state.findChartForPair.mockReturnValue({
      symbol: "EURUSD",
      name: "EUR/USD M15",
      timeframe: "M15",
      interval: "15",
      description: "",
    });
    state.fetchCandleRangeStats.mockResolvedValue({ high: 1.0995, low: 1.0990, lastClose: 1.0993 });
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
    } as any;
  }

  test("marks a pending order as triggered and creates an open position", async () => {
    state.loadPendingOrders.mockResolvedValueOnce([pendingOrder()]);
    state.fetchCandleRangeStats.mockResolvedValueOnce({ high: 1.1002, low: 1.0992, lastClose: 1.1001 });

    await runner.runCheckPendingOrders();

    expect(state.saveOpenPosition).toHaveBeenCalledTimes(1);
    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: "TRIGGERED",
        runCount: 1,
        triggeredPositionId: 123,
        resolvedReason: expect.stringContaining("Khớp lệnh chờ"),
      }),
    );
    expect((state.sendMessage as any).mock.calls.map((call: any[]) => call[0]).join("\n")).toContain("đã khớp");
  });

  test("cancels a triggered order when another open position already exists for the pair", async () => {
    state.loadPendingOrders.mockResolvedValueOnce([pendingOrder()]);
    state.fetchCandleRangeStats.mockResolvedValueOnce({ high: 1.1002, low: 1.0992, lastClose: 1.1001 });
    state.saveOpenPosition.mockResolvedValueOnce(false);

    await runner.runCheckPendingOrders();

    expect(state.findOpenPositionIdByPair).not.toHaveBeenCalled();
    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: "CANCELLED",
        runCount: 1,
        resolvedReason: expect.stringContaining("Đã có vị thế khác"),
      }),
    );
    expect((state.sendMessage as any).mock.calls.map((call: any[]) => call[0]).join("\n")).toContain("không thể tạo vị thế mới");
  });

  test("marks a pending order as cancelled when stop loss is invalidated", async () => {
    state.loadPendingOrders.mockResolvedValueOnce([pendingOrder()]);
    state.fetchCandleRangeStats.mockResolvedValueOnce({ high: 1.1002, low: 1.0975, lastClose: 1.0980 });

    await runner.runCheckPendingOrders();

    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: "CANCELLED",
        runCount: 1,
        resolvedReason: expect.stringContaining("xuyên stop loss"),
      }),
    );
    expect((state.sendMessage as any).mock.calls.map((call: any[]) => call[0]).join("\n")).toContain("hủy lệnh chờ");
  });

  test("WAIT_FOR_CONFIRMATION triggers and expires with deterministic confirmation", async () => {
    state.loadPendingOrders
      .mockResolvedValueOnce([pendingOrder({ id: 8, orderType: "WAIT_FOR_CONFIRMATION" })])
      .mockResolvedValueOnce([pendingOrder({ id: 9, runCount: 1, expiryRuns: 2, orderType: "WAIT_FOR_CONFIRMATION" })]);
    state.fetchCandleRangeStats.mockResolvedValueOnce({ high: 1.1002, low: 1.0992, lastClose: 1.1001 });

    await runner.runCheckPendingOrders();
    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      8,
      expect.objectContaining({
        status: "TRIGGERED",
        runCount: 1,
        resolvedReason: expect.stringContaining("xác nhận entry"),
      }),
    );

    state.sendMessage.mockClear();
    state.updatePendingOrder.mockClear();
    state.findOpenPositionIdByPair.mockResolvedValueOnce(null);

    await runner.runCheckPendingOrders();

    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        status: "EXPIRED",
        runCount: 2,
        resolvedReason: expect.stringContaining("Quá hạn"),
      }),
    );
    expect((state.sendMessage as any).mock.calls.map((call: any[]) => call[0]).join("\n")).toContain("quá hạn 2 lần kiểm tra");
  });

  test("không có chart config → giữ PENDING + gửi Telegram warning cấu hình chart thiếu", async () => {
    state.loadPendingOrders.mockResolvedValueOnce([pendingOrder({ id: 10, expiryRuns: 3 })]);
    state.findChartForPair.mockReturnValueOnce(null);

    await runner.runCheckPendingOrders();

    expect(state.fetchCandleRangeStats).not.toHaveBeenCalled();
    // Order stays PENDING, runCount incremented
    expect(state.updatePendingOrder).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ runCount: 1 }),
    );
    expect(state.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Không tìm thấy cấu hình chart"),
    );
    expect(state.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("không thể xác minh trigger / invalidation"),
    );
  });
});
