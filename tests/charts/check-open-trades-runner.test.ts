import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  findChartForPair: vi.fn(),
  fetchCandleRangeStats: vi.fn(),
  buildPositionManagementPatch: vi.fn(),
  updatePositionDecision: vi.fn(),
  closePosition: vi.fn(),
  buildPositionDecisionMessage: vi.fn(),
  sendMessage: vi.fn(async () => undefined),
}));

vi.mock("../../src/charts/screenshot.js", () => ({
  findChartForPair: state.findChartForPair,
  fetchCandleRangeStats: state.fetchCandleRangeStats,
}));
vi.mock("../../src/charts/positions-repository.js", () => ({
  buildPositionManagementPatch: state.buildPositionManagementPatch,
  updatePositionDecision: state.updatePositionDecision,
  closePosition: state.closePosition,
  loadOpenPositions: vi.fn(),
}));
vi.mock("../../src/shared/telegram.js", () => ({
  buildPositionDecisionMessage: state.buildPositionDecisionMessage,
  sendMessage: state.sendMessage,
}));

let runner: any;

beforeAll(async () => {
  runner = await import("../../src/charts/check-open-trades-runner.js");
});

describe("charts/check-open-trades-runner", () => {
  beforeEach(() => {
    state.findChartForPair.mockReset();
    state.fetchCandleRangeStats.mockReset();
    state.buildPositionManagementPatch.mockReset();
    state.updatePositionDecision.mockReset();
    state.closePosition.mockReset();
    state.buildPositionDecisionMessage.mockReset();
    state.sendMessage.mockClear();

    state.findChartForPair.mockReturnValue({
      symbol: "EURUSD",
      name: "EUR/USD H4",
      timeframe: "H4",
      interval: "240",
      description: "",
    });
    state.buildPositionManagementPatch.mockImplementation((_position, decision) => ({
      patch:
        decision.managementAction === "PARTIAL_TP1"
          ? { tradeStage: "tp1_partial", tp1ClosedPercent: 50, trailingStopLoss: "1.1000", stopLoss: "1.1000" }
          : decision.managementAction === "MOVE_SL_TO_BE"
            ? { tradeStage: "trailing", trailingStopLoss: "1.1000", stopLoss: "1.1000" }
            : decision.decision === "STOP" || decision.decision === "CLOSE"
              ? { tradeStage: "closed" }
              : null,
      closePosition: decision.decision === "STOP" || decision.decision === "CLOSE",
    }));
    state.updatePositionDecision.mockResolvedValue(undefined);
    state.closePosition.mockResolvedValue(undefined);
    state.buildPositionDecisionMessage.mockReturnValue("Test message");
  });

  function openPosition(overrides: Record<string, unknown> = {}) {
    return {
      id: "pos-123",
      pair: "EUR/USD",
      direction: "LONG" as const,
      setup: "RB",
      entry: "1.1000",
      stopLoss: "1.0980",
      takeProfit1: "1.1040",
      takeProfit2: "1.1080",
      reasons: ["EMA20 slope positive"],
      tradeStage: "open" as const,
      openedAt: Date.now() - 86400000,
      lastDecision: null,
      lastDecisionConfidence: 0,
      lastDecisionComment: null,
      tp1ClosedPercent: 0,
      trailingStopLoss: null,
      ...overrides,
    } as any;
  }

  test("chạm TP1 lần đầu → HOLD + PARTIAL_TP1", async () => {
    const position = openPosition();
    state.fetchCandleRangeStats.mockResolvedValue({ high: 1.1040, low: 1.0995, lastClose: 1.1038 });

    await runner.processPosition(position);

    expect(state.fetchCandleRangeStats).toHaveBeenCalledWith("EURUSD", position.openedAt);
    expect(state.updatePositionDecision).toHaveBeenCalledWith(
      position.id,
      expect.objectContaining({
        decision: "HOLD",
        managementAction: "PARTIAL_TP1",
        comment: expect.stringContaining("TP1"),
      }),
      expect.objectContaining({ tradeStage: "tp1_partial" }),
    );
    expect(state.closePosition).not.toHaveBeenCalled();
    expect(state.sendMessage).toHaveBeenCalled();
  });

  test("không có OHLC → HOLD warning, không AI", async () => {
    const position = openPosition();
    state.fetchCandleRangeStats.mockResolvedValue(null);

    await runner.processPosition(position);

    expect(state.fetchCandleRangeStats).toHaveBeenCalledWith("EURUSD", position.openedAt);
    expect(state.updatePositionDecision).toHaveBeenCalledWith(
      position.id,
      expect.objectContaining({
        decision: "HOLD",
        managementAction: "NONE",
        comment: expect.stringContaining("Chưa lấy được OHLC"),
      }),
      null,
    );
    expect(state.closePosition).not.toHaveBeenCalled();
    expect(state.sendMessage).toHaveBeenCalledWith(expect.stringContaining("Không lấy được OHLC"));
  });

  test("đã partial rồi và còn dư địa theo OHLC → dời SL về entry", async () => {
    const position = openPosition({ tradeStage: "tp1_partial", tp1ClosedPercent: 50, trailingStopLoss: null });
    state.fetchCandleRangeStats.mockResolvedValue({ high: 1.1055, low: 1.1001, lastClose: 1.1050 });

    await runner.processPosition(position);

    expect(state.updatePositionDecision).toHaveBeenCalledWith(
      position.id,
      expect.objectContaining({
        decision: "HOLD",
        managementAction: "MOVE_SL_TO_BE",
        comment: expect.stringContaining("dời SL về entry"),
      }),
      expect.objectContaining({ tradeStage: "trailing", trailingStopLoss: "1.1000" }),
    );
  });

  test("không có chart config → HOLD + gửi Telegram warning cấu hình chart thiếu", async () => {
    const position = openPosition();
    state.findChartForPair.mockReturnValue(null);

    await runner.processPosition(position);

    expect(state.fetchCandleRangeStats).not.toHaveBeenCalled();
    expect(state.updatePositionDecision).toHaveBeenCalledWith(
      position.id,
      expect.objectContaining({
        decision: "HOLD",
        comment: expect.stringContaining("Không tìm thấy cấu hình chart"),
      }),
      null,
    );
    expect(state.updatePositionDecision).toHaveBeenCalledWith(
      position.id,
      expect.objectContaining({
        comment: expect.not.stringContaining("Chưa lấy được OHLC"),
      }),
      null,
    );
    expect(state.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Không tìm thấy cấu hình chart"),
    );
    expect(state.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("không thể xác minh SL/TP"),
    );
  });
});
