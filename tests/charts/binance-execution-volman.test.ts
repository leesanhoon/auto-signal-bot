import { beforeEach, describe, expect, test, vi } from "vitest";

const clientState = vi.hoisted(() => ({
  isHedgeModeEnabled: vi.fn(),
  getPositionAmount: vi.fn(),
  getOrderStatus: vi.fn(),
  getExchangeInfoFilters: vi.fn(),
  getAvailableBalanceUsdt: vi.fn(),
  setMarginType: vi.fn(),
  setLeverage: vi.fn(),
  placeMarketOrder: vi.fn(),
  placeStopMarketOrder: vi.fn(),
  placeTakeProfitMarketOrder: vi.fn(),
  cancelOrder: vi.fn(),
}));

const sendMessageMock = vi.hoisted(() => vi.fn());
const repositoryState = vi.hoisted(() => ({
  saveBinanceExecutionDetails: vi.fn(),
  updateBinanceSlOrder: vi.fn(),
}));

vi.mock("../../src/charts/binance-futures-client.js", () => clientState);

vi.mock("../../src/charts/ohlc-provider.js", () => ({
  toBinanceSymbol: (chartSymbol: string) =>
    chartSymbol.startsWith("BINANCE:") ? chartSymbol.replace("BINANCE:", "") : null,
}));

vi.mock("../../src/charts/binance-futures-config-env.js", () => ({
  getConfiguredBinanceLeverage: () => 5,
  getConfiguredBinanceMarginType: () => "ISOLATED",
  getConfiguredBinanceRiskPercentPerTrade: () => 1,
  getConfiguredBinanceRiskUsdPerTrade: () => undefined,
  isBinanceHonorOrderTypeEnabledVolman: () => false,
  getConfiguredBinanceEntryOrderExpiryMinutes: () => 60,
  getConfiguredBinanceWorkingType: () => undefined,
}));

vi.mock("../../src/charts/position-engine-volman.js", () => ({
  calculateRiskRewardPlan: () => ({
    entry: 50000,
    stopLoss: 49000,
    takeProfit1: 51000,
    takeProfit2: 52000,
    partialClosePercent: 50,
  }),
}));

vi.mock("../../src/charts/positions-repository-volman.js", () => repositoryState);

vi.mock("../../src/shared/telegram-client.js", () => ({
  sendMessage: sendMessageMock,
}));

const { openBinanceFuturesPosition, reconcileBinancePosition } = await import(
  "../../src/charts/binance-execution-volman.js"
);

const baseSetup = {
  pair: "BTC/USDT",
  direction: "LONG" as const,
};

const basePosition = {
  id: 1,
  pair: "BTC/USDT",
  direction: "LONG" as const,
  setup: "SMC",
  entry: "50000",
  stopLoss: "49000",
  takeProfit1: "51000",
  takeProfit2: "52000",
  reasons: ["test"],
  openedAt: "2026-07-11T00:00:00Z",
  status: "open" as const,
  lastDecision: null,
  lastDecisionConfidence: null,
  lastDecisionComment: null,
  lastCheckedAt: null,
  closedAt: null,
  tradeStage: "open" as const,
  tp1ClosePercent: 50,
  tp1ClosedPercent: null,
  tp1ClosedAt: null,
  trailingStopLoss: null,
  trailingStartedAt: null,
  riskRewardRatio: 2,
  tp1RiskRewardRatio: 1,
  tp2RiskRewardRatio: 2,
  minRiskRewardRatio: 1.5,
  lastManagementAction: null,
  lastManagementComment: null,
  lastManagementAt: null,
  closeReason: null,
  realizedRiskRewardRatio: null,
  realizedExitPrice: null,
  binanceSymbol: "BTCUSDT",
  binanceLeverage: 5,
  binanceQuantity: 1,
  binanceEntryOrderId: 123,
  binanceSlOrderId: 456,
  binanceTp1OrderId: 789,
  binanceTp2OrderId: 999,
  binanceExecutionStatus: "placed" as const,
};

beforeEach(() => {
  Object.values(clientState).forEach((fn) => fn.mockReset());
  sendMessageMock.mockReset();
  (repositoryState.saveBinanceExecutionDetails as any).mockReset();
  (repositoryState.updateBinanceSlOrder as any).mockReset();
  clientState.isHedgeModeEnabled.mockResolvedValue(false);
});

describe("charts/binance-execution-volman guard cross-system", () => {
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
    const apiError = new Error("api down");
    clientState.getPositionAmount.mockResolvedValue(apiError);

    await openBinanceFuturesPosition(baseSetup as any, 1, "BINANCE:BTCUSDT");

    expect(clientState.placeMarketOrder).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const alertMsg = sendMessageMock.mock.calls[0][0];
    expect(alertMsg).toContain("không xác minh được vị thế hiện tại trên sàn");
    expect(alertMsg).toContain("api down");
  });
});

describe("charts/binance-execution-volman openBinanceFuturesPosition fail-safe", () => {
  test("dat SL/TP fail + dong khan cap fail -> saveBinanceExecutionDetails ghi close_failed", async () => {
    const { saveBinanceExecutionDetails } = await import(
      "../../src/charts/positions-repository-volman.js"
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
      "../../src/charts/positions-repository-volman.js"
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

describe("charts/binance-execution-volman reconcileBinancePosition", () => {
  beforeEach(() => {
    clientState.getExchangeInfoFilters.mockResolvedValue({
      tickSize: 0.01,
    });
  });

  test("TP1 filled, huy SL cu that bai -> tra HOLD, tp1Reached false, managementAction NONE", async () => {
    const position = { ...basePosition, tp1ClosedPercent: 0, binanceSlOrderId: 456, binanceTp2OrderId: null };
    // SL is not filled, TP1 is filled
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "PENDING" }); // SL not filled
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "FILLED" }); // TP1 filled
    clientState.cancelOrder.mockResolvedValueOnce(new Error("cancel failed")); // Cancel SL fails (returns Error)

    const result = await reconcileBinancePosition(position as any);

    expect(result.decision).toBe("HOLD");
    expect(result.managementAction).toBe("NONE");
    expect(result.tp1Reached).toBe(false);
    expect(result.partialClosePercent).toBe(0);
  });

  test("TP1 filled, huy SL cu OK nhung dat SL moi fail 3 lan -> tra HOLD, tp1Reached false", async () => {
    const position = { ...basePosition, tp1ClosedPercent: 0, binanceSlOrderId: 456, binanceTp2OrderId: null };
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "PENDING" }); // SL not filled
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "FILLED" }); // TP1 filled
    clientState.cancelOrder.mockResolvedValueOnce({ orderId: 456 }); // Cancel SL success
    // placeStopMarketOrder fails 3 times and returns Error
    clientState.placeStopMarketOrder.mockResolvedValueOnce(new Error("place failed"));
    clientState.placeStopMarketOrder.mockResolvedValueOnce(new Error("place failed"));
    clientState.placeStopMarketOrder.mockResolvedValueOnce(new Error("place failed"));

    const result = await reconcileBinancePosition(position as any);

    expect(result.decision).toBe("HOLD");
    expect(result.managementAction).toBe("NONE");
    expect(result.tp1Reached).toBe(false);
    expect(result.partialClosePercent).toBe(0);
    expect(clientState.placeStopMarketOrder).toHaveBeenCalledTimes(3);
  });

  test("TP1 filled, doi SL breakeven thanh cong -> tra managementAction PARTIAL_TP1, tp1Reached true", async () => {
    const position = { ...basePosition, tp1ClosedPercent: 0, binanceSlOrderId: 456, binanceTp2OrderId: null };
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "PENDING" }); // SL not filled
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "FILLED" }); // TP1 filled
    clientState.cancelOrder.mockResolvedValueOnce({ orderId: 456 }); // Cancel SL success
    clientState.placeStopMarketOrder.mockResolvedValueOnce({ orderId: 789 }); // New SL success
    (repositoryState.updateBinanceSlOrder as any).mockResolvedValueOnce(undefined);

    const result = await reconcileBinancePosition(position as any);

    expect(result.decision).toBe("HOLD");
    expect(result.managementAction).toBe("PARTIAL_TP1");
    expect(result.tp1Reached).toBe(true);
    expect(result.partialClosePercent).toBe(50);
    expect((repositoryState.updateBinanceSlOrder as any)).toHaveBeenCalled();
  });

  test("retry: fail lan 1 khong chan lan goi thu 2 vao lai nhanh doi SL", async () => {
    const position1 = { ...basePosition, tp1ClosedPercent: 0, binanceSlOrderId: 456, binanceTp2OrderId: null };
    // First call: TP1 filled, cancel SL fail
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "PENDING" }); // SL not filled
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "FILLED" }); // TP1 filled
    clientState.cancelOrder.mockResolvedValueOnce(new Error("cancel failed")); // Cancel SL fails

    const result1 = await reconcileBinancePosition(position1 as any);
    expect(result1.managementAction).toBe("NONE");

    // Reset mocks and second call
    clientState.getOrderStatus.mockReset();
    clientState.cancelOrder.mockReset();

    const position2 = { ...basePosition, tp1ClosedPercent: 0, binanceSlOrderId: 456, binanceTp2OrderId: null };
    // Second call: TP1 filled, cancel SL success, place new SL success
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "PENDING" }); // SL not filled
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "FILLED" }); // TP1 filled
    clientState.cancelOrder.mockResolvedValueOnce({ orderId: 456 }); // Cancel SL success
    clientState.placeStopMarketOrder.mockResolvedValueOnce({ orderId: 789 }); // New SL success
    (repositoryState.updateBinanceSlOrder as any).mockResolvedValueOnce(undefined);

    const result2 = await reconcileBinancePosition(position2 as any);
    expect(result2.managementAction).toBe("PARTIAL_TP1");

    expect(clientState.getOrderStatus).toHaveBeenCalled();
  });

  test("close_failed + getPositionAmount tra 0 -> CLOSE", async () => {
    const position = { ...basePosition, binanceExecutionStatus: "close_failed" as const };
    clientState.getPositionAmount.mockResolvedValueOnce(0);

    const result = await reconcileBinancePosition(position as any);

    expect(result.decision).toBe("CLOSE");
    expect(result.confidence).toBe(100);
  });

  test("close_failed + getPositionAmount khac 0 -> HOLD va gui alert", async () => {
    const position = { ...basePosition, binanceExecutionStatus: "close_failed" as const };
    clientState.getPositionAmount.mockResolvedValueOnce(0.5);

    const result = await reconcileBinancePosition(position as any);

    expect(result.decision).toBe("HOLD");
    expect(result.confidence).toBe(20);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toContain("VẪN ĐANG MỞ trên sàn KHÔNG CÓ SL");
  });

  test("close_failed + getPositionAmount tra Error -> HOLD, khong gui CLOSE", async () => {
    const position = { ...basePosition, binanceExecutionStatus: "close_failed" as const };
    clientState.getPositionAmount.mockResolvedValueOnce(new Error("api error"));

    const result = await reconcileBinancePosition(position as any);

    expect(result.decision).toBe("HOLD");
    expect(result.confidence).toBe(30);
  });

  test("SL filled, tp1/tp2 order remaining, cancelOrder fail -> log error, decision STOP", async () => {
    const position = { ...basePosition, tp1ClosedPercent: 0, binanceSlOrderId: 456 };
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "FILLED" }); // SL filled
    clientState.cancelOrder.mockResolvedValueOnce(new Error("cancel TP1 failed")); // Cancel TP1 fails
    clientState.cancelOrder.mockResolvedValueOnce(new Error("cancel TP2 failed")); // Cancel TP2 fails

    const result = await reconcileBinancePosition(position as any);

    expect(result.decision).toBe("STOP");
    expect(result.managementAction).toBe("NONE");
  });

  test("TP2 filled, SL order remaining, cancelOrder fail -> log error, decision CLOSE", async () => {
    const position = { ...basePosition, tp1ClosedPercent: 50, binanceSlOrderId: 456, binanceTp1OrderId: null };
    // Mock getOrderStatus: SL not filled, TP2 filled
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "PENDING" }); // SL not filled
    clientState.getOrderStatus.mockResolvedValueOnce({ status: "FILLED" }); // TP2 filled
    clientState.cancelOrder.mockResolvedValueOnce(new Error("cancel SL failed")); // Cancel SL fails

    const result = await reconcileBinancePosition(position as any);

    expect(result.decision).toBe("CLOSE");
    expect(result.managementAction).toBe("TP2_CLOSE");
  });
});
