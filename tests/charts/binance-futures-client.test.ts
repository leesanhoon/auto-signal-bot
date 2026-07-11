import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getAvailableBalanceUsdt, getOrderStatus } from "../../src/charts/binance-futures-client.js";

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
});
