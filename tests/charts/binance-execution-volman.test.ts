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
}));
const sendMessage = vi.hoisted(() => vi.fn());
const fetchOhlcHistory = vi.hoisted(() => vi.fn());

vi.mock("../../src/charts/binance-futures-client.js", () => client);
vi.mock("../../src/charts/positions-repository-volman.js", () => repository);
vi.mock("../../src/shared/telegram-client.js", () => ({ sendMessage }));
vi.mock("../../src/charts/ohlc-provider.js", () => ({
  toBinanceSymbol: (value: string) => value.replace("BINANCE:", ""),
  fetchOhlcHistory,
}));
vi.mock("../../src/charts/binance-futures-config-env.js", () => ({
  getConfiguredBinanceLeverage: () => 5,
  getConfiguredBinanceMarginType: () => "ISOLATED",
  getConfiguredBinanceRiskPercentPerTrade: () => 1,
  getConfiguredBinanceRiskUsdPerTrade: () => undefined,
  getConfiguredBinanceWorkingType: () => "MARK_PRICE",
  isBinanceHonorOrderTypeEnabledVolman: () => false,
  getConfiguredBinanceEntryOrderExpiryMinutes: () => 60,
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
});
