import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";

// Import the module under test
const ohlc = await import("../../src/charts/ohlc-provider.js");

// ---------------------------------------------------------------------------
// toOandaInstrument
// ---------------------------------------------------------------------------

describe("toOandaInstrument", () => {
  test("maps EUR/USD correctly", () => {
    expect(ohlc.toOandaInstrument("OANDA:EURUSD")).toBe("EUR_USD");
  });

  test("maps GBP/USD correctly", () => {
    expect(ohlc.toOandaInstrument("OANDA:GBPUSD")).toBe("GBP_USD");
  });

  test("maps XAU/USD correctly", () => {
    expect(ohlc.toOandaInstrument("OANDA:XAUUSD")).toBe("XAU_USD");
  });

  test("maps XAG/USD correctly", () => {
    expect(ohlc.toOandaInstrument("OANDA:XAGUSD")).toBe("XAG_USD");
  });

  test("maps USD/JPY correctly", () => {
    expect(ohlc.toOandaInstrument("OANDA:USDJPY")).toBe("USD_JPY");
  });

  test("returns null for non-OANDA prefix", () => {
    expect(ohlc.toOandaInstrument("TVC:EURUSD")).toBeNull();
  });

  test("returns null for short instrument", () => {
    expect(ohlc.toOandaInstrument("OANDA:ABC")).toBeNull();
  });

  test("returns null for empty instrument", () => {
    expect(ohlc.toOandaInstrument("OANDA:")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchOhlcHistory
// ---------------------------------------------------------------------------

describe("fetchOhlcHistory", () => {
  beforeEach(() => {
    delete process.env.OANDA_API_TOKEN;
    delete process.env.OANDA_ACCOUNT_ID;
    delete process.env.OANDA_API_BASE_URL;
    ohlc.clearOhlcCache();
    vi.restoreAllMocks();
  });

  test("returns Error when env vars are missing", async () => {
    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("OANDA_API_TOKEN");
  });

  test("returns Error when symbol cannot be mapped", async () => {
    process.env.OANDA_API_TOKEN = "dummy";
    process.env.OANDA_ACCOUNT_ID = "dummy";
    const result = await ohlc.fetchOhlcHistory("OANDA:XYZ", "H4", 100);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("Symbol");
  });

  test("returns Error when API response is not ok", async () => {
    process.env.OANDA_API_TOKEN = "dummy";
    process.env.OANDA_ACCOUNT_ID = "dummy";

    const mockFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(null, { status: 401, statusText: "Unauthorized" }),
      );

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("401");
    mockFetch.mockRestore();
  });

  test("parses valid OANDA response and returns sorted Candle[]", async () => {
    process.env.OANDA_API_TOKEN = "dummy";
    process.env.OANDA_ACCOUNT_ID = "dummy";

    const oandaResponse = {
      candles: [
        {
          complete: true,
          volume: 120,
          time: "2024-01-02T00:00:00.000000000Z",
          mid: { o: "1.1000", h: "1.1010", l: "1.0990", c: "1.1005" },
        },
        {
          complete: true,
          volume: 85,
          time: "2024-01-01T00:00:00.000000000Z",
          mid: { o: "1.0990", h: "1.0998", l: "1.0985", c: "1.0995" },
        },
      ],
    };

    const mockFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(oandaResponse), { status: 200 }),
      );

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).not.toBeInstanceOf(Error);
    const candles = result as Candle[];

    // Sorted ascending by time
    expect(candles).toHaveLength(2);
    expect(candles[0].time).toBeLessThan(candles[1].time);
    expect(candles[0].time).toBe(Date.parse("2024-01-01T00:00:00.000Z"));
    expect(candles[0].open).toBe(1.099);
    expect(candles[0].close).toBe(1.0995);
    expect(candles[0].volume).toBe(85);

    mockFetch.mockRestore();
  });

  test("filters out incomplete candles", async () => {
    process.env.OANDA_API_TOKEN = "dummy";
    process.env.OANDA_ACCOUNT_ID = "dummy";

    const oandaResponse = {
      candles: [
        {
          complete: true,
          volume: 100,
          time: "2024-01-01T00:00:00.000000000Z",
          mid: { o: "1.10", h: "1.11", l: "1.09", c: "1.105" },
        },
        {
          complete: false, // still-forming candle
          volume: 50,
          time: "2024-01-02T00:00:00.000000000Z",
          mid: { o: "1.105", h: "1.106", l: "1.104", c: "1.105" },
        },
      ],
    };

    const mockFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(oandaResponse), { status: 200 }),
      );

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "M15", 100);
    expect(result).not.toBeInstanceOf(Error);
    const candles = result as Candle[];
    expect(candles).toHaveLength(1);
    expect(candles[0].volume).toBe(100);

    mockFetch.mockRestore();
  });

  test("returns cached data within TTL and re-fetches after TTL expires", async () => {
    process.env.OANDA_API_TOKEN = "dummy";
    process.env.OANDA_ACCOUNT_ID = "dummy";

    let callCount = 0;

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      const o = 1.1 + callCount * 0.001;
      const body = {
        candles: [
          {
            complete: true,
            volume: 100,
            time: "2024-01-01T00:00:00.000000000Z",
            mid: {
              o: String(o),
              h: String(o + 0.01),
              l: String(o - 0.01),
              c: String(o + 0.005),
            },
          },
        ],
      };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    // First call → fetches from API
    const r1 = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "M15", 100);
    expect(callCount).toBe(1);

    // Second call → should be cached (cache TTL for M15 is 5 minutes)
    const r2 = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "M15", 100);
    expect(callCount).toBe(1); // still 1, cache hit

    const candles1 = r1 as Candle[];
    const candles2 = r2 as Candle[];
    expect(candles1[0].open).toBe(candles2[0].open);
    expect(candles1[0].time).toBe(candles2[0].time);

    // Simulate TTL expiry by clearing cache
    ohlc.invalidateOhlcCache("OANDA:EURUSD", "M15");
    const r3 = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "M15", 100);
    expect(callCount).toBe(2); // fetched again

    mockFetch.mockRestore();
  });

  test("passes correct URL and Authorization header", async () => {
    process.env.OANDA_API_TOKEN = "test-token-123";
    process.env.OANDA_ACCOUNT_ID = "test-account";
    process.env.OANDA_API_BASE_URL = "https://api-oanda.example.com";

    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      capturedUrl = String(url);
      capturedHeaders = (opts?.headers as Record<string, string>) || {};
      return new Response(JSON.stringify({ candles: [] }), { status: 200 });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:XAUUSD", "D1", 50);
    expect(result).not.toBeInstanceOf(Error);

    expect(capturedUrl).toContain("https://api-oanda.example.com/v3/instruments/XAU_USD/candles");
    expect(capturedUrl).toContain("granularity=D");
    expect(capturedUrl).toContain("count=50");
    expect(capturedHeaders["Authorization"]).toBe("Bearer test-token-123");

    mockFetch.mockRestore();
  });
});