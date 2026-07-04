import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  findChartForPair: vi.fn(),
  captureVerificationChartScreenshot: vi.fn(),
  fetchCandleRangeStats: vi.fn(),
  decidePosition: vi.fn(),
  buildPositionManagementPatch: vi.fn(),
  updatePositionDecision: vi.fn(),
  closePosition: vi.fn(),
  buildPositionDecisionMessage: vi.fn(),
  sendMessage: vi.fn(async () => undefined),
  sendPhoto: vi.fn(async () => undefined),
}));

vi.mock("../../src/charts/screenshot.js", () => ({
  findChartForPair: state.findChartForPair,
  captureVerificationChartScreenshot: state.captureVerificationChartScreenshot,
  fetchCandleRangeStats: state.fetchCandleRangeStats,
}));
vi.mock("../../src/charts/position-decision.js", () => ({
  decidePosition: state.decidePosition,
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
  sendPhoto: state.sendPhoto,
}));

const runner = await import("../../src/charts/check-open-trades-runner.js");

describe("charts/check-open-trades-runner", () => {
  beforeEach(() => {
    state.findChartForPair.mockReset();
    state.captureVerificationChartScreenshot.mockReset();
    state.fetchCandleRangeStats.mockReset();
    state.decidePosition.mockReset();
    state.buildPositionManagementPatch.mockReset();
    state.updatePositionDecision.mockReset();
    state.closePosition.mockReset();
    state.buildPositionDecisionMessage.mockReset();
    state.sendMessage.mockClear();
    state.sendPhoto.mockClear();

    state.findChartForPair.mockReturnValue({
      symbol: "EURUSD",
      name: "EUR/USD H4",
      timeframe: "H4",
      interval: "240",
      description: "",
    });
    state.captureVerificationChartScreenshot.mockResolvedValue({
      chart: { symbol: "EURUSD", name: "EUR/USD H4", timeframe: "H4", interval: "240", description: "" },
      buffer: Buffer.from("chart"),
      filepath: "/tmp/chart-h4.jpg",
      lastPrice: 1.0995,
    });
    state.buildPositionManagementPatch.mockReturnValue({ patch: {}, closePosition: false });
    state.updatePositionDecision.mockResolvedValue(true);
    state.closePosition.mockResolvedValue(true);
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
    };
  }

  function priceDecision(overrides: Record<string, unknown> = {}) {
    return {
      decision: "HOLD" as const,
      confidence: 99,
      comment: "Price has reached TP1",
      managementAction: "PARTIAL_TP1" as const,
      partialClosePercent: 50,
      newStopLoss: "1.1000",
      tp1Reached: true,
      tp2Reached: false,
      riskReward: 2.0,
      tp1RiskReward: 1.0,
      tp2RiskReward: 2.0,
      ...overrides,
    };
  }

  function aiDecision(overrides: Record<string, unknown> = {}) {
    return {
      decision: "HOLD" as const,
      confidence: 75,
      comment: "AI decision based on chart",
      managementAction: "NONE" as const,
      partialClosePercent: 0,
      newStopLoss: null,
      tp1Reached: false,
      tp2Reached: false,
      riskReward: null,
      tp1RiskReward: null,
      tp2RiskReward: null,
      ...overrides,
    };
  }

  test("skips AI vision call when price data resolves position", async () => {
    const position = openPosition();
    const stats = { high: 1.1040, low: 1.0995, lastClose: 1.1038 };

    state.fetchCandleRangeStats.mockResolvedValue(stats);
    state.decidePosition.mockResolvedValue(aiDecision());

    await runner.processPosition(position);

    expect(state.fetchCandleRangeStats).toHaveBeenCalledWith("EURUSD", position.openedAt);
    expect(state.captureVerificationChartScreenshot).not.toHaveBeenCalled();
    expect(state.sendPhoto).not.toHaveBeenCalled();
    expect(state.decidePosition).not.toHaveBeenCalled();
    expect(state.updatePositionDecision).toHaveBeenCalled();
    expect(state.sendMessage).toHaveBeenCalled();
  });

  test("calls AI vision when price data is null", async () => {
    const position = openPosition();
    state.fetchCandleRangeStats.mockResolvedValue(null);
    state.decidePosition.mockResolvedValue(aiDecision());

    await runner.processPosition(position);

    expect(state.fetchCandleRangeStats).toHaveBeenCalledWith("EURUSD", position.openedAt);
    expect(state.captureVerificationChartScreenshot).toHaveBeenCalledWith({
      symbol: "EURUSD",
      name: "EUR/USD H4",
      timeframe: "H4",
      interval: "240",
      description: "",
    });
    expect(state.sendPhoto).toHaveBeenCalled();
    expect(state.decidePosition).toHaveBeenCalledWith(position, expect.objectContaining({ buffer: expect.any(Buffer) }));
    expect(state.updatePositionDecision).toHaveBeenCalled();
    expect(state.sendMessage).toHaveBeenCalled();
  });

  test("uses price decision over AI decision when price resolves", async () => {
    const position = openPosition();
    const stats = { high: 1.1040, low: 1.0995, lastClose: 1.1038 };
    const expectedDecision = priceDecision();

    state.fetchCandleRangeStats.mockResolvedValue(stats);
    state.decidePosition.mockResolvedValue(aiDecision());

    await runner.processPosition(position);

    const updateCall = state.updatePositionDecision.mock.calls[0];
    const usedDecision = updateCall[1];
    expect(usedDecision.comment).toMatch(/chạm TP1/);
  });

  test("handles missing chart gracefully", async () => {
    const position = openPosition();
    state.findChartForPair.mockReturnValue(null);

    await runner.processPosition(position);

    expect(state.fetchCandleRangeStats).not.toHaveBeenCalled();
    expect(state.captureVerificationChartScreenshot).not.toHaveBeenCalled();
    expect(state.decidePosition).not.toHaveBeenCalled();
    expect(state.updatePositionDecision).not.toHaveBeenCalled();
  });
});
