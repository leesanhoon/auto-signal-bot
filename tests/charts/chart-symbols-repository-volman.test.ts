import { beforeEach, describe, expect, test, vi } from "vitest";

const repoState = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  from: vi.fn(),
}));

vi.mock("../../src/shared/db.js", () => ({
  getDb: () => ({ from: repoState.from }),
}));

const { loadActiveChartSymbols } = await import(
  "../../src/charts/chart-symbols-repository-volman.js"
);

describe("charts/chart-symbols-repository-volman", () => {
  beforeEach(() => {
    repoState.from.mockReset();
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(async () => repoState.result),
    };
    repoState.from.mockReturnValue(chain);
  });

  test("trả về danh sách symbol khi query thành công", async () => {
    repoState.result = {
      data: [
        { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
        { name: "EUR/USD", symbol: "OANDA:EURUSD" },
      ],
      error: null,
    };

    const result = await loadActiveChartSymbols();

    expect(repoState.from).toHaveBeenCalledWith("chart_symbols_volman");
    expect(repoState.from().select).toHaveBeenCalledWith("name, symbol");
    expect(repoState.from().eq).toHaveBeenCalledWith("is_active", true);
    expect(result).toEqual([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
      { name: "EUR/USD", symbol: "OANDA:EURUSD" },
    ]);
  });

  test("throw khi Supabase trả error", async () => {
    repoState.result = { data: null, error: { message: "connection refused" } };

    await expect(loadActiveChartSymbols()).rejects.toThrow(/connection refused/);
  });

  test("throw khi data rỗng", async () => {
    repoState.result = { data: [], error: null };

    await expect(loadActiveChartSymbols()).rejects.toThrow(/không có symbol/);
  });

  test("throw khi data là null", async () => {
    repoState.result = { data: null, error: null };

    await expect(loadActiveChartSymbols()).rejects.toThrow(/không có symbol/);
  });
});
