import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";
import { resetRateLimitStateForTests } from "../../src/shared/rate-limit.js";

const ohlc = await import("../../src/charts/ohlc-provider.js");

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
});
