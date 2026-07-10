import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";
import { resetRateLimitStateForTests } from "../../src/shared/rate-limit.js";

vi.mock("../../src/charts/ohlc-cache-repository.js", () => ({
  loadOhlcCandleCache: vi.fn(),
  saveOhlcCandleCache: vi.fn(),
}));

const ohlc = await import("../../src/charts/ohlc-provider.js");
const ohlcCacheRepo = await import("../../src/charts/ohlc-cache-repository.js");

describe("toTwelveDataSymbol", () => {
  test("maps EUR/USD correctly", () => {
    expect(ohlc.toTwelveDataSymbol("OANDA:EURUSD")).toBe("EUR/USD");
  });

  test("maps XAU/USD correctly", () => {
    expect(ohlc.toTwelveDataSymbol("OANDA:XAUUSD")).toBe("XAU/USD");
  });

  test("returns null for non-OANDA prefix", () => {
    expect(ohlc.toTwelveDataSymbol("TVC:EURUSD")).toBeNull();
  });

  test("returns null for short instrument", () => {
    expect(ohlc.toTwelveDataSymbol("OANDA:ABC")).toBeNull();
  });
});

describe("toBinanceSymbol", () => {
  test("maps BINANCE:BTCUSDT correctly", () => {
    expect(ohlc.toBinanceSymbol("BINANCE:BTCUSDT")).toBe("BTCUSDT");
  });

  test("returns null for non-BINANCE prefix", () => {
    expect(ohlc.toBinanceSymbol("OANDA:EURUSD")).toBeNull();
  });

  test("returns null for too-short instrument", () => {
    expect(ohlc.toBinanceSymbol("BINANCE:BTC")).toBeNull();
  });
});

describe("fetchOhlcHistory", () => {
  beforeEach(() => {
    delete process.env.TWELVEDATA_API_KEY;
    delete process.env.METAAPI_TOKEN;
    delete process.env.METAAPI_ACCOUNT_ID;
    delete process.env.METAAPI_MARKET_DATA_BASE_URL;
    delete process.env.METAAPI_REGION;
    delete process.env.METAAPI_SYMBOL_SUFFIX;
    vi.useRealTimers();
    ohlc.clearOhlcCache();
    resetRateLimitStateForTests();
    vi.restoreAllMocks();
    vi.mocked(ohlcCacheRepo.loadOhlcCandleCache).mockReset();
    vi.mocked(ohlcCacheRepo.saveOhlcCandleCache).mockReset();
  });

  test("returns a clear config error when TWELVEDATA_API_KEY is missing", async () => {
    process.env.METAAPI_TOKEN = "legacy-token";
    process.env.METAAPI_ACCOUNT_ID = "legacy-account";

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("TWELVEDATA_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("uses Twelve Data and ignores MetaApi env vars when the API key is set", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";
    process.env.METAAPI_TOKEN = "legacy-token";
    process.env.METAAPI_ACCOUNT_ID = "legacy-account";
    process.env.METAAPI_REGION = "singapore";
    process.env.METAAPI_MARKET_DATA_BASE_URL = "https://legacy.example.com";
    process.env.METAAPI_SYMBOL_SUFFIX = "m";

    const tdResponse = {
      status: "ok",
      values: [
        { datetime: "2024-01-02 00:00:00", open: "1.101", high: "1.102", low: "1.100", close: "1.1015", volume: "500" },
        { datetime: "2024-01-01 00:00:00", open: "1.099", high: "1.100", low: "1.098", close: "1.0995", volume: "400" },
      ],
    };

    let capturedUrl = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(tdResponse), { status: 200 });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);

    expect(result).not.toBeInstanceOf(Error);
    const candles = result as Candle[];
    expect(capturedUrl).toContain("api.twelvedata.com/time_series");
    expect(capturedUrl).toContain("symbol=EUR%2FUSD");
    expect(capturedUrl).toContain("interval=4h");
    expect(candles).toHaveLength(2);
    expect(candles[0].time).toBeLessThan(candles[1].time);
    expect(candles[0].open).toBe(1.099);
    expect(candles[0].volume).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("parses Twelve Data timestamps as UTC and skips the newest incomplete candle", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const tdResponse = {
      status: "ok",
      values: [
        { datetime: "2024-01-01 12:00:00", open: "1.102", high: "1.103", low: "1.101", close: "1.1025", volume: "500" },
        { datetime: "2024-01-01 08:00:00", open: "1.099", high: "1.100", low: "1.098", close: "1.0995", volume: "400" },
      ],
    };

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2024-01-01T12:30:00Z"));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(tdResponse), { status: 200 }),
    );

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);

    expect(result).not.toBeInstanceOf(Error);
    const candles = result as Candle[];
    expect(candles).toHaveLength(1);
    expect(candles[0].time).toBe(Date.parse("2024-01-01T08:00:00Z"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  test("keeps H4 cache until the next 4h close boundary plus buffer", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T05:30:00Z"));

    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          status: "ok",
          values: [
            { datetime: "2024-01-01 04:00:00", open: `${1.2 + callCount}`, high: "2.300", low: "2.100", close: "2.250", volume: "500" },
            { datetime: "2024-01-01 00:00:00", open: `${1.1 + callCount}`, high: "1.200", low: "1.000", close: "1.150", volume: "400" },
          ],
        }),
        { status: 200 },
      );
    });

    await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(callCount).toBe(1);

    vi.setSystemTime(new Date("2024-01-01T08:00:59Z"));
    await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(callCount).toBe(1);

    vi.setSystemTime(new Date("2024-01-01T08:01:00Z"));
    await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(callCount).toBe(2);

    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  test("does not cache D1 results yet while daily close timing is still unverified", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          status: "ok",
          values: [
            { datetime: "2023-12-31", open: `${1.1 + callCount}`, high: "2.110", low: "2.090", close: "2.105", volume: "100" },
          ],
        }),
        { status: 200 },
      );
    });

    await ohlc.fetchOhlcHistory("OANDA:EURUSD", "D1", 100);
    expect(callCount).toBe(1);

    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    await ohlc.fetchOhlcHistory("OANDA:EURUSD", "D1", 100);
    expect(callCount).toBe(2);

    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  test("returns an API error clearly when Twelve Data responds with status error", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "error", message: "invalid symbol" }), { status: 200 }),
    );

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("invalid symbol");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("includes fetch cause details when Node fetch fails at runtime", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const networkError = new TypeError("fetch failed");
    (networkError as Error & { cause?: unknown }).cause = {
      code: "ECONNRESET",
      syscall: "connect",
      host: "api.twelvedata.com",
      message: "Client network socket disconnected before secure TLS connection was established",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(networkError);

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("fetch failed");
    expect((result as Error).message).toContain("ECONNRESET");
    expect((result as Error).message).toContain("api.twelvedata.com");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  test("loads from Supabase cache on in-memory miss and skips TwelveData fetch", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const mockCandles: Candle[] = [
      { time: 1704067200000, open: 1.1, high: 1.11, low: 1.09, close: 1.105, volume: 100 },
      { time: 1704070800000, open: 1.105, high: 1.12, low: 1.1, close: 1.115, volume: 120 },
    ];
    const expiresAtMs = Date.now() + 60_000;

    vi.mocked(ohlcCacheRepo.loadOhlcCandleCache).mockResolvedValue({
      candles: mockCandles,
      expiresAtMs,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);

    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual(mockCandles);
    expect(ohlcCacheRepo.loadOhlcCandleCache).toHaveBeenCalledWith("OANDA:EURUSD:H4");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("fetches from TwelveData on Supabase cache miss and saves to cache", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const tdResponse = {
      status: "ok",
      values: [
        { datetime: "2024-01-02 00:00:00", open: "1.101", high: "1.102", low: "1.100", close: "1.1015", volume: "500" },
        { datetime: "2024-01-01 00:00:00", open: "1.099", high: "1.100", low: "1.098", close: "1.0995", volume: "400" },
      ],
    };

    vi.mocked(ohlcCacheRepo.loadOhlcCandleCache).mockResolvedValue(null);
    vi.mocked(ohlcCacheRepo.saveOhlcCandleCache).mockResolvedValue(undefined);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(tdResponse), { status: 200 }),
    );

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);

    expect(result).not.toBeInstanceOf(Error);
    expect(result).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(ohlcCacheRepo.loadOhlcCandleCache).toHaveBeenCalledWith("OANDA:EURUSD:H4");
    expect(ohlcCacheRepo.saveOhlcCandleCache).toHaveBeenCalledTimes(1);
    expect(ohlcCacheRepo.saveOhlcCandleCache).toHaveBeenCalledWith(
      "OANDA:EURUSD:H4",
      expect.any(Array),
      expect.any(Number),
    );
  });

  test("fetches BINANCE symbols from Binance klines API without TWELVEDATA_API_KEY", async () => {
    // openTime, open, high, low, close, volume, closeTime
    const nowMs = Date.parse("2024-01-01T12:30:00Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    const klines = [
      [Date.parse("2024-01-01T04:00:00Z"), "42000", "42500", "41800", "42400", "120.5", Date.parse("2024-01-01T08:00:00Z") - 1],
      [Date.parse("2024-01-01T08:00:00Z"), "42400", "42800", "42200", "42600", "98.2", Date.parse("2024-01-01T12:00:00Z") - 1],
      // Still-forming candle: closeTime in the future -> must be dropped
      [Date.parse("2024-01-01T12:00:00Z"), "42600", "42700", "42500", "42650", "10.0", Date.parse("2024-01-01T16:00:00Z") - 1],
    ];

    vi.mocked(ohlcCacheRepo.loadOhlcCandleCache).mockResolvedValue(null);
    vi.mocked(ohlcCacheRepo.saveOhlcCandleCache).mockResolvedValue(undefined);

    let capturedUrl = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(klines), { status: 200 });
    });

    const result = await ohlc.fetchOhlcHistory("BINANCE:BTCUSDT", "H4", 100);

    expect(result).not.toBeInstanceOf(Error);
    const candles = result as Candle[];
    expect(capturedUrl).toContain("api.binance.com/api/v3/klines");
    expect(capturedUrl).toContain("symbol=BTCUSDT");
    expect(capturedUrl).toContain("interval=4h");
    expect(candles).toHaveLength(2);
    expect(candles[0].time).toBe(Date.parse("2024-01-01T04:00:00Z"));
    expect(candles[0].open).toBe(42000);
    expect(candles[1].close).toBe(42600);
    expect(candles[1].volume).toBe(98.2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  test("returns Binance API errors clearly", async () => {
    vi.mocked(ohlcCacheRepo.loadOhlcCandleCache).mockResolvedValue(null);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), { status: 400 }),
    );

    const result = await ohlc.fetchOhlcHistory("BINANCE:FAKEPAIR", "H4", 100);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("Invalid symbol");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("D1 never touches Supabase cache (loadOhlcCandleCache and saveOhlcCandleCache not called)", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const tdResponse = {
      status: "ok",
      values: [
        { datetime: "2023-12-31", open: "1.1", high: "2.110", low: "2.090", close: "2.105", volume: "100" },
      ],
    };

    vi.mocked(ohlcCacheRepo.loadOhlcCandleCache).mockResolvedValue(null);
    vi.mocked(ohlcCacheRepo.saveOhlcCandleCache).mockResolvedValue(undefined);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(tdResponse), { status: 200 }),
    );

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "D1", 100);

    expect(result).not.toBeInstanceOf(Error);
    expect(result).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(ohlcCacheRepo.loadOhlcCandleCache).not.toHaveBeenCalled();
    expect(ohlcCacheRepo.saveOhlcCandleCache).not.toHaveBeenCalled();
  });
});

describe("fetchLastPrice", () => {
  beforeEach(() => {
    delete process.env.TWELVEDATA_API_KEY;
    vi.useRealTimers();
    resetRateLimitStateForTests();
    vi.restoreAllMocks();
  });

  test("fetches Binance ticker/price successfully", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ symbol: "BTCUSDT", price: "42500.00" }), { status: 200 }),
    );

    const result = await ohlc.fetchLastPrice("BINANCE:BTCUSDT");

    expect(result).not.toBeInstanceOf(Error);
    expect(result).toBe(42500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0];
    expect(String(url)).toContain("api.binance.com/api/v3/ticker/price");
    expect(String(url)).toContain("symbol=BTCUSDT");
  });

  test("fetches Twelve Data price successfully", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", symbol: "EUR/USD", price: 1.3456 }), { status: 200 }),
    );

    const result = await ohlc.fetchLastPrice("OANDA:EURUSD");

    expect(result).not.toBeInstanceOf(Error);
    expect(result).toBe(1.3456);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0];
    expect(String(url)).toContain("api.twelvedata.com/price");
    expect(String(url)).toContain("symbol=EUR%2FUSD");
  });

  test("returns error when Binance API returns 500", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ msg: "Internal Server Error" }), { status: 500 }),
    );

    const result = await ohlc.fetchLastPrice("BINANCE:BTCUSDT");

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("Binance API tra ve 500");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  test("returns error for invalid symbol format", async () => {
    const result = await ohlc.fetchLastPrice("INVALID:XYZ");

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("Symbol khong dung dinh dang");
  });

  test("returns error when response missing price field", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );

    const result = await ohlc.fetchLastPrice("OANDA:EURUSD");

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("Twelve Data khong tra ve price");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("returns error when TWELVEDATA_API_KEY is missing for Twelve Data symbol", async () => {
    const result = await ohlc.fetchLastPrice("OANDA:EURUSD");

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("TWELVEDATA_API_KEY");
  });

  test("returns error when Binance response missing price field", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ symbol: "BTCUSDT" }), { status: 200 }),
    );

    const result = await ohlc.fetchLastPrice("BINANCE:BTCUSDT");

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("Binance khong tra ve price");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("parses Binance price from string correctly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ symbol: "ETHUSDT", price: "2345.6789" }), { status: 200 }),
    );

    const result = await ohlc.fetchLastPrice("BINANCE:ETHUSDT");

    expect(result).not.toBeInstanceOf(Error);
    expect(result).toBe(2345.6789);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("returns error when Twelve Data API returns error status", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "error", message: "Invalid symbol" }), { status: 200 }),
    );

    const result = await ohlc.fetchLastPrice("OANDA:INVALID");

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("Invalid symbol");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
