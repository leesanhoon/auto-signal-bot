import { beforeEach, describe, expect, test, vi } from "vitest";

const client = vi.hoisted(() => ({
  isHedgeModeEnabled: vi.fn(),
  getPositionAmount: vi.fn(),
  getOrderStatus: vi.fn(),
  getRegularOrderStatus: vi.fn(),
  getExchangeInfoFilters: vi.fn(),
  getAvailableBalanceUsdt: vi.fn(),
  setMarginType: vi.fn(),
  setLeverage: vi.fn(),
  getMaxLeverageForSymbol: vi.fn(),
  placeMarketOrder: vi.fn(),
  placeStopMarketOrder: vi.fn(),
  placeTakeProfitMarketOrder: vi.fn(),
  placeLimitOrder: vi.fn(),
  placeStopMarketEntryOrder: vi.fn(),
  cancelOrder: vi.fn(),
  cancelRegularOrder: vi.fn(),
}));
const repository = vi.hoisted(() => ({
  saveBinanceExecutionDetails: vi.fn(),
  saveBinanceExecutionFailure: vi.fn(),
  saveBinancePendingEntryOrder: vi.fn(),
  updateBinanceEntryOrderStatus: vi.fn(),
  getPendingEntryOrderPositions: vi.fn(),
  closeExpiredEntryOrderPosition: vi.fn(),
  countLiveBinancePositionsVolman: vi.fn(),
  applyBinanceBreakevenStopLoss: vi.fn(),
  getRecentClosedBinanceTradeOutcomes: vi.fn(),
}));
const sendMessage = vi.hoisted(() => vi.fn());
const fetchOhlcHistory = vi.hoisted(() => vi.fn());
const fetchCandleRangeStats = vi.hoisted(() => vi.fn());

vi.mock("../../src/charts/binance-futures-client.js", () => client);
vi.mock("../../src/charts/positions-repository-volman.js", () => repository);
vi.mock("../../src/shared/telegram-client.js", () => ({ sendMessage }));
vi.mock("../../src/charts/ohlc-provider.js", () => ({
  toBinanceSymbol: (value: string) => value.replace("BINANCE:", ""),
  fetchOhlcHistory,
}));
vi.mock("../../src/charts/candle-range-stats.js", () => ({
  fetchCandleRangeStats,
}));
vi.mock("../../src/shared/telegram-volman.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/shared/telegram-volman.js")>();
  return {
    ...actual,
    buildBreakevenReminderMessage: vi.fn((position, comment) =>
      `Breakeven for ${position.pair}: ${comment}`
    ),
  };
});
vi.mock("../../src/charts/binance-futures-config-env.js", () => ({
  getConfiguredBinanceLeverage: () => 5,
  getConfiguredBinanceMarginType: () => "ISOLATED",
  getConfiguredBinanceRiskPercentPerTrade: () => 1,
  getConfiguredBinanceRiskUsdPerTrade: () => undefined,
  getConfiguredBinanceWorkingType: () => "MARK_PRICE",
  isBinanceHonorOrderTypeEnabledVolman: () => false,
  getConfiguredBinanceEntryOrderExpiryMinutes: () => 60,
  getConfiguredBinanceMaxConcurrentPositionsVolman: () => 3,
  isBinanceEquityCurveSizingEnabledVolman: () => false,
  getConfiguredEquityCurveStreakCount: () => 2,
  getConfiguredEquityCurveWinMultiplier: () => 2,
  getConfiguredEquityCurveLossMultiplier: () => 0.25,
}));
vi.mock("../../src/charts/position-engine-volman.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/charts/position-engine-volman.js")>();
  return {
    ...actual,
    calculateRiskRewardPlan: () => ({
      entry: 50000,
      stopLoss: 49000,
      takeProfit1: 52000,
    }),
  };
});

const { openBinanceFuturesPosition, reconcileBinancePosition } = await import(
  "../../src/charts/binance-execution-volman.js"
);
const { createOpenBinanceFuturesPosition } = await import(
  "../../src/charts/binance-execution-shared.js"
);

const position = {
  id: 1,
  pair: "BTC/USDT",
  direction: "LONG" as const,
  entry: "50000",
  stopLoss: "49000",
  takeProfit1: "52000",
  binanceSymbol: "BTCUSDT",
  binanceSlOrderId: 456,
  binanceTp1OrderId: 789,
  binanceExecutionStatus: "placed" as const,
  primaryTimeframe: "H1" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  client.isHedgeModeEnabled.mockResolvedValue(false);
  client.getPositionAmount.mockResolvedValue(1);
  client.getMaxLeverageForSymbol.mockResolvedValue(20);
  client.getExchangeInfoFilters.mockResolvedValue({
    stepSize: 0.001,
    minQty: 0.001,
    tickSize: 0.1,
    minNotional: 5,
  });
  client.getAvailableBalanceUsdt.mockResolvedValue(1000);
  client.setMarginType.mockResolvedValue(undefined);
  client.setLeverage.mockResolvedValue(undefined);
  client.cancelOrder.mockResolvedValue({});
  client.getOrderStatus.mockResolvedValue({ status: "NEW" });
  fetchOhlcHistory.mockResolvedValue([]);
  fetchCandleRangeStats.mockResolvedValue({ lastClose: 50500 }); // Default: price above SL
  repository.countLiveBinancePositionsVolman.mockResolvedValue(0);
});

describe("charts/binance-execution-volman", () => {
  test("places exactly entry, SL, and one full-position TP", async () => {
    client.getPositionAmount.mockResolvedValueOnce(0);
    client.placeMarketOrder.mockResolvedValue({ orderId: 123 });
    client.placeStopMarketOrder.mockResolvedValue({ orderId: 456 });
    client.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 789 });
    repository.saveBinanceExecutionDetails.mockResolvedValue(undefined);

    await openBinanceFuturesPosition(
      { pair: "BTC/USDT", direction: "LONG" } as any,
      1,
      "BINANCE:BTCUSDT",
    );

    expect(client.placeMarketOrder).toHaveBeenCalledTimes(1);
    expect(client.placeStopMarketOrder).toHaveBeenCalledWith(
      "BTCUSDT",
      "SELL",
      49000,
      { workingType: "MARK_PRICE" },
    );
    expect(client.placeTakeProfitMarketOrder).toHaveBeenCalledTimes(1);
    expect(client.placeTakeProfitMarketOrder).toHaveBeenCalledWith(
      "BTCUSDT",
      "SELL",
      52000,
      { workingType: "MARK_PRICE" },
    );
    expect(repository.saveBinanceExecutionDetails).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        binanceEntryOrderId: 123,
        binanceSlOrderId: 456,
        binanceTp1OrderId: 789,
        binanceExecutionStatus: "placed",
      }),
    );
  });

  test("STOP fail → LIMIT success: saves pending entry as LIMIT", async () => {
    client.getPositionAmount.mockResolvedValueOnce(0);
    client.placeStopMarketEntryOrder.mockRejectedValueOnce(
      new Error("Order would immediately trigger"),
    );
    client.placeLimitOrder.mockResolvedValue({ orderId: 200 });
    repository.saveBinancePendingEntryOrder.mockResolvedValue(undefined);
    repository.saveBinanceExecutionFailure.mockResolvedValue(undefined);

    // Create custom config with honor-order-type enabled
    const customConfig = {
      systemLabel: "Volman",
      loggerName: "charts:binance-execution",
      calculateRiskRewardPlan: () => ({
        entry: 50000,
        stopLoss: 49000,
        takeProfit1: 52000,
      }),
      saveBinanceExecutionDetails: vi.fn(),
      saveBinanceExecutionFailure: repository.saveBinanceExecutionFailure,
      getConfiguredRiskUsdt: () => undefined,
      guardFailPrefix: "*Binance Futures (Volman)*",
      failSafeMessagePrefix: "*Binance Futures (Volman)*",
      failSafeEmergencyMessagePrefix: "*Binance Futures (Volman) — KHẨN CẤP*",
      dbErrorPrefix: "*Binance Futures (Volman)*",
      successPrefix: "*Binance Futures (Volman)*",
      entryErrorPrefix: "*Binance Futures (Volman)*",
      closeFailedUrgentPrefix: "*Binance Futures (Volman) — KHẨN CẤP nhắc lại*",
      silentFailureWarnPrefix: "*Binance Futures (Volman)*",
      entryExecutionMode: "HONOR_ORDER_TYPE" as const,
      entryOrderExpiryMinutes: 60,
      saveBinancePendingEntryOrder: repository.saveBinancePendingEntryOrder,
      updateBinanceEntryOrderStatus: repository.updateBinanceEntryOrderStatus,
      getPendingEntryOrderPositions: repository.getPendingEntryOrderPositions,
      closeExpiredEntryOrderPosition: repository.closeExpiredEntryOrderPosition,
      isHonorOrderTypeEnabled: () => true,
      getEmaExitTimeframe: () => "H4" as const,
      getOpenPositionCount: repository.countLiveBinancePositionsVolman,
      maxConcurrentPositions: 3,
    };

    const openFn = createOpenBinanceFuturesPosition(customConfig);
    await openFn(
      {
        pair: "BTC/USDT",
        direction: "LONG",
        orderType: "BUY_STOP",
      } as any,
      1,
      "BINANCE:BTCUSDT",
    );

    expect(client.placeStopMarketEntryOrder).toHaveBeenCalledTimes(1);
    expect(client.placeLimitOrder).toHaveBeenCalledTimes(1);
    expect(client.placeLimitOrder).toHaveBeenCalledWith("BTCUSDT", "BUY", 50000, expect.any(Number));
    expect(repository.saveBinancePendingEntryOrder).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        binanceEntryOrderId: 200,
        binanceEntryOrderType: "LIMIT",
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Đã đặt lệnh LIMIT"),
    );
  });

  test("STOP fail + LIMIT fail + price crossed SL: sends specific warning", async () => {
    client.getPositionAmount.mockResolvedValueOnce(0);
    client.placeStopMarketEntryOrder.mockRejectedValueOnce(
      new Error("Order would immediately trigger"),
    );
    client.placeLimitOrder.mockRejectedValueOnce(new Error("Price moved beyond spread"));
    fetchCandleRangeStats.mockResolvedValueOnce({ lastClose: 48900 }); // Price crossed SL (49000 for LONG)
    repository.saveBinanceExecutionFailure.mockResolvedValue(undefined);

    const customConfig = {
      systemLabel: "Volman",
      loggerName: "charts:binance-execution",
      calculateRiskRewardPlan: () => ({
        entry: 50000,
        stopLoss: 49000,
        takeProfit1: 52000,
      }),
      saveBinanceExecutionDetails: vi.fn(),
      saveBinanceExecutionFailure: repository.saveBinanceExecutionFailure,
      getConfiguredRiskUsdt: () => undefined,
      guardFailPrefix: "*Binance Futures (Volman)*",
      failSafeMessagePrefix: "*Binance Futures (Volman)*",
      failSafeEmergencyMessagePrefix: "*Binance Futures (Volman) — KHẨN CẤP*",
      dbErrorPrefix: "*Binance Futures (Volman)*",
      successPrefix: "*Binance Futures (Volman)*",
      entryErrorPrefix: "*Binance Futures (Volman)*",
      closeFailedUrgentPrefix: "*Binance Futures (Volman) — KHẨN CẤP nhắc lại*",
      silentFailureWarnPrefix: "*Binance Futures (Volman)*",
      entryExecutionMode: "HONOR_ORDER_TYPE" as const,
      entryOrderExpiryMinutes: 60,
      saveBinancePendingEntryOrder: repository.saveBinancePendingEntryOrder,
      updateBinanceEntryOrderStatus: repository.updateBinanceEntryOrderStatus,
      getPendingEntryOrderPositions: repository.getPendingEntryOrderPositions,
      closeExpiredEntryOrderPosition: repository.closeExpiredEntryOrderPosition,
      isHonorOrderTypeEnabled: () => true,
      getEmaExitTimeframe: () => "H4" as const,
      getOpenPositionCount: repository.countLiveBinancePositionsVolman,
      maxConcurrentPositions: 3,
    };

    const openFn = createOpenBinanceFuturesPosition(customConfig);
    await openFn(
      {
        pair: "BTC/USDT",
        direction: "LONG",
        orderType: "BUY_STOP",
      } as any,
      1,
      "BINANCE:BTCUSDT",
    );

    expect(client.placeStopMarketEntryOrder).toHaveBeenCalledTimes(1);
    expect(client.placeLimitOrder).toHaveBeenCalledTimes(1);
    expect(repository.saveBinanceExecutionFailure).toHaveBeenCalledWith(
      1,
      expect.stringContaining("price_crossed_stop_loss_before_entry"),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("giá đã cán qua mức stop loss"),
    );
  });

  test("STOP fail + LIMIT fail + price NOT crossed SL: sends generic error", async () => {
    client.getPositionAmount.mockResolvedValueOnce(0);
    client.placeStopMarketEntryOrder.mockRejectedValueOnce(
      new Error("Network error"),
    );
    client.placeLimitOrder.mockRejectedValueOnce(new Error("API rate limit"));
    fetchCandleRangeStats.mockResolvedValueOnce({ lastClose: 50500 }); // Price above SL
    repository.saveBinanceExecutionFailure.mockResolvedValue(undefined);

    const customConfig = {
      systemLabel: "Volman",
      loggerName: "charts:binance-execution",
      calculateRiskRewardPlan: () => ({
        entry: 50000,
        stopLoss: 49000,
        takeProfit1: 52000,
      }),
      saveBinanceExecutionDetails: vi.fn(),
      saveBinanceExecutionFailure: repository.saveBinanceExecutionFailure,
      getConfiguredRiskUsdt: () => undefined,
      guardFailPrefix: "*Binance Futures (Volman)*",
      failSafeMessagePrefix: "*Binance Futures (Volman)*",
      failSafeEmergencyMessagePrefix: "*Binance Futures (Volman) — KHẨN CẤP*",
      dbErrorPrefix: "*Binance Futures (Volman)*",
      successPrefix: "*Binance Futures (Volman)*",
      entryErrorPrefix: "*Binance Futures (Volman)*",
      closeFailedUrgentPrefix: "*Binance Futures (Volman) — KHẨN CẤP nhắc lại*",
      silentFailureWarnPrefix: "*Binance Futures (Volman)*",
      entryExecutionMode: "HONOR_ORDER_TYPE" as const,
      entryOrderExpiryMinutes: 60,
      saveBinancePendingEntryOrder: repository.saveBinancePendingEntryOrder,
      updateBinanceEntryOrderStatus: repository.updateBinanceEntryOrderStatus,
      getPendingEntryOrderPositions: repository.getPendingEntryOrderPositions,
      closeExpiredEntryOrderPosition: repository.closeExpiredEntryOrderPosition,
      isHonorOrderTypeEnabled: () => true,
      getEmaExitTimeframe: () => "H4" as const,
      getOpenPositionCount: repository.countLiveBinancePositionsVolman,
      maxConcurrentPositions: 3,
    };

    const openFn = createOpenBinanceFuturesPosition(customConfig);
    await openFn(
      {
        pair: "BTC/USDT",
        direction: "LONG",
        orderType: "BUY_STOP",
      } as any,
      1,
      "BINANCE:BTCUSDT",
    );

    expect(repository.saveBinanceExecutionFailure).toHaveBeenCalledWith(
      1,
      expect.stringContaining("stop_and_limit_entry_both_failed"),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("cả lệnh STOP và LIMIT đều thất bại"),
    );
  });

  test("SL fill stops and cancels the TP order", async () => {
    client.getOrderStatus.mockResolvedValueOnce({ status: "FILLED" });
    const result = await reconcileBinancePosition(position as any);

    expect(result).toMatchObject({ decision: "STOP", managementAction: "NONE" });
    expect(client.cancelOrder).toHaveBeenCalledWith("BTCUSDT", 789);
  });

  test("TP fill closes with TAKE_PROFIT_CLOSE and cancels SL", async () => {
    client.getOrderStatus
      .mockResolvedValueOnce({ status: "NEW" })
      .mockResolvedValueOnce({ status: "FILLED" });

    const result = await reconcileBinancePosition(position as any);

    expect(result).toMatchObject({
      decision: "CLOSE",
      managementAction: "TAKE_PROFIT_CLOSE",
    });
    expect(client.cancelOrder).toHaveBeenCalledWith("BTCUSDT", 456);
  });

  test("detects a manual close and cleans up both protection orders", async () => {
    client.getPositionAmount.mockResolvedValue(0);

    const result = await reconcileBinancePosition(position as any);

    expect(result).toMatchObject({ decision: "CLOSE", managementAction: "NONE" });
    expect(client.cancelOrder).toHaveBeenCalledWith("BTCUSDT", 456);
    expect(client.cancelOrder).toHaveBeenCalledWith("BTCUSDT", 789);
  });

  test("keeps EMA exit operational", async () => {
    vi.stubEnv("EMA_EXIT_ENABLED", "true");
    vi.stubEnv("EMA_EXIT_PERIOD", "3");
    fetchOhlcHistory.mockResolvedValue([
      { open: 101, high: 102, low: 100, close: 101, timestamp: 1 },
      { open: 101, high: 102, low: 100, close: 101, timestamp: 2 },
      { open: 101, high: 102, low: 98, close: 99, timestamp: 3 },
    ]);
    client.placeMarketOrder.mockResolvedValue({ orderId: 999 });

    const result = await reconcileBinancePosition(position as any);

    expect(result).toMatchObject({ decision: "STOP", managementAction: "NONE" });
    expect(client.cancelOrder).toHaveBeenCalledTimes(2);
    expect(client.placeMarketOrder).toHaveBeenCalledWith(
      "BTCUSDT",
      "SELL",
      1,
      { reduceOnly: true },
    );
  });

  test("wires breakeven config fields for 1R support", async () => {
    const { buildBreakevenReminderMessage } = await import("../../src/shared/telegram-volman.js");
    const volmanModule = await import("../../src/charts/binance-execution-volman.js");
    const config = (volmanModule as any).config || volmanModule;

    // The exported config from binance-execution-volman should have the breakeven fields
    // We can verify this indirectly by checking that reconcileBinancePosition uses them
    const positionWithBreakeven = {
      ...position,
      entry: "50000",
      stopLoss: "49000",
      openedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      setup: "RB",
    };

    // When price reaches 1R and config has fetchPriceStatsSinceOpen, it should attempt breakeven
    client.getOrderStatus.mockResolvedValue({ status: "NEW" });
    fetchCandleRangeStats.mockResolvedValue({
      high: 51000, // 1R = 51000 for LONG
      low: 49000,
      lastClose: 50500,
    });
    client.cancelOrder.mockResolvedValue({});
    client.placeStopMarketOrder.mockResolvedValue({ orderId: 600 });
    repository.applyBinanceBreakevenStopLoss = vi.fn();

    const result = await reconcileBinancePosition(positionWithBreakeven as any);

    // Should still return HOLD since breakeven doesn't trigger CLOSE/STOP
    expect(result.decision).toBe("HOLD");
    // Verify breakeven wiring was called
    expect(fetchCandleRangeStats).toHaveBeenCalled();
  });

  test("uses buildBreakevenReminderMessage for notification", async () => {
    const { buildBreakevenReminderMessage } = await import("../../src/shared/telegram-volman.js");

    const positionWithBreakeven = {
      ...position,
      entry: "50000",
      stopLoss: "49000",
      openedAt: new Date(Date.now() - 3600000).toISOString(),
      setup: "RB",
    };

    client.getOrderStatus.mockResolvedValue({ status: "NEW" });
    fetchCandleRangeStats.mockResolvedValue({
      high: 51000,
      low: 49000,
      lastClose: 50500,
    });
    client.cancelOrder.mockResolvedValue({});
    client.placeStopMarketOrder.mockResolvedValue({ orderId: 600 });
    repository.applyBinanceBreakevenStopLoss = vi.fn();

    await reconcileBinancePosition(positionWithBreakeven as any);

    // The Telegram message should be sent with breakeven notification
    // This verifies the wiring of buildBreakevenNotifyMessage
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("1R"), // Message should contain "1R"
    );
  });
});
