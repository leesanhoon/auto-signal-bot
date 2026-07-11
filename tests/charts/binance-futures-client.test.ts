import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAvailableBalanceUsdt,
  getOrderStatus,
  placeLimitOrder,
  placeStopMarketEntryOrder,
  placeTrailingStopMarketOrder,
  placeStopMarketOrder,
  placeTakeProfitMarketOrder,
} from "../../src/charts/binance-futures-client.js";

describe("charts/binance-futures-client", () => {
  beforeEach(() => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;
  });

  it("returns Error when BINANCE_API_KEY is not set", async () => {
    delete process.env.BINANCE_API_KEY;
    process.env.BINANCE_API_SECRET = "test_secret";

    const result = await getAvailableBalanceUsdt();
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("chua duoc cau hinh");
  });

  it("returns Error when BINANCE_API_SECRET is not set", async () => {
    process.env.BINANCE_API_KEY = "test_key";
    delete process.env.BINANCE_API_SECRET;

    const result = await getAvailableBalanceUsdt();
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("chua duoc cau hinh");
  });

  it("returns Error when both BINANCE_API_KEY and BINANCE_API_SECRET are missing", async () => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;

    const result = await getAvailableBalanceUsdt();
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("chua duoc cau hinh");
  });

  describe("getOrderStatus algoStatus mapping", () => {
    // Regression test cho bug phat hien qua testnet 2026-07-11: mot algo order
    // (SL/TP) da khop that tren Binance tra ve algoStatus "FINISHED", KHONG PHAI
    // "TRIGGERED" — ban goc chi map "TRIGGERED" -> "FILLED" nen reconcileBinancePosition
    // (ca Volman lan SMC) khong bao gio phat hien duoc fill that, position treo o HOLD
    // vinh vien du da khop that tren san.
    beforeEach(() => {
      process.env.BINANCE_API_KEY = "test_key";
      process.env.BINANCE_API_SECRET = "test_secret";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("maps algoStatus FINISHED to FILLED (order da khop that)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ algoStatus: "FINISHED", symbol: "BTCUSDT" }),
        })),
      );

      const result = await getOrderStatus("BTCUSDT", 123);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as { status: string }).status).toBe("FILLED");
    });

    it("maps algoStatus TRIGGERED to FILLED", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ algoStatus: "TRIGGERED", symbol: "BTCUSDT" }),
        })),
      );

      const result = await getOrderStatus("BTCUSDT", 123);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as { status: string }).status).toBe("FILLED");
    });

    it("khong map algoStatus CANCELED thanh FILLED (lenh bi huy khong duoc coi la da khop)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ algoStatus: "CANCELED", symbol: "BTCUSDT" }),
        })),
      );

      const result = await getOrderStatus("BTCUSDT", 123);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as { status: string }).status).toBe("CANCELED");
    });

    it("khong map algoStatus WORKING/NEW thanh FILLED (lenh dang cho, chua khop)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ algoStatus: "WORKING", symbol: "BTCUSDT" }),
        })),
      );

      const result = await getOrderStatus("BTCUSDT", 123);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as { status: string }).status).toBe("WORKING");
    });
  });

  describe("placeLimitOrder", () => {
    beforeEach(() => {
      process.env.BINANCE_API_KEY = "test_key";
      process.env.BINANCE_API_SECRET = "test_secret";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("places a LIMIT order with correct URL and default timeInForce", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ orderId: 456, status: "NEW", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeLimitOrder("BTCUSDT", "BUY", 50000, 0.01);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as { orderId: number }).orderId).toBe(456);
      expect(capturedUrl).toContain("/fapi/v1/order");
      expect(capturedUrl).toContain("type=LIMIT");
      expect(capturedUrl).toContain("timeInForce=GTC");
      expect(capturedUrl).toContain("price=50000");
      expect(capturedUrl).toContain("quantity=0.01");
    });

    it("includes timeInForce when specified in options", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ orderId: 456, status: "NEW", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeLimitOrder("BTCUSDT", "SELL", 51000, 0.02, {
        timeInForce: "IOC",
      });
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).toContain("timeInForce=IOC");
    });

    it("includes reduceOnly when specified in options", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ orderId: 456, status: "NEW", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeLimitOrder("BTCUSDT", "SELL", 51000, 0.02, {
        reduceOnly: true,
      });
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).toContain("reduceOnly=true");
    });

    it("returns Error when API returns non-ok response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ code: -1022, msg: "Invalid signature" }),
        })),
      );

      const result = await placeLimitOrder("BTCUSDT", "BUY", 50000, 0.01);
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("placeStopMarketEntryOrder", () => {
    beforeEach(() => {
      process.env.BINANCE_API_KEY = "test_key";
      process.env.BINANCE_API_SECRET = "test_secret";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("places a STOP_MARKET entry order via algoOrder endpoint with quantity", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 789, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeStopMarketEntryOrder("BTCUSDT", "BUY", 49000, 0.01);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as { orderId: number }).orderId).toBe(789);
      expect(capturedUrl).toContain("/fapi/v1/algoOrder");
      expect(capturedUrl).toContain("type=STOP_MARKET");
      expect(capturedUrl).toContain("triggerPrice=49000");
      expect(capturedUrl).toContain("quantity=0.01");
      expect(capturedUrl).not.toContain("closePosition");
      expect(capturedUrl).not.toContain("reduceOnly");
    });

    it("includes workingType when specified in options", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 789, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeStopMarketEntryOrder("BTCUSDT", "BUY", 49000, 0.01, {
        workingType: "MARK_PRICE",
      });
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).toContain("workingType=MARK_PRICE");
    });

    it("omits workingType when not specified", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 789, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeStopMarketEntryOrder("BTCUSDT", "BUY", 49000, 0.01);
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).not.toContain("workingType");
    });
  });

  describe("placeTrailingStopMarketOrder", () => {
    beforeEach(() => {
      process.env.BINANCE_API_KEY = "test_key";
      process.env.BINANCE_API_SECRET = "test_secret";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("places a TRAILING_STOP_MARKET order without activationPrice", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 999, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeTrailingStopMarketOrder("BTCUSDT", "SELL", 0.05, 0.01);
      expect(result).not.toBeInstanceOf(Error);
      expect((result as { orderId: number }).orderId).toBe(999);
      expect(capturedUrl).toContain("/fapi/v1/algoOrder");
      expect(capturedUrl).toContain("type=TRAILING_STOP_MARKET");
      expect(capturedUrl).toContain("callbackRate=0.05");
      expect(capturedUrl).toContain("quantity=0.01");
      expect(capturedUrl).toContain("reduceOnly=true");
      expect(capturedUrl).not.toContain("activationPrice");
    });

    it("places a TRAILING_STOP_MARKET order with activationPrice", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 999, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeTrailingStopMarketOrder(
        "BTCUSDT",
        "SELL",
        0.05,
        0.01,
        52000,
      );
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).toContain("activationPrice=52000");
    });

    it("includes workingType when specified in options", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 999, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeTrailingStopMarketOrder(
        "BTCUSDT",
        "SELL",
        0.05,
        0.01,
        undefined,
        { workingType: "CONTRACT_PRICE" },
      );
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).toContain("workingType=CONTRACT_PRICE");
    });
  });

  describe("workingType param on existing order functions", () => {
    beforeEach(() => {
      process.env.BINANCE_API_KEY = "test_key";
      process.env.BINANCE_API_SECRET = "test_secret";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("includes workingType in placeStopMarketOrder when specified", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 111, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeStopMarketOrder("BTCUSDT", "SELL", 49000, {
        workingType: "MARK_PRICE",
      });
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).toContain("workingType=MARK_PRICE");
    });

    it("omits workingType in placeStopMarketOrder when not specified", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 111, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeStopMarketOrder("BTCUSDT", "SELL", 49000);
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).not.toContain("workingType");
    });

    it("includes workingType in placeTakeProfitMarketOrder when specified", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 222, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeTakeProfitMarketOrder(
        "BTCUSDT",
        "SELL",
        52000,
        0.01,
        { workingType: "CONTRACT_PRICE" },
      );
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).toContain("workingType=CONTRACT_PRICE");
    });

    it("omits workingType in placeTakeProfitMarketOrder when not specified", async () => {
      let capturedUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          capturedUrl = url as string;
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ algoId: 222, algoStatus: "WORKING", symbol: "BTCUSDT" }),
          };
        }),
      );

      const result = await placeTakeProfitMarketOrder("BTCUSDT", "SELL", 52000, 0.01);
      expect(result).not.toBeInstanceOf(Error);
      expect(capturedUrl).not.toContain("workingType");
    });
  });
});
