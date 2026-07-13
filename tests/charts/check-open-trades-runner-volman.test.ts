import { describe, it, expect, beforeEach, vi } from "vitest";

const positionsRepoMocks = vi.hoisted(() => ({
  buildPositionManagementPatch: vi.fn(),
  updatePositionDecision: vi.fn(),
  closePosition: vi.fn(),
  loadOpenPositions: vi.fn(),
}));

const telegramMocks = vi.hoisted(() => ({
  buildPositionDecisionMessage: vi.fn(),
  buildPositionClosedMessage: vi.fn(),
}));

const telegramClientMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

const decisionMocks = vi.hoisted(() => ({
  resolveOpenPositionDecision: vi.fn(),
}));

const binanceMocks = vi.hoisted(() => ({
  reconcileBinancePosition: vi.fn(),
}));

const screenshotMocks = vi.hoisted(() => ({
  fetchCandleRangeStats: vi.fn(),
  findChartForPair: vi.fn(),
}));

vi.mock("../../src/charts/positions-repository-volman.js", () => positionsRepoMocks);
vi.mock("../../src/shared/telegram-volman.js", () => telegramMocks);
vi.mock("../../src/shared/telegram-client.js", () => telegramClientMocks);
vi.mock("../../src/charts/candle-range-stats.js", () => screenshotMocks);
vi.mock("../../src/charts/volman-charts.config.js", () => ({
  CHARTS: [],
}));
vi.mock("../../src/charts/position-decision-volman.js", () => decisionMocks);
vi.mock("../../src/charts/binance-execution-volman.js", () => binanceMocks);

import { processPosition, runCheckOpenTrades } from "../../src/charts/check-open-trades-runner-volman.js";

describe("check-open-trades-runner-volman", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMinimalPosition = () => ({
    id: 1,
    pair: "EUR/USD",
    direction: "LONG" as const,
    setup: "Breakout",
    entry: "1.1000",
    stopLoss: "1.0900",
    takeProfit1: "1.1100",
    takeProfit2: "1.1200",
    reasons: ["EMA touch"],
    openedAt: "2026-07-01T00:00:00.000Z",
    status: "open" as const,
    binanceSymbol: null,
    binanceEntryOrderId: null,
    binanceEntryOrderType: null,
    binanceEntryOrderPlacedAt: null,
    binanceQuantity: null,
    binanceLeverage: null,
    binanceExecutionStatus: null,
    binanceFailureReason: null,
    binanceFailureAt: null,
    lastDecision: null,
    lastDecisionConfidence: null,
    lastDecisionComment: null,
    lastCheckedAt: null,
    closedAt: null,
    primaryTimeframe: "H4" as const,
    tradeStage: "open" as const,
    tp1ClosePercent: 50,
    tp1ClosedPercent: null,
    tp1ClosedAt: null,
    trailingStopLoss: null,
    trailingStartedAt: null,
    riskRewardRatio: 2,
    tp1RiskRewardRatio: 1,
    tp2RiskRewardRatio: 2,
    minRiskRewardRatio: 0.5,
    lastManagementAction: null,
    lastManagementComment: null,
    lastManagementAt: null,
    closeReason: null,
    realizedRiskRewardRatio: null,
    realizedExitPrice: null,
  });

  it("sends the closed-position message, not the generic decision message, when the position closes", async () => {
    const position = createMinimalPosition();
    position.binanceSymbol = null;

    const decisionResult = {
      decision: "CLOSE" as const,
      confidence: 80,
      comment: "Setup invalidated",
      managementAction: "NONE" as const,
      partialClosePercent: 0,
      newStopLoss: null,
      tp1Reached: false,
      tp2Reached: false,
      riskReward: null,
      tp1RiskReward: 1,
      tp2RiskReward: 2,
    };

    // Mock screenshot functions to make evaluateOpenPosition work
    screenshotMocks.findChartForPair.mockReturnValue({ symbol: "EUR_USD" });
    screenshotMocks.fetchCandleRangeStats.mockResolvedValue({ high: 1.15, low: 1.08 });
    decisionMocks.resolveOpenPositionDecision.mockReturnValue(decisionResult);

    positionsRepoMocks.buildPositionManagementPatch.mockReturnValue({
      patch: { tradeStage: "closed" },
      closePosition: true,
    });

    const snapshot = {
      closeReason: "take_profit_2",
      realizedExitPrice: "1.1200",
      realizedRiskRewardRatio: 2,
      outcome: "win" as const,
    };

    positionsRepoMocks.closePosition.mockResolvedValue(snapshot);

    telegramMocks.buildPositionClosedMessage.mockReturnValue(
      "🏁 *Vị thế #1 đã đóng* — EUR/USD LONG\n📋 Breakout\n🟢 *THẮNG* — 2R\nLý do: Chạm TP2\nEntry: 1.1000 → Exit: 1.1200",
    );

    await processPosition(position);

    // Verify closePosition was called
    expect(positionsRepoMocks.closePosition).toHaveBeenCalled();

    // Verify buildPositionClosedMessage was called with the snapshot
    expect(telegramMocks.buildPositionClosedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Breakout",
        entry: "1.1000",
      }),
      snapshot,
      { isFailSafeClose: false },
    );

    // Verify the closed message was sent (not the generic decision message)
    expect(telegramClientMocks.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("🏁 *Vị thế #1 đã đóng*"),
    );
    expect(telegramClientMocks.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("THẮNG"),
    );
    expect(telegramClientMocks.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("2R"),
    );

    // Verify the generic decision message was NOT sent
    expect(telegramMocks.buildPositionDecisionMessage).not.toHaveBeenCalled();
  });

  it("flags a fail-safe close instead of labeling it a manual close", async () => {
    const position = createMinimalPosition();
    position.binanceSymbol = "BTCUSDT";
    position.binanceExecutionStatus = "failed";

    const decisionResult = {
      decision: "CLOSE" as const,
      confidence: 100,
      comment: "Execution Binance thất bại — vị thế đã được fail-safe đóng khẩn cấp trên sàn",
      managementAction: "NONE" as const,
      partialClosePercent: 0,
      newStopLoss: null,
      tp1Reached: false,
      tp2Reached: false,
      riskReward: null,
      tp1RiskReward: null,
      tp2RiskReward: null,
    };

    binanceMocks.reconcileBinancePosition.mockResolvedValue(decisionResult);

    positionsRepoMocks.buildPositionManagementPatch.mockReturnValue({
      patch: { tradeStage: "closed" },
      closePosition: true,
    });

    const snapshot = {
      closeReason: "manual_close",
      realizedExitPrice: "49000",
      realizedRiskRewardRatio: -1,
      outcome: "loss" as const,
    };

    positionsRepoMocks.closePosition.mockResolvedValue(snapshot);

    telegramMocks.buildPositionClosedMessage.mockReturnValue(
      "🏁 *Vị thế #1 đã đóng* — EUR/USD LONG\n🔴 *THUA* — -1R\nLý do: Đóng khẩn cấp do lỗi thực thi trên sàn (fail-safe)",
    );

    await processPosition(position);

    // The fail-safe flag must be derived from binanceExecutionStatus, not from
    // snapshot.closeReason (which is still the generic "manual_close" bucket).
    expect(telegramMocks.buildPositionClosedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      snapshot,
      { isFailSafeClose: true },
    );
  });

  it("does NOT flag a fail-safe close for a signal-only position that recorded a failure reason but never had a live order", async () => {
    // Regression test: binance_execution_status must stay untouched by
    // saveBinanceExecutionFailure (guard/catch paths that fire BEFORE any real entry
    // order exists — binanceSymbol is still null). Before the fix, that helper also wrote
    // binance_execution_status="failed", which made a signal-only position closing
    // normally on a real SL/TP hit get mislabeled as a "fail-safe emergency close" in the
    // Telegram message, even though no live order was ever placed.
    const position = createMinimalPosition();
    position.binanceSymbol = null;
    position.binanceExecutionStatus = null;
    position.binanceFailureReason = "symbol_already_has_position (timeframe: H4)";

    const decisionResult = {
      decision: "CLOSE" as const,
      confidence: 90,
      comment: "Stop loss hit",
      managementAction: "NONE" as const,
      partialClosePercent: 0,
      newStopLoss: null,
      tp1Reached: false,
      tp2Reached: false,
      riskReward: null,
      tp1RiskReward: null,
      tp2RiskReward: null,
    };

    screenshotMocks.findChartForPair.mockReturnValue({ symbol: "EUR_USD" });
    screenshotMocks.fetchCandleRangeStats.mockResolvedValue({ high: 1.09, low: 1.085 });
    decisionMocks.resolveOpenPositionDecision.mockReturnValue(decisionResult);

    positionsRepoMocks.buildPositionManagementPatch.mockReturnValue({
      patch: { tradeStage: "closed" },
      closePosition: true,
    });

    const snapshot = {
      closeReason: "stop_loss",
      realizedExitPrice: "1.0900",
      realizedRiskRewardRatio: -1,
      outcome: "loss" as const,
    };

    positionsRepoMocks.closePosition.mockResolvedValue(snapshot);

    telegramMocks.buildPositionClosedMessage.mockReturnValue(
      "🏁 *Vị thế #1 đã đóng* — EUR/USD LONG\n🔴 *THUA* — -1R\nLý do: Chạm Stop Loss",
    );

    await processPosition(position);

    expect(telegramMocks.buildPositionClosedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      snapshot,
      { isFailSafeClose: false },
    );
  });

  it("still sends the generic decision message when the position is only held/managed, not closed", async () => {
    const position = createMinimalPosition();
    position.binanceSymbol = null;

    const decisionResult = {
      decision: "HOLD" as const,
      confidence: 80,
      comment: "Waiting for TP",
      managementAction: "NONE" as const,
      partialClosePercent: 0,
      newStopLoss: null,
      tp1Reached: false,
      tp2Reached: false,
      riskReward: null,
      tp1RiskReward: 1,
      tp2RiskReward: 2,
    };

    // Mock screenshot functions to make evaluateOpenPosition work
    screenshotMocks.findChartForPair.mockReturnValue({ symbol: "EUR_USD" });
    screenshotMocks.fetchCandleRangeStats.mockResolvedValue({ high: 1.15, low: 1.08 });
    decisionMocks.resolveOpenPositionDecision.mockReturnValue(decisionResult);

    positionsRepoMocks.buildPositionManagementPatch.mockReturnValue({
      patch: null,
      closePosition: false,
    });

    telegramMocks.buildPositionDecisionMessage.mockReturnValue(
      "🟢 Tiếp tục giữ lệnh.\nHiện tại: ...",
    );

    await processPosition(position);

    // Verify closePosition was NOT called
    expect(positionsRepoMocks.closePosition).not.toHaveBeenCalled();

    // Verify buildPositionClosedMessage was NOT called
    expect(telegramMocks.buildPositionClosedMessage).not.toHaveBeenCalled();

    // Verify the generic decision message was sent
    expect(telegramMocks.buildPositionDecisionMessage).toHaveBeenCalled();

    expect(telegramClientMocks.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("🟢 Tiếp tục giữ lệnh"),
    );
  });

  it("uses the position's own primaryTimeframe when looking up its chart, not a hardcoded H4", async () => {
    // Regression: evaluateOpenPosition used to hardcode findChartForPair(..., "H4")
    // regardless of which timeframe the position actually opened on. A position opened
    // from an M15 signal must look up its M15 chart, not H4's.
    const position = createMinimalPosition();
    position.binanceSymbol = null;
    position.primaryTimeframe = "M15";

    screenshotMocks.findChartForPair.mockReturnValue({ symbol: "EUR_USD" });
    screenshotMocks.fetchCandleRangeStats.mockResolvedValue({ high: 1.15, low: 1.08 });
    decisionMocks.resolveOpenPositionDecision.mockReturnValue({
      decision: "HOLD" as const,
      confidence: 80,
      comment: "Waiting",
      managementAction: "NONE" as const,
      partialClosePercent: 0,
      newStopLoss: null,
      tp1Reached: false,
      tp2Reached: false,
      riskReward: null,
      tp1RiskReward: 1,
      tp2RiskReward: 2,
    });
    positionsRepoMocks.buildPositionManagementPatch.mockReturnValue({
      patch: null,
      closePosition: false,
    });
    telegramMocks.buildPositionDecisionMessage.mockReturnValue("...");

    await processPosition(position);

    expect(screenshotMocks.findChartForPair).toHaveBeenCalledWith(
      expect.anything(),
      "EUR/USD",
      "M15",
    );
  });

  it("falls back to H4 when a position has no primaryTimeframe recorded", async () => {
    const position = createMinimalPosition();
    position.binanceSymbol = null;
    position.primaryTimeframe = null as any;

    screenshotMocks.findChartForPair.mockReturnValue({ symbol: "EUR_USD" });
    screenshotMocks.fetchCandleRangeStats.mockResolvedValue({ high: 1.15, low: 1.08 });
    decisionMocks.resolveOpenPositionDecision.mockReturnValue({
      decision: "HOLD" as const,
      confidence: 80,
      comment: "Waiting",
      managementAction: "NONE" as const,
      partialClosePercent: 0,
      newStopLoss: null,
      tp1Reached: false,
      tp2Reached: false,
      riskReward: null,
      tp1RiskReward: 1,
      tp2RiskReward: 2,
    });
    positionsRepoMocks.buildPositionManagementPatch.mockReturnValue({
      patch: null,
      closePosition: false,
    });
    telegramMocks.buildPositionDecisionMessage.mockReturnValue("...");

    await processPosition(position);

    expect(screenshotMocks.findChartForPair).toHaveBeenCalledWith(
      expect.anything(),
      "EUR/USD",
      "H4",
    );
  });
});

describe("runCheckOpenTrades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks open positions across every timeframe by default, not just one", async () => {
    // Regression: runCheckOpenTrades used to take a single required timeframe param, so
    // positions opened from M15/H1 signals were never checked for SL/TP at all once the
    // scanner started producing signals on those timeframes too.
    positionsRepoMocks.loadOpenPositions.mockResolvedValue([]);

    await runCheckOpenTrades();

    const checkedTimeframes = positionsRepoMocks.loadOpenPositions.mock.calls.map((call) => call[0]);
    expect(checkedTimeframes.sort()).toEqual(["D1", "H1", "H4", "M15", "M30"]);
  });

  it("still supports checking a specific subset of timeframes when explicitly passed", async () => {
    positionsRepoMocks.loadOpenPositions.mockResolvedValue([]);

    await runCheckOpenTrades(["H4"]);

    expect(positionsRepoMocks.loadOpenPositions).toHaveBeenCalledTimes(1);
    expect(positionsRepoMocks.loadOpenPositions).toHaveBeenCalledWith("H4");
  });
});
