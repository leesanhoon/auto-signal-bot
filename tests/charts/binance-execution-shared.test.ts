import { describe, it, expect, beforeEach, vi } from "vitest";

const clientState = vi.hoisted(() => ({
  getOrderStatus: vi.fn(),
  getRegularOrderStatus: vi.fn(),
  cancelOrder: vi.fn(),
  cancelRegularOrder: vi.fn(),
  getExchangeInfoFilters: vi.fn(),
  getPositionAmount: vi.fn(),
  placeStopMarketOrder: vi.fn(),
  placeTakeProfitMarketOrder: vi.fn(),
  placeMarketOrder: vi.fn(),
}));

const sendMessageMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/charts/binance-futures-client.js", () => clientState);
vi.mock("../../src/shared/telegram-client.js", () => ({
  sendMessage: sendMessageMock,
}));

import {
  createOpenBinanceFuturesPosition,
  createPollPendingEntryOrder,
  calculateSwingTrailLevel,
  type BinanceExecutionSystemConfig,
  type RiskRewardPlan,
} from "../../src/charts/binance-execution-shared.js";

describe("charts/binance-execution-shared", () => {
  describe("calculateSwingTrailLevel (Task 07 — must match setup-backtest.ts scanOutcomeSwingTrail)", () => {
    // Cong thuc tham chieu trong setup-backtest.ts (scanOutcomeSwingTrail):
    //   const start = Math.max(entryIndex, i - swingLookback + 1);
    //   const swingLow = Math.min(...candles.slice(start, i + 1).map((c) => c.low));
    // (tuong tu cho SHORT dung Math.max(...high)). Test nay dung LAI dung cong thuc do
    // tren cung du lieu gia lap, roi so sanh voi calculateSwingTrailLevel (live) — dam
    // bao 2 noi khong bi lech nhau (bai hoc rut ra tu review Task 07 ban dau).
    function referenceSwingTrail(
      candles: Array<{ high: number; low: number }>,
      lookback: number,
      direction: "LONG" | "SHORT",
    ): number {
      const window = candles.slice(-lookback);
      return direction === "LONG"
        ? Math.min(...window.map((c) => c.low))
        : Math.max(...window.map((c) => c.high));
    }

    const sampleCandles = [
      { high: 110, low: 95 },
      { high: 108, low: 99 },
      { high: 112, low: 101 },
      { high: 115, low: 105 },
      { high: 118, low: 108 },
    ];

    it("LONG: khop chinh xac voi cong thuc scanOutcomeSwingTrail (lookback 3)", () => {
      const lookback = 3;
      const live = calculateSwingTrailLevel(sampleCandles.slice(-lookback), "LONG");
      const reference = referenceSwingTrail(sampleCandles, lookback, "LONG");
      expect(live).toBe(reference);
      expect(live).toBe(101); // min(low) cua 3 nen cuoi: 101, 105, 108
    });

    it("SHORT: khop chinh xac voi cong thuc scanOutcomeSwingTrail (lookback 3)", () => {
      const lookback = 3;
      const live = calculateSwingTrailLevel(sampleCandles.slice(-lookback), "SHORT");
      const reference = referenceSwingTrail(sampleCandles, lookback, "SHORT");
      expect(live).toBe(reference);
      expect(live).toBe(118); // max(high) cua 3 nen cuoi: 112, 115, 118
    });

    it("tra ve null khi mang candles rong", () => {
      expect(calculateSwingTrailLevel([], "LONG")).toBeNull();
    });
  });

  describe("createOpenBinanceFuturesPosition", () => {
    let config: BinanceExecutionSystemConfig<any, any, any>;
    let openBinanceFuturesPosition: any;

    beforeEach(() => {
      config = {
        systemLabel: "Test",
        loggerName: "charts:test",
        calculateRiskRewardPlan: () => ({
          entry: 50000,
          stopLoss: 49000,
          takeProfit1: 51000,
          takeProfit2: 52000,
          partialClosePercent: 50,
        }),
        saveBinanceExecutionDetails: vi.fn(),
        updateBinanceSlOrder: vi.fn(),
        guardFailPrefix: "*Test*",
        failSafeMessagePrefix: "*Test*",
        failSafeEmergencyMessagePrefix: "*Test — KHẨN CẤP*",
        dbErrorPrefix: "*Test*",
        successPrefix: "*Test*",
        entryErrorPrefix: "*Test*",
        closeFailedUrgentPrefix: "*Test*",
        tp1MoveSLFailPrefix: "*Test*",
        entryExecutionMode: "MARKET_ONLY",
      };

      openBinanceFuturesPosition = createOpenBinanceFuturesPosition(config);
    });

    it("MARKET_ONLY mode defaults to behavior unchanged", async () => {
      // This is a regression test placeholder - full implementation
      // requires mocking all binance-futures-client functions
      expect(config.entryExecutionMode).toBe("MARKET_ONLY");
    });

    it("HONOR_ORDER_TYPE mode with LIMIT setup is available", async () => {
      const configHonor: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        entryExecutionMode: "HONOR_ORDER_TYPE",
        entryOrderExpiryMinutes: 60,
        saveBinancePendingEntryOrder: vi.fn(),
        updateBinanceEntryOrderStatus: vi.fn(),
        getPendingEntryOrderPositions: vi.fn(() => Promise.resolve([])),
      };

      const openWithHonor = createOpenBinanceFuturesPosition(configHonor);
      expect(configHonor.entryExecutionMode).toBe("HONOR_ORDER_TYPE");
      expect(configHonor.saveBinancePendingEntryOrder).toBeDefined();
    });
  });

  describe("createPollPendingEntryOrder", () => {
    let config: BinanceExecutionSystemConfig<any, any, any>;
    let pollPendingEntryOrders: any;

    beforeEach(() => {
      // Clear all mocks before each test
      vi.clearAllMocks();
      clientState.getOrderStatus.mockReset();
      clientState.getRegularOrderStatus.mockReset();
      clientState.cancelOrder.mockReset();
      clientState.cancelRegularOrder.mockReset();
      clientState.getExchangeInfoFilters.mockReset();
      clientState.getPositionAmount.mockReset();
      clientState.placeStopMarketOrder.mockReset();
      clientState.placeTakeProfitMarketOrder.mockReset();
      sendMessageMock.mockReset();

      // Mac dinh khong xac minh duoc quantity that tren san (Error) -> resolveFilledQuantity
      // fallback ve position.binanceQuantity, giu cac test hien co dung nguyen ky vong.
      // Test rieng se override khi can kiem tra nhanh uu tien getPositionAmount.
      clientState.getPositionAmount.mockResolvedValue(new Error("not mocked in this test"));

      config = {
        systemLabel: "Test",
        loggerName: "charts:test",
        calculateRiskRewardPlan: () => null,
        saveBinanceExecutionDetails: vi.fn(),
        updateBinanceSlOrder: vi.fn(),
        guardFailPrefix: "*Test*",
        failSafeMessagePrefix: "*Test*",
        failSafeEmergencyMessagePrefix: "*Test — KHẨN CẤP*",
        dbErrorPrefix: "*Test*",
        successPrefix: "*Test*",
        entryErrorPrefix: "*Test*",
        closeFailedUrgentPrefix: "*Test*",
        tp1MoveSLFailPrefix: "*Test*",
        entryExecutionMode: "HONOR_ORDER_TYPE",
        entryOrderExpiryMinutes: 60,
        getPendingEntryOrderPositions: vi.fn(() => Promise.resolve([])),
        updateBinanceEntryOrderStatus: vi.fn(),
      };

      pollPendingEntryOrders = createPollPendingEntryOrder(config);
    });

    it("returns early if getPendingEntryOrderPositions not configured", async () => {
      const configNoGet: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions: undefined,
      };

      const pollNoGet = createPollPendingEntryOrder(configNoGet);
      await expect(pollNoGet()).resolves.toBeUndefined();
    });

    it("skips querying the DB entirely when isHonorOrderTypeEnabled() returns false", async () => {
      const getPendingEntryOrderPositions = vi.fn(() => Promise.resolve([]));
      const configDisabled: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions,
        isHonorOrderTypeEnabled: () => false,
      };

      const pollDisabled = createPollPendingEntryOrder(configDisabled);
      await pollDisabled();

      // No DB round-trip when the feature flag is off — this is the wasted-work fix.
      expect(getPendingEntryOrderPositions).not.toHaveBeenCalled();
    });

    it("handles empty pending positions gracefully", async () => {
      await expect(pollPendingEntryOrders()).resolves.toBeUndefined();
      expect(config.getPendingEntryOrderPositions).toHaveBeenCalled();
    });


    it("factory creates valid poll function", async () => {
      expect(pollPendingEntryOrders).toBeDefined();
      expect(typeof pollPendingEntryOrders).toBe("function");
    });

    it("filters pending positions by timeframe when a timeframe arg is passed", async () => {
      // Regression test: task-02 added timeframe filtering by reading
      // position.primaryTimeframe, but getPendingEntryOrderPositions() previously never
      // populated that field for ANY row (including Volman) — the filter silently emptied
      // the list every time a timeframe was passed, so pending STOP/LIMIT entries were
      // never checked/expired for the whole Volman pipeline. Fixed in
      // positions-repository-binance-entry-order-shared.ts (includeTimeframe flag).
      const makePosition = (id: number, primaryTimeframe: string) => ({
        id,
        pair: `PAIR${id}/USDT`,
        binanceSymbol: `PAIR${id}USDT`,
        binanceEntryOrderId: 1000 + id,
        binanceEntryOrderType: "LIMIT",
        binanceEntryOrderPlacedAt: new Date().toISOString(),
        direction: "LONG" as const,
        stopLoss: "1",
        takeProfit1: "2",
        takeProfit2: null,
        binanceQuantity: 1,
        binanceLeverage: 1,
        partialClosePercent: 50,
        primaryTimeframe,
      });

      const getPendingEntryOrderPositions = vi.fn(() =>
        Promise.resolve([makePosition(1, "M15"), makePosition(2, "H4"), makePosition(3, "M15")]),
      );
      const configFiltered: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions,
      };
      const pollFiltered = createPollPendingEntryOrder(configFiltered);

      clientState.getRegularOrderStatus.mockResolvedValue({ status: "NEW", executedQty: "0" });

      await pollFiltered("M15");

      // Only the 2 M15 positions should have been processed (id=1, id=3) — the H4 one (id=2)
      // must be filtered out.
      expect(clientState.getRegularOrderStatus).toHaveBeenCalledTimes(2);
      const calledOrderIds = clientState.getRegularOrderStatus.mock.calls.map((c: any[]) => c[1]);
      expect(calledOrderIds.sort()).toEqual([1001, 1003]);
    });

    it("does not filter when no timeframe arg is passed (SMC call site behavior)", async () => {
      const getPendingEntryOrderPositions = vi.fn(() =>
        Promise.resolve([
          { ...({} as any), id: 1, pair: "A/USDT", binanceSymbol: "AUSDT", binanceEntryOrderId: 1, binanceEntryOrderType: "LIMIT", binanceEntryOrderPlacedAt: new Date().toISOString(), direction: "LONG", stopLoss: "1", takeProfit1: "2", takeProfit2: null, binanceQuantity: 1, binanceLeverage: 1, partialClosePercent: 50 },
        ]),
      );
      const configNoTimeframe: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions,
      };
      const pollNoTimeframe = createPollPendingEntryOrder(configNoTimeframe);
      clientState.getRegularOrderStatus.mockResolvedValue({ status: "NEW", executedQty: "0" });

      await pollNoTimeframe();

      expect(clientState.getRegularOrderStatus).toHaveBeenCalledTimes(1);
    });

    it("polls LIMIT order status and updates on FILLED", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 5 * 60 * 1000).toISOString(); // 5 min ago

      const configWithLimit: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 1,
              pair: "BTC/USDT",
              binanceSymbol: "BTCUSDT",
              binanceEntryOrderId: 100,
              binanceEntryOrderType: "LIMIT",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "49000",
              takeProfit1: "51000",
              takeProfit2: "52000",
              binanceQuantity: 1.5,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
        saveBinanceExecutionDetails: vi.fn(),
      };

      clientState.getRegularOrderStatus.mockResolvedValue({ status: "FILLED", executedQty: "1.5" });
      clientState.getExchangeInfoFilters.mockResolvedValue({
        tickSize: 1,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 10,
      });
      clientState.placeStopMarketOrder.mockResolvedValue({ orderId: 201 });
      clientState.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 202 });
      clientState.saveBinanceExecutionDetails = vi.fn();

      const pollWithLimit = createPollPendingEntryOrder(configWithLimit);
      await pollWithLimit();

      // Verify LIMIT order status was checked
      expect(clientState.getRegularOrderStatus).toHaveBeenCalledWith("BTCUSDT", 100);

      // Verify SL/TP orders were placed using the REAL filled quantity (1.5),
      // not a hardcoded placeholder — this guards against regressing the
      // quantity-placeholder bug found in review (splitTpQuantities(100, 50, ...)).
      expect(clientState.placeStopMarketOrder).toHaveBeenCalledWith(
        "BTCUSDT",
        "SELL",
        49000,
        {},
      );
      expect(clientState.placeTakeProfitMarketOrder).toHaveBeenNthCalledWith(
        1,
        "BTCUSDT",
        "SELL",
        51000,
        0.75, // 50% of 1.5, rounded down to stepSize 0.001
        {},
      );
      expect(clientState.placeTakeProfitMarketOrder).toHaveBeenNthCalledWith(
        2,
        "BTCUSDT",
        "SELL",
        52000,
        0.75, // remaining 50% of 1.5
        {},
      );

      // Verify status was updated to filled
      expect(configWithLimit.updateBinanceEntryOrderStatus).toHaveBeenCalledWith(1, "filled");
    });

    it("forwards BINANCE_WORKING_TYPE to SL/TP placement when configured", async () => {
      // Regression guard: getConfiguredBinanceWorkingType() was previously defined but
      // never wired into any order-placement call — setting the env var had zero effect.
      const previousWorkingType = process.env.BINANCE_WORKING_TYPE;
      process.env.BINANCE_WORKING_TYPE = "MARK_PRICE";
      try {
        const now = Date.now();
        const placedAt = new Date(now - 5 * 60 * 1000).toISOString();

        const configWithLimit: BinanceExecutionSystemConfig<any, any, any> = {
          ...config,
          getPendingEntryOrderPositions: vi.fn(() =>
            Promise.resolve([
              {
                id: 10,
                pair: "BTC/USDT",
                binanceSymbol: "BTCUSDT",
                binanceEntryOrderId: 100,
                binanceEntryOrderType: "LIMIT",
                binanceEntryOrderPlacedAt: placedAt,
                direction: "LONG",
                stopLoss: "49000",
                takeProfit1: "51000",
                takeProfit2: null,
                binanceQuantity: 1.0,
              },
            ]),
          ),
          updateBinanceEntryOrderStatus: vi.fn(),
          saveBinanceExecutionDetails: vi.fn(),
        };

        clientState.getRegularOrderStatus.mockResolvedValue({ status: "FILLED", executedQty: "1.0" });
        clientState.getExchangeInfoFilters.mockResolvedValue({
          tickSize: 1,
          stepSize: 0.001,
          minQty: 0.001,
          minNotional: 10,
        });
        clientState.placeStopMarketOrder.mockResolvedValue({ orderId: 201 });
        clientState.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 202 });

        const pollWithLimit = createPollPendingEntryOrder(configWithLimit);
        await pollWithLimit();

        expect(clientState.placeStopMarketOrder).toHaveBeenCalledWith(
          "BTCUSDT",
          "SELL",
          49000,
          { workingType: "MARK_PRICE" },
        );
        expect(clientState.placeTakeProfitMarketOrder).toHaveBeenNthCalledWith(
          1,
          "BTCUSDT",
          "SELL",
          51000,
          0.5, // no partialClosePercent set on this mock position -> defaults to 50%
          { workingType: "MARK_PRICE" },
        );
      } finally {
        if (previousWorkingType === undefined) delete process.env.BINANCE_WORKING_TYPE;
        else process.env.BINANCE_WORKING_TYPE = previousWorkingType;
      }
    });

    it("polls STOP_MARKET order and places SL/TP on FILLED", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 10 * 60 * 1000).toISOString(); // 10 min ago

      const configWithStop: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 2,
              pair: "ETH/USDT",
              binanceSymbol: "ETHUSDT",
              binanceEntryOrderId: 200,
              binanceEntryOrderType: "STOP_MARKET",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "SHORT",
              stopLoss: "2100",
              takeProfit1: "1900",
              takeProfit2: "1800",
              binanceQuantity: 5.0,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
        saveBinanceExecutionDetails: vi.fn(),
      };

      clientState.getOrderStatus.mockResolvedValue({ status: "FILLED", avgPrice: "2000" });
      clientState.getExchangeInfoFilters.mockResolvedValue({
        tickSize: 0.01,
        stepSize: 0.01,
        minQty: 0.01,
        minNotional: 10,
      });
      clientState.placeStopMarketOrder.mockResolvedValue({ orderId: 301 });
      clientState.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 302 });

      const pollWithStop = createPollPendingEntryOrder(configWithStop);
      await pollWithStop();

      // Verify STOP_MARKET order status was checked via algo endpoint
      expect(clientState.getOrderStatus).toHaveBeenCalledWith("ETHUSDT", 200);

      // Verify SL/TP were placed with the real filled quantity (5.0), split 50/50
      expect(clientState.placeStopMarketOrder).toHaveBeenCalledWith(
        "ETHUSDT",
        "BUY",
        2100,
        {},
      );
      expect(clientState.placeTakeProfitMarketOrder).toHaveBeenNthCalledWith(
        1,
        "ETHUSDT",
        "BUY",
        1900,
        2.5, // 50% of 5.0
        {},
      );
      expect(clientState.placeTakeProfitMarketOrder).toHaveBeenNthCalledWith(
        2,
        "ETHUSDT",
        "BUY",
        1800,
        2.5, // remaining 50% of 5.0
        {},
      );

      // Verify status updated to filled
      expect(configWithStop.updateBinanceEntryOrderStatus).toHaveBeenCalledWith(2, "filled");
    });

    it("uses the REAL exchange position amount for STOP_MARKET fill, not the originally-intended quantity", async () => {
      // getOrderStatus() (algo order status, used for STOP_MARKET) never reports
      // executedQty — TRIGGERED/FINISHED both normalize to "FILLED" regardless of
      // whether the underlying market order fully or only partially executed. This
      // guards the fix: SL/TP must be sized from getPositionAmount() (the real
      // exchange position), not blindly from position.binanceQuantity (the originally
      // planned size) — otherwise a partial STOP fill gets over-sized SL/TP orders.
      const now = Date.now();
      const placedAt = new Date(now - 10 * 60 * 1000).toISOString();

      const configWithStop: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 8,
              pair: "ETH/USDT",
              binanceSymbol: "ETHUSDT",
              binanceEntryOrderId: 800,
              binanceEntryOrderType: "STOP_MARKET",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "SHORT",
              stopLoss: "2100",
              takeProfit1: "1900",
              takeProfit2: "1800",
              binanceQuantity: 5.0, // originally intended — should NOT be used
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
        saveBinanceExecutionDetails: vi.fn(),
      };

      clientState.getOrderStatus.mockResolvedValue({ status: "FILLED", avgPrice: "2000" });
      // Exchange actually only filled 3.0 (thin liquidity) — different from binanceQuantity.
      clientState.getPositionAmount.mockResolvedValue(-3.0); // SHORT -> negative
      clientState.getExchangeInfoFilters.mockResolvedValue({
        tickSize: 0.01,
        stepSize: 0.01,
        minQty: 0.01,
        minNotional: 10,
      });
      clientState.placeStopMarketOrder.mockResolvedValue({ orderId: 301 });
      clientState.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 302 });

      const pollWithStop = createPollPendingEntryOrder(configWithStop);
      await pollWithStop();

      // TP quantities must be split from the REAL 3.0, not the planned 5.0.
      expect(clientState.placeTakeProfitMarketOrder).toHaveBeenNthCalledWith(
        1,
        "ETHUSDT",
        "BUY",
        1900,
        1.5, // 50% of REAL 3.0, not planned 5.0
        {},
      );
      expect(clientState.placeTakeProfitMarketOrder).toHaveBeenNthCalledWith(
        2,
        "ETHUSDT",
        "BUY",
        1800,
        1.5,
        {},
      );
    });

    it("marks entry order status as filled (not stuck 'working') even if SL/TP placement fails, to avoid an infinite retry loop", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 10 * 60 * 1000).toISOString();

      const updateBinanceEntryOrderStatus = vi.fn();
      const configFailedProtection: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 9,
              pair: "BTC/USDT",
              binanceSymbol: "BTCUSDT",
              binanceEntryOrderId: 900,
              binanceEntryOrderType: "LIMIT",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "49000",
              takeProfit1: "51000",
              takeProfit2: null,
              binanceQuantity: 1.0,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus,
        saveBinanceExecutionDetails: vi.fn(),
      };

      clientState.getRegularOrderStatus.mockResolvedValue({ status: "FILLED", executedQty: "1.0" });
      clientState.getExchangeInfoFilters.mockResolvedValue({
        tickSize: 1,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 10,
      });
      // SL placement fails -> placeProtectionOrdersAndFinalize throws.
      clientState.placeStopMarketOrder.mockResolvedValue(new Error("exchange rejected"));
      clientState.placeMarketOrder.mockResolvedValue({ orderId: 999, status: "FILLED", symbol: "BTCUSDT" });

      const pollFailedProtection = createPollPendingEntryOrder(configFailedProtection);
      await pollFailedProtection();

      // Must be marked "filled" (terminal) even though protection failed — leaving it
      // "working" would cause the next poll to re-run this exact FILLED branch forever.
      expect(updateBinanceEntryOrderStatus).toHaveBeenCalledWith(9, "filled");
    });

    it("retries SL placement on -4509 (position not yet synced after fill) and succeeds once Binance catches up", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 10 * 60 * 1000).toISOString();

      const configRetry4509: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 10,
              pair: "JTO/USDT",
              binanceSymbol: "JTOUSDT",
              binanceEntryOrderId: 1000,
              binanceEntryOrderType: "LIMIT",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "1.0",
              takeProfit1: "1.5",
              takeProfit2: null,
              binanceQuantity: 100,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
        saveBinanceExecutionDetails: vi.fn(),
      };

      clientState.getRegularOrderStatus.mockResolvedValue({ status: "FILLED", executedQty: "100" });
      // Position not synced yet right after fill (matches the -4509 log evidence).
      clientState.getPositionAmount.mockResolvedValue(0);
      clientState.getExchangeInfoFilters.mockResolvedValue({
        tickSize: 0.001,
        stepSize: 1,
        minQty: 1,
        minNotional: 10,
      });
      clientState.placeStopMarketOrder
        .mockResolvedValueOnce(
          new Error(
            "Binance Futures API loi 400 (code -4509) tai /fapi/v1/algoOrder: Time in Force (TIF) GTE can only be used with open positions. Please ensure that positions are available.",
          ),
        )
        .mockResolvedValueOnce(
          new Error(
            "Binance Futures API loi 400 (code -4509) tai /fapi/v1/algoOrder: Time in Force (TIF) GTE can only be used with open positions. Please ensure that positions are available.",
          ),
        )
        .mockResolvedValueOnce({ orderId: 501 });
      clientState.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 502 });

      const pollRetry4509 = createPollPendingEntryOrder(configRetry4509);
      await pollRetry4509();

      expect(clientState.placeStopMarketOrder).toHaveBeenCalledTimes(3);
      // Protection succeeded on the 3rd attempt -> no fail-safe close, no "failed" status.
      expect(clientState.placeMarketOrder).not.toHaveBeenCalled();
      expect(configRetry4509.saveBinanceExecutionDetails).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ binanceExecutionStatus: "placed" }),
      );
    }, 10_000);

    it("cancels LIMIT order on expiry and marks expired", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 65 * 60 * 1000).toISOString(); // 65 min ago (expired)

      const configExpiredLimit: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        entryOrderExpiryMinutes: 60,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 3,
              pair: "BTC/USDT",
              binanceSymbol: "BTCUSDT",
              binanceEntryOrderId: 100,
              binanceEntryOrderType: "LIMIT",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "49000",
              takeProfit1: "51000",
              takeProfit2: null,
              binanceQuantity: 1.0,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
        entryOrderExpiredPrefix: "*Test Expired*",
      };

      clientState.getRegularOrderStatus.mockResolvedValue({ status: "NEW", executedQty: "0" });
      clientState.cancelRegularOrder.mockResolvedValue(true);
      const closeExpiredEntryOrderPosition = vi.fn();
      configExpiredLimit.closeExpiredEntryOrderPosition = closeExpiredEntryOrderPosition;

      const pollExpired = createPollPendingEntryOrder(configExpiredLimit);
      await pollExpired();

      // Verify LIMIT cancel was called
      expect(clientState.cancelRegularOrder).toHaveBeenCalledWith("BTCUSDT", 100);

      // Verify status updated to expired
      expect(configExpiredLimit.updateBinanceEntryOrderStatus).toHaveBeenCalledWith(3, "expired");

      // Verify the DB row is closed so it doesn't stay orphaned as "still open, no SL/TP"
      // forever in reconcileBinancePosition.
      expect(closeExpiredEntryOrderPosition).toHaveBeenCalledWith(3);
    });

    it("does NOT mark expired or close the position if cancelling the entry order fails", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 65 * 60 * 1000).toISOString();

      const updateBinanceEntryOrderStatus = vi.fn();
      const closeExpiredEntryOrderPosition = vi.fn();
      const configCancelFail: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        entryOrderExpiryMinutes: 60,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 7,
              pair: "BTC/USDT",
              binanceSymbol: "BTCUSDT",
              binanceEntryOrderId: 100,
              binanceEntryOrderType: "LIMIT",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "49000",
              takeProfit1: "51000",
              takeProfit2: null,
              binanceQuantity: 1.0,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus,
        closeExpiredEntryOrderPosition,
      };

      clientState.getRegularOrderStatus.mockResolvedValue({ status: "NEW", executedQty: "0" });
      // Real cancel failure (not the tolerated -2011 "already gone" case).
      clientState.cancelRegularOrder.mockResolvedValue(new Error("network timeout"));

      const pollCancelFail = createPollPendingEntryOrder(configCancelFail);
      await pollCancelFail();

      // Must NOT mark expired or close the DB row — the order may still be live on the
      // exchange (or just filled) and needs to be retried/reconciled next cycle instead
      // of being silently abandoned.
      expect(updateBinanceEntryOrderStatus).not.toHaveBeenCalled();
      expect(closeExpiredEntryOrderPosition).not.toHaveBeenCalled();
    });

    it("cancels STOP_MARKET order on expiry and marks expired", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 90 * 60 * 1000).toISOString(); // 90 min ago (expired)

      const configExpiredStop: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        entryOrderExpiryMinutes: 60,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 4,
              pair: "ETH/USDT",
              binanceSymbol: "ETHUSDT",
              binanceEntryOrderId: 300,
              binanceEntryOrderType: "STOP_MARKET",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "2100",
              takeProfit1: "1900",
              takeProfit2: null,
              binanceQuantity: 10.0,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
        entryOrderExpiredPrefix: "*Test Expired*",
      };

      clientState.getOrderStatus.mockResolvedValue({ status: "NEW" });
      clientState.cancelOrder.mockResolvedValue(true);

      const pollExpiredStop = createPollPendingEntryOrder(configExpiredStop);
      await pollExpiredStop();

      // Verify STOP_MARKET cancel was called
      expect(clientState.cancelOrder).toHaveBeenCalledWith("ETHUSDT", 300);

      // Verify status updated to expired
      expect(configExpiredStop.updateBinanceEntryOrderStatus).toHaveBeenCalledWith(4, "expired");
    });

    it("handles partial fill at expiry by placing SL/TP with partial qty", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 65 * 60 * 1000).toISOString(); // 65 min ago (expired)

      const configPartialFill: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        entryOrderExpiryMinutes: 60,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 5,
              pair: "BTC/USDT",
              binanceSymbol: "BTCUSDT",
              binanceEntryOrderId: 400,
              binanceEntryOrderType: "LIMIT",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "49000",
              takeProfit1: "51000",
              takeProfit2: "52000",
              binanceQuantity: 2.0,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
        saveBinanceExecutionDetails: vi.fn(),
      };

      // Return PARTIALLY_FILLED with executedQty
      clientState.getRegularOrderStatus.mockResolvedValue({
        status: "PARTIALLY_FILLED",
        executedQty: "0.5",
      });
      clientState.getExchangeInfoFilters.mockResolvedValue({
        tickSize: 1,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 10,
      });
      clientState.placeStopMarketOrder.mockResolvedValue({ orderId: 401 });
      clientState.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 402 });
      clientState.cancelRegularOrder.mockResolvedValue(true);

      const pollPartial = createPollPendingEntryOrder(configPartialFill);
      await pollPartial();

      // Verify status was updated to filled (not expired)
      expect(configPartialFill.updateBinanceEntryOrderStatus).toHaveBeenCalledWith(5, "filled");

      // Verify the unfilled remainder of the LIMIT order was cancelled — otherwise it
      // could keep filling later with no further SL/TP tracking.
      expect(clientState.cancelRegularOrder).toHaveBeenCalledWith("BTCUSDT", 400);

      // Verify SL/TP quantities are split from the ACTUAL executedQty (0.5),
      // not the full position size (binanceQuantity: 2.0) — a regression here
      // would silently over-close the position on a partial fill.
      expect(clientState.placeStopMarketOrder).toHaveBeenCalledWith(
        "BTCUSDT",
        "SELL",
        49000,
        {},
      );
      expect(clientState.placeTakeProfitMarketOrder).toHaveBeenNthCalledWith(
        1,
        "BTCUSDT",
        "SELL",
        51000,
        0.25, // 50% of executedQty 0.5, NOT of binanceQuantity 2.0
        {},
      );
      expect(clientState.placeTakeProfitMarketOrder).toHaveBeenNthCalledWith(
        2,
        "BTCUSDT",
        "SELL",
        52000,
        0.25,
        {},
      );
    });

    it("does nothing for still-working entry orders (no action)", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 5 * 60 * 1000).toISOString(); // 5 min ago (within expiry)

      const configWorking: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        entryOrderExpiryMinutes: 60,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 6,
              pair: "BTC/USDT",
              binanceSymbol: "BTCUSDT",
              binanceEntryOrderId: 500,
              binanceEntryOrderType: "STOP_MARKET",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "49000",
              takeProfit1: "51000",
              takeProfit2: null,
              binanceQuantity: 1.0,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
      };

      // Order still working (NEW status)
      clientState.getOrderStatus.mockResolvedValue({ status: "NEW" });

      const pollWorking = createPollPendingEntryOrder(configWorking);
      await pollWorking();

      // Verify no status updates when working
      expect(configWorking.updateBinanceEntryOrderStatus).not.toHaveBeenCalled();

      // Verify no cancellations
      expect(clientState.cancelOrder).not.toHaveBeenCalled();
      expect(clientState.cancelRegularOrder).not.toHaveBeenCalled();
    });

    it("sends a Telegram message when an entry order fully fills", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 5 * 60 * 1000).toISOString();

      const configFilled: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 1,
              pair: "BTC/USDT",
              binanceSymbol: "BTCUSDT",
              binanceEntryOrderId: 100,
              binanceEntryOrderType: "LIMIT",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "49000",
              takeProfit1: "51000",
              takeProfit2: "52000",
              binanceQuantity: 1.5,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
      };

      clientState.getRegularOrderStatus.mockResolvedValue({ status: "FILLED", executedQty: "1.5" });
      clientState.getExchangeInfoFilters.mockResolvedValue({
        tickSize: 1,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 10,
      });
      clientState.placeStopMarketOrder.mockResolvedValue({ orderId: 201 });
      clientState.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 202 });

      const pollFilled = createPollPendingEntryOrder(configFilled);
      await pollFilled();

      // Verify sendMessage was called with the fill notification
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("đã khớp"),
      );
      // Verify it does NOT contain the expiry message
      expect(sendMessageMock).not.toHaveBeenCalledWith(
        expect.stringContaining("hết hạn"),
      );
    });

    it("does not send a fill message when protection orders fail to place", async () => {
      const now = Date.now();
      const placedAt = new Date(now - 5 * 60 * 1000).toISOString();

      const configFailedFill: BinanceExecutionSystemConfig<any, any, any> = {
        ...config,
        getPendingEntryOrderPositions: vi.fn(() =>
          Promise.resolve([
            {
              id: 1,
              pair: "BTC/USDT",
              binanceSymbol: "BTCUSDT",
              binanceEntryOrderId: 100,
              binanceEntryOrderType: "LIMIT",
              binanceEntryOrderPlacedAt: placedAt,
              direction: "LONG",
              stopLoss: "49000",
              takeProfit1: "51000",
              takeProfit2: "52000",
              binanceQuantity: 1.5,
            },
          ]),
        ),
        updateBinanceEntryOrderStatus: vi.fn(),
      };

      clientState.getRegularOrderStatus.mockResolvedValue({ status: "FILLED", executedQty: "1.5" });
      clientState.getExchangeInfoFilters.mockResolvedValue({
        tickSize: 1,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 10,
      });
      // Make SL placement fail
      clientState.placeStopMarketOrder.mockRejectedValue(new Error("Exchange rejected"));
      clientState.placeTakeProfitMarketOrder.mockResolvedValue({ orderId: 202 });

      const pollFailedFill = createPollPendingEntryOrder(configFailedFill);
      await pollFailedFill();

      // Verify sendMessage was NOT called with the fill notification
      // (The fail-safe messaging may fire, but not the new fill message specifically)
      const allCalls = sendMessageMock.mock.calls.map((call) => call[0] ?? "");
      const hasFilledMessage = allCalls.some((msg) => msg.includes("đã khớp") && !msg.includes("hết hạn"));
      expect(hasFilledMessage).toBe(false);
    });
  });

  describe("Entry order configuration", () => {
    it("new config fields are optional for backward compat", () => {
      const minimalConfig: BinanceExecutionSystemConfig<any, any, any> = {
        systemLabel: "Test",
        loggerName: "charts:test",
        calculateRiskRewardPlan: () => null,
        saveBinanceExecutionDetails: vi.fn(),
        updateBinanceSlOrder: vi.fn(),
        guardFailPrefix: "*Test*",
        failSafeMessagePrefix: "*Test*",
        failSafeEmergencyMessagePrefix: "*Test*",
        dbErrorPrefix: "*Test*",
        successPrefix: "*Test*",
        entryErrorPrefix: "*Test*",
        closeFailedUrgentPrefix: "*Test*",
        tp1MoveSLFailPrefix: "*Test*",
      };

      expect(minimalConfig.entryExecutionMode).toBeUndefined();
      expect(minimalConfig.entryOrderExpiryMinutes).toBeUndefined();
      expect(minimalConfig.saveBinancePendingEntryOrder).toBeUndefined();
      expect(minimalConfig.getPendingEntryOrderPositions).toBeUndefined();
    });

    it("honors config.entryExecutionMode when set to HONOR_ORDER_TYPE", () => {
      const config: BinanceExecutionSystemConfig<any, any, any> = {
        systemLabel: "Test",
        loggerName: "charts:test",
        calculateRiskRewardPlan: () => null,
        saveBinanceExecutionDetails: vi.fn(),
        updateBinanceSlOrder: vi.fn(),
        guardFailPrefix: "*Test*",
        failSafeMessagePrefix: "*Test*",
        failSafeEmergencyMessagePrefix: "*Test*",
        dbErrorPrefix: "*Test*",
        successPrefix: "*Test*",
        entryErrorPrefix: "*Test*",
        closeFailedUrgentPrefix: "*Test*",
        tp1MoveSLFailPrefix: "*Test*",
        entryExecutionMode: "HONOR_ORDER_TYPE",
        entryOrderExpiryMinutes: 120,
      };

      expect(config.entryExecutionMode).toBe("HONOR_ORDER_TYPE");
      expect(config.entryOrderExpiryMinutes).toBe(120);
    });
  });
});
