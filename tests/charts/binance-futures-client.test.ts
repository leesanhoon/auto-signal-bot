import { describe, it, expect, beforeEach } from "vitest";
import { getAvailableBalanceUsdt } from "../../src/charts/binance-futures-client.js";

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
});
