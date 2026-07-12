import { beforeEach, describe, expect, test, vi } from "vitest";

const clientState = vi.hoisted(() => ({
  isHedgeModeEnabled: vi.fn(),
  getPositionAmount: vi.fn(),
  getExchangeInfoFilters: vi.fn(),
  getAvailableBalanceUsdt: vi.fn(),
  setMarginType: vi.fn(),
  setLeverage: vi.fn(),
  getMaxLeverageForSymbol: vi.fn(),
  placeMarketOrder: vi.fn(),
  placeStopMarketOrder: vi.fn(),
  placeTakeProfitMarketOrder: vi.fn(),
  cancelOrder: vi.fn(),
  getOrderStatus: vi.fn(),
}));

const sendMessageMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/charts/binance-futures-client.js", () => clientState);

vi.mock("../../src/charts/ohlc-provider.js", () => ({
  toBinanceSymbol: (chartSymbol: string) =>
    chartSymbol.startsWith("BINANCE:") ? chartSymbol.replace("BINANCE:", "") : null,
}));

vi.mock("../../src/charts/binance-futures-config-env.js", () => ({
  getConfiguredBinanceLeverage: () => 5,
  getConfiguredBinanceMarginType: () => "ISOLATED",
  getConfiguredBinanceRiskPercentPerTrade: () => 1,
  isBinanceHonorOrderTypeEnabledSmc: () => false,
  getConfiguredBinanceEntryOrderExpiryMinutes: () => 60,
  getConfiguredBinanceWorkingType: () => undefined,
}));

vi.mock("../../src/charts/position-engine-smc.js", () => ({
  calculateRiskRewardPlan: () => ({
    entry: 50000,
    stopLoss: 49000,
    takeProfit1: 51000,
    takeProfit2: 52000,
    partialClosePercent: 50,
  }),
}));

vi.mock("../../src/charts/positions-repository-smc.js", () => ({
  saveBinanceExecutionDetails: vi.fn(),
  updateBinanceSlOrder: vi.fn(),
}));

vi.mock("../../src/shared/telegram-client.js", () => ({
  sendMessage: sendMessageMock,
}));

const { openBinanceFuturesPosition, reconcileBinancePosition } = await import(
  "../../src/charts/binance-execution-smc.js"
);

const baseSetup = {
  pair: "BTC/USDT",
  direction: "LONG" as const,
};

beforeEach(() => {
  Object.values(clientState).forEach((fn) => fn.mockReset());
  sendMessageMock.mockReset();
  clientState.isHedgeModeEnabled.mockResolvedValue(false);
  clientState.getMaxLeverageForSymbol.mockResolvedValue(20);
});

describe("charts/binance-execution-smc guard cross-system", () => {
  test("bo qua entry khi symbol da co vi the mo (khac 0)", async () => {
    clientState.getPositionAmount.mockResolvedValue(0.02);

    await openBinanceFuturesPosition(baseSetup as any, 1, "BINANCE:BTCUSDT");

    expect(clientState.placeMarketOrder).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toContain("Bỏ qua mở vị thế thật");
  });

  test("cho qua guard khi symbol chua co vi the mo (bang 0)", async () => {
    clientState.getPositionAmount.mockResolvedValue(0);
    clientState.getExchangeInfoFilters.mockResolvedValue(new Error("network down"));

    await openBinanceFuturesPosition(baseSetup as any, 1, "BINANCE:BTCUSDT");

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toContain("Không thể mở vị thế thật");
  });

  test("getPositionAmount tra Error -> fail-closed, khong mo lenh, co gui alert", async () => {
    clientState.getPositionAmount.mockResolvedValue(new Error("api down"));

    await openBinanceFuturesPosition(baseSetup as any, 1, "BINANCE:BTCUSDT");

    expect(clientState.placeMarketOrder).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toContain("không xác minh được vị thế");
  });
});

describe("charts/binance-execution-smc reconcileBinancePosition", () => {
  const basePosition = {
    id: 1,
    pair: "BTC/USDT",
    direction: "LONG" as const,
    binanceSymbol: "BTCUSDT",
    binanceEntryOrderId: 100,
    binanceSlOrderId: 111,
    binanceTp1OrderId: 222,
    binanceTp2OrderId: 333,
    tp1ClosePercent: 50,
    tp1ClosedPercent: 0,
    entry: "50000",
  } as any;

  beforeEach(() => {
    Object.values(clientState).forEach((fn) => fn.mockReset());
    sendMessageMock.mockReset();
  });

  describe("Finding 1+4: TP1 filled, dời SL breakeven", () => {
    test("TP1 filled, huy SL cu that bai -> tra HOLD, tp1Reached false, managementAction NONE", async () => {
      // Check order: SL status (not filled), TP2 status (not filled), TP1 status (filled)
      clientState.getOrderStatus
        .mockResolvedValueOnce({ status: "NEW" }) // SL status
        .mockResolvedValueOnce({ status: "NEW" }) // TP2 status
        .mockResolvedValueOnce({ status: "FILLED" }); // TP1 status
      clientState.cancelOrder.mockResolvedValue(new Error("cancel failed"));
      clientState.getExchangeInfoFilters.mockResolvedValue({ tickSize: 1, stepSize: 0.01 });

      const result = await reconcileBinancePosition(basePosition);

      expect(result.tp1Reached).toBe(false);
      expect(result.managementAction).toBe("NONE");
      expect(result.partialClosePercent).toBe(0);
      expect(result.newStopLoss).toBeNull();
      expect(result.decision).toBe("HOLD");
    });

    test("TP1 filled, huy SL cu OK nhung dat SL moi fail 3 lan -> tra HOLD, tp1Reached false", async () => {
      clientState.getOrderStatus
        .mockResolvedValueOnce({ status: "NEW" }) // SL status
        .mockResolvedValueOnce({ status: "NEW" }) // TP2 status
        .mockResolvedValueOnce({ status: "FILLED" }); // TP1 status
      clientState.cancelOrder.mockResolvedValue({});
      clientState.getExchangeInfoFilters.mockResolvedValue({ tickSize: 1, stepSize: 0.01 });
      clientState.placeStopMarketOrder.mockResolvedValue(new Error("place failed"));

      const result = await reconcileBinancePosition(basePosition);

      expect(result.tp1Reached).toBe(false);
      expect(result.managementAction).toBe("NONE");
      expect(result.partialClosePercent).toBe(0);
      expect(clientState.placeStopMarketOrder).toHaveBeenCalledTimes(3);
    });

    test("TP1 filled, doi SL breakeven thanh cong -> tra managementAction PARTIAL_TP1, tp1Reached true", async () => {
      const { updateBinanceSlOrder } = await import(
        "../../src/charts/positions-repository-smc.js"
      );
      (updateBinanceSlOrder as any).mockResolvedValue(undefined);

      clientState.getOrderStatus
        .mockResolvedValueOnce({ status: "NEW" }) // SL status
        .mockResolvedValueOnce({ status: "NEW" }) // TP2 status
        .mockResolvedValueOnce({ status: "FILLED" }); // TP1 status
      clientState.cancelOrder.mockResolvedValue({});
      clientState.getExchangeInfoFilters.mockResolvedValue({ tickSize: 1, stepSize: 0.01 });
      clientState.placeStopMarketOrder.mockResolvedValue({ orderId: 444 });

      const result = await reconcileBinancePosition(basePosition);

      expect(result.managementAction).toBe("PARTIAL_TP1");
      expect(result.tp1Reached).toBe(true);
      expect(result.newStopLoss).not.toBeNull();
      expect(updateBinanceSlOrder).toHaveBeenCalled();
    });
  });

  describe("Finding 1: Retry after fail", () => {
    test("retry: fail lan 1 khong lam tp1ClosedPercent tang, cho phep vao lai nhanh doi SL o lan goi thu 2", async () => {
      // First call: fail to place SL
      clientState.getOrderStatus
        .mockResolvedValueOnce({ status: "NEW" }) // SL status (call 1)
        .mockResolvedValueOnce({ status: "NEW" }) // TP2 status (call 1)
        .mockResolvedValueOnce({ status: "FILLED" }) // TP1 status (call 1)
        .mockResolvedValueOnce({ status: "NEW" }) // SL status (call 2)
        .mockResolvedValueOnce({ status: "NEW" }) // TP2 status (call 2)
        .mockResolvedValueOnce({ status: "FILLED" }); // TP1 status (call 2)

      clientState.cancelOrder.mockResolvedValue({});
      clientState.getExchangeInfoFilters.mockResolvedValue({ tickSize: 1, stepSize: 0.01 });

      // First call: fail
      clientState.placeStopMarketOrder
        .mockResolvedValueOnce(new Error("fail"))
        .mockResolvedValueOnce(new Error("fail"))
        .mockResolvedValueOnce(new Error("fail"));

      const result1 = await reconcileBinancePosition(basePosition);
      expect(result1.tp1Reached).toBe(false);
      expect(result1.managementAction).toBe("NONE");

      const { updateBinanceSlOrder } = await import(
        "../../src/charts/positions-repository-smc.js"
      );
      (updateBinanceSlOrder as any).mockResolvedValue(undefined);

      // Second call: success - verify getOrderStatus called (not blocked by alreadyPartial)
      clientState.placeStopMarketOrder
        .mockResolvedValueOnce({ orderId: 444 })
        .mockResolvedValueOnce({ orderId: 444 })
        .mockResolvedValueOnce({ orderId: 444 });

      const result2 = await reconcileBinancePosition(basePosition);
      // Verify getOrderStatus was called multiple times across both calls
      expect(clientState.getOrderStatus).toHaveBeenCalledTimes(6); // 3 per call * 2 calls
      expect(result2.tp1Reached).toBe(true);
      expect(result2.managementAction).toBe("PARTIAL_TP1");
    });
  });

  describe("Finding 2: close_failed status", () => {
    test("close_failed + getPositionAmount tra 0 -> CLOSE", async () => {
      const positionWithCloseFailed = { ...basePosition, binanceExecutionStatus: "close_failed" };
      clientState.getPositionAmount.mockResolvedValue(0);

      const result = await reconcileBinancePosition(positionWithCloseFailed);

      expect(result.decision).toBe("CLOSE");
      expect(result.confidence).toBe(100);
    });

    test("close_failed + getPositionAmount khac 0 -> HOLD va gui alert", async () => {
      const positionWithCloseFailed = { ...basePosition, binanceExecutionStatus: "close_failed" };
      clientState.getPositionAmount.mockResolvedValue(0.5);

      const result = await reconcileBinancePosition(positionWithCloseFailed);

      expect(result.decision).toBe("HOLD");
      expect(result.confidence).toBe(20);
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
      expect(sendMessageMock.mock.calls[0][0]).toContain("KHẨN CẤP nhắc lại");
    });

    test("close_failed + getPositionAmount tra Error -> HOLD, khong gui CLOSE", async () => {
      const positionWithCloseFailed = { ...basePosition, binanceExecutionStatus: "close_failed" };
      clientState.getPositionAmount.mockResolvedValue(new Error("api down"));

      const result = await reconcileBinancePosition(positionWithCloseFailed);

      expect(result.decision).toBe("HOLD");
      expect(result.confidence).toBe(30);
    });
  });

  describe("Finding 2: openBinanceFuturesPosition fail-safe", () => {
    test("dat SL/TP fail + dong khan cap fail -> saveBinanceExecutionDetails ghi close_failed", async () => {
      const { saveBinanceExecutionDetails } = await import(
        "../../src/charts/positions-repository-smc.js"
      );
      (saveBinanceExecutionDetails as any).mockResolvedValue(undefined);

      clientState.getPositionAmount.mockResolvedValue(0);
      clientState.isHedgeModeEnabled.mockResolvedValue(false);
      clientState.getExchangeInfoFilters.mockResolvedValue({ tickSize: 1, stepSize: 0.01 });
      clientState.getAvailableBalanceUsdt.mockResolvedValue(1000);
      clientState.setMarginType.mockResolvedValue({});
      clientState.setLeverage.mockResolvedValue({});
      clientState.placeMarketOrder.mockResolvedValueOnce({ orderId: 1 }); // entry
      clientState.placeStopMarketOrder.mockResolvedValue(new Error("place fail")); // SL fail
      clientState.placeMarketOrder.mockResolvedValueOnce(new Error("close fail")); // emergency close fail

      await openBinanceFuturesPosition(baseSetup as any, 1, "BINANCE:BTCUSDT");

      const callArgs = (saveBinanceExecutionDetails as any).mock.calls;
      const lastCall = callArgs[callArgs.length - 1];
      expect(lastCall[1].binanceExecutionStatus).toBe("close_failed");
    });

    test("dat SL/TP fail + dong khan cap OK -> saveBinanceExecutionDetails van ghi failed", async () => {
      const { saveBinanceExecutionDetails } = await import(
        "../../src/charts/positions-repository-smc.js"
      );
      (saveBinanceExecutionDetails as any).mockResolvedValue(undefined);

      clientState.getPositionAmount.mockResolvedValue(0);
      clientState.isHedgeModeEnabled.mockResolvedValue(false);
      clientState.getExchangeInfoFilters.mockResolvedValue({ tickSize: 1, stepSize: 0.01 });
      clientState.getAvailableBalanceUsdt.mockResolvedValue(1000);
      clientState.setMarginType.mockResolvedValue({});
      clientState.setLeverage.mockResolvedValue({});
      clientState.placeMarketOrder.mockResolvedValueOnce({ orderId: 1 }); // entry
      clientState.placeStopMarketOrder.mockResolvedValue(new Error("place fail")); // SL fail
      clientState.placeMarketOrder.mockResolvedValueOnce({ orderId: 2 }); // emergency close success

      await openBinanceFuturesPosition(baseSetup as any, 1, "BINANCE:BTCUSDT");

      const callArgs = (saveBinanceExecutionDetails as any).mock.calls;
      const lastCall = callArgs[callArgs.length - 1];
      expect(lastCall[1].binanceExecutionStatus).toBe("failed");
    });
  });

  describe("Finding phụ #1: orphan reduceOnly order", () => {
    test("SL filled, cancelOrder TP1 fail -> log error, van tra STOP", async () => {
      clientState.getOrderStatus.mockResolvedValue({ status: "FILLED" }); // SL status
      clientState.cancelOrder.mockResolvedValue(new Error("cancel TP1 fail"));

      const result = await reconcileBinancePosition(basePosition);

      expect(result.decision).toBe("STOP");
      expect(clientState.cancelOrder).toHaveBeenCalled();
    });

    test("TP2 filled, cancelOrder SL fail -> log error, van tra CLOSE", async () => {
      const positionWithTp2 = { ...basePosition, binanceTp1OrderId: null };
      clientState.getOrderStatus
        .mockResolvedValueOnce({ status: "NEW" }) // SL status
        .mockResolvedValueOnce({ status: "FILLED" }); // TP2 status
      clientState.cancelOrder.mockResolvedValue(new Error("cancel SL fail"));

      const result = await reconcileBinancePosition(positionWithTp2);

      expect(result.decision).toBe("CLOSE");
      expect(clientState.cancelOrder).toHaveBeenCalled();
    });
  });
});
