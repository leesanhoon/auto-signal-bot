import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const client = vi.hoisted(() => ({
  getOrderStatus: vi.fn(),
  getRegularOrderStatus: vi.fn(),
  cancelOrder: vi.fn(),
  cancelRegularOrder: vi.fn(),
  getExchangeInfoFilters: vi.fn(),
  getPositionAmount: vi.fn(),
  placeStopMarketOrder: vi.fn(),
  placeTakeProfitMarketOrder: vi.fn(),
  placeMarketOrder: vi.fn(),
  isHedgeModeEnabled: vi.fn(),
  getAvailableBalanceUsdt: vi.fn(),
  setMarginType: vi.fn(),
  setLeverage: vi.fn(),
  getMaxLeverageForSymbol: vi.fn(),
  placeLimitOrder: vi.fn(),
  placeStopMarketEntryOrder: vi.fn(),
}));
const sendMessage = vi.hoisted(() => vi.fn());

vi.mock("../../src/charts/binance-futures-client.js", () => client);
vi.mock("../../src/shared/telegram-client.js", () => ({ sendMessage }));
vi.mock("../../src/charts/ohlc-provider.js", () => ({
  toBinanceSymbol: (value: string) => value.replace("BINANCE:", ""),
  fetchOhlcHistory: vi.fn(),
}));

import {
  createPollPendingEntryOrder,
  type BinanceExecutionSystemConfig,
  type PendingEntryOrderPosition,
} from "../../src/charts/binance-execution-shared.js";

const pending: PendingEntryOrderPosition = {
  id: 1,
  pair: "BTC/USDT",
  binanceSymbol: "BTCUSDT",
  binanceEntryOrderId: 100,
  binanceEntryOrderType: "LIMIT",
  binanceEntryOrderPlacedAt: new Date().toISOString(),
  direction: "LONG",
  stopLoss: "49000",
  takeProfit1: "52000",
  binanceQuantity: 1.5,
  binanceLeverage: 5,
};

function makeConfig(
  overrides: Partial<BinanceExecutionSystemConfig<any, any, any>> = {},
): BinanceExecutionSystemConfig<any, any, any> {
  return {
    systemLabel: "Test",
    loggerName: "charts:test",
    calculateRiskRewardPlan: () => null,
    saveBinanceExecutionDetails: vi.fn(),
    guardFailPrefix: "*Test*",
    failSafeMessagePrefix: "*Test*",
    failSafeEmergencyMessagePrefix: "*Test emergency*",
    dbErrorPrefix: "*Test*",
    successPrefix: "*Test*",
    entryErrorPrefix: "*Test*",
    closeFailedUrgentPrefix: "*Test*",
    silentFailureWarnPrefix: "*Test*",
    entryExecutionMode: "HONOR_ORDER_TYPE",
    entryOrderExpiryMinutes: 60,
    getPendingEntryOrderPositions: vi.fn(async () => [pending]),
    updateBinanceEntryOrderStatus: vi.fn(),
    closeExpiredEntryOrderPosition: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client.getExchangeInfoFilters.mockResolvedValue({
    stepSize: 0.001,
    minQty: 0.001,
    tickSize: 0.1,
    minNotional: 5,
  });
  client.getPositionAmount.mockResolvedValue(1.5);
  client.cancelOrder.mockResolvedValue({});
  client.cancelRegularOrder.mockResolvedValue({});
  client.placeStopMarketOrder.mockResolvedValue({ orderId: 200 });
  client.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 300 });
});

afterEach(() => vi.useRealTimers());

describe("charts/binance-execution-shared pending entry protection", () => {
  test("places one SL and one full-position TP after a LIMIT fill", async () => {
    client.getRegularOrderStatus.mockResolvedValue({ status: "FILLED" });
    const config = makeConfig();

    await createPollPendingEntryOrder(config)();

    expect(client.placeStopMarketOrder).toHaveBeenCalledTimes(1);
    expect(client.placeTakeProfitMarketOrder).toHaveBeenCalledTimes(1);
    expect(client.placeTakeProfitMarketOrder).toHaveBeenCalledWith(
      "BTCUSDT",
      "SELL",
      52000,
      { workingType: undefined },
    );
    expect(config.saveBinanceExecutionDetails).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        binanceSlOrderId: 200,
        binanceTp1OrderId: 300,
        binanceExecutionStatus: "placed",
      }),
    );
  });

  test("uses actual exchange quantity for fail-safe metadata after fill", async () => {
    client.getRegularOrderStatus.mockResolvedValue({ status: "FILLED" });
    client.getPositionAmount.mockResolvedValue(0.75);
    const config = makeConfig();

    await createPollPendingEntryOrder(config)();

    expect(config.saveBinanceExecutionDetails).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ binanceQuantity: 0.75 }),
    );
  });

  test("keeps entry expiry cancellation behavior", async () => {
    const expired = {
      ...pending,
      binanceEntryOrderPlacedAt: new Date(Date.now() - 61 * 60_000).toISOString(),
    };
    client.getRegularOrderStatus.mockResolvedValue({ status: "NEW", executedQty: "0" });
    const config = makeConfig({
      getPendingEntryOrderPositions: vi.fn(async () => [expired]),
    });

    await createPollPendingEntryOrder(config)();

    expect(client.cancelRegularOrder).toHaveBeenCalledWith("BTCUSDT", 100);
    expect(config.updateBinanceEntryOrderStatus).toHaveBeenCalledWith(1, "expired");
    expect(config.closeExpiredEntryOrderPosition).toHaveBeenCalledWith(1);
    expect(client.placeStopMarketOrder).not.toHaveBeenCalled();
  });

  test("retries transient Binance -4509 before finalizing protection", async () => {
    vi.useFakeTimers();
    client.getRegularOrderStatus.mockResolvedValue({ status: "FILLED" });
    client.placeStopMarketOrder
      .mockResolvedValueOnce(new Error("code -4509"))
      .mockResolvedValueOnce(new Error("code -4509"))
      .mockResolvedValueOnce({ orderId: 200 });
    const config = makeConfig();

    const polling = createPollPendingEntryOrder(config)();
    await vi.runAllTimersAsync();
    await polling;

    expect(client.placeStopMarketOrder).toHaveBeenCalledTimes(3);
    expect(client.placeTakeProfitMarketOrder).toHaveBeenCalledTimes(1);
    expect(config.saveBinanceExecutionDetails).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ binanceExecutionStatus: "placed" }),
    );
  });
});
