import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";
import { resetRateLimitStateForTests } from "../../src/shared/rate-limit.js";

// Import the module under test
const ohlc = await import("../../src/charts/ohlc-provider.js");

function domainResponse(domain = "agiliumtrade.ai"): Response {
  return new Response(JSON.stringify({ domain, hostname: "mt-client-api-v1" }), { status: 200 });
}

function accountResponse(region = "new-york"): Response {
  return new Response(JSON.stringify({ region }), { status: 200 });
}

// ---------------------------------------------------------------------------
// toMetaApiSymbol
// ---------------------------------------------------------------------------

describe("toMetaApiSymbol", () => {
  beforeEach(() => {
    delete process.env.METAAPI_SYMBOL_SUFFIX;
  });

  test("maps EUR/USD correctly", () => {
    expect(ohlc.toMetaApiSymbol("OANDA:EURUSD")).toBe("EURUSD");
  });

  test("maps GBP/USD correctly", () => {
    expect(ohlc.toMetaApiSymbol("OANDA:GBPUSD")).toBe("GBPUSD");
  });

  test("maps XAU/USD correctly", () => {
    expect(ohlc.toMetaApiSymbol("OANDA:XAUUSD")).toBe("XAUUSD");
  });

  test("maps XAG/USD correctly", () => {
    expect(ohlc.toMetaApiSymbol("OANDA:XAGUSD")).toBe("XAGUSD");
  });

  test("maps USD/JPY correctly", () => {
    expect(ohlc.toMetaApiSymbol("OANDA:USDJPY")).toBe("USDJPY");
  });

  test("applies METAAPI_SYMBOL_SUFFIX when set", () => {
    process.env.METAAPI_SYMBOL_SUFFIX = "m";
    expect(ohlc.toMetaApiSymbol("OANDA:EURUSD")).toBe("EURUSDm");
  });

  test("returns null for non-OANDA prefix", () => {
    expect(ohlc.toMetaApiSymbol("TVC:EURUSD")).toBeNull();
  });

  test("returns null for short instrument", () => {
    expect(ohlc.toMetaApiSymbol("OANDA:ABC")).toBeNull();
  });

  test("returns null for empty instrument", () => {
    expect(ohlc.toMetaApiSymbol("OANDA:")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchOhlcHistory
// ---------------------------------------------------------------------------

describe("fetchOhlcHistory", () => {
  beforeEach(() => {
    delete process.env.METAAPI_TOKEN;
    delete process.env.METAAPI_ACCOUNT_ID;
    delete process.env.METAAPI_REGION;
    delete process.env.METAAPI_MARKET_DATA_BASE_URL;
    delete process.env.METAAPI_SYMBOL_SUFFIX;
    ohlc.clearOhlcCache();
    ohlc.clearRegionCache();
    resetRateLimitStateForTests();
    vi.restoreAllMocks();
  });

  test("returns Error when env vars are missing", async () => {
    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("METAAPI_TOKEN");
  });

  test("returns Error when symbol cannot be mapped", async () => {
    process.env.METAAPI_TOKEN = "dummy";
    process.env.METAAPI_ACCOUNT_ID = "dummy";
    const result = await ohlc.fetchOhlcHistory("OANDA:XYZ", "H4", 100);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("Symbol");
  });

  test("returns Error when candles API response is not ok", async () => {
    process.env.METAAPI_TOKEN = "dummy";
    process.env.METAAPI_ACCOUNT_ID = "dummy";
    process.env.METAAPI_REGION = "new-york"; // skip account region lookup

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("servers/mt-client-api")) return domainResponse();
      return new Response(null, { status: 401, statusText: "Unauthorized" });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("401");
    mockFetch.mockRestore();
  });

  test("returns Error when domain discovery fails", async () => {
    process.env.METAAPI_TOKEN = "dummy";
    process.env.METAAPI_ACCOUNT_ID = "dummy";

    const mockFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("404");
    mockFetch.mockRestore();
  });

  test("returns Error when account region lookup fails", async () => {
    process.env.METAAPI_TOKEN = "dummy";
    process.env.METAAPI_ACCOUNT_ID = "dummy";

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("servers/mt-client-api")) return domainResponse();
      return new Response(null, { status: 403, statusText: "Forbidden" });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("403");
    mockFetch.mockRestore();
  });

  test("parses valid MetaApi response and returns sorted Candle[]", async () => {
    process.env.METAAPI_TOKEN = "dummy";
    process.env.METAAPI_ACCOUNT_ID = "dummy";
    process.env.METAAPI_REGION = "new-york";

    const metaApiResponse = [
      {
        time: "2024-01-02T00:00:00.000Z",
        open: 1.1,
        high: 1.101,
        low: 1.099,
        close: 1.1005,
        volume: 120,
        tickVolume: 300,
      },
      {
        time: "2024-01-01T00:00:00.000Z",
        open: 1.099,
        high: 1.0998,
        low: 1.0985,
        close: 1.0995,
        volume: 85,
        tickVolume: 210,
      },
    ];

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("servers/mt-client-api")) return domainResponse();
      return new Response(JSON.stringify(metaApiResponse), { status: 200 });
    });

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

  test("skips incomplete MetaApi candles where complete is false", async () => {
    process.env.METAAPI_TOKEN = "dummy";
    process.env.METAAPI_ACCOUNT_ID = "dummy";
    process.env.METAAPI_REGION = "new-york";

    const metaApiResponse = [
      {
        time: "2024-01-02T00:00:00.000Z",
        complete: false,
        open: 1.2,
        high: 1.21,
        low: 1.19,
        close: 1.205,
        volume: 99,
      },
      {
        time: "2024-01-01T00:00:00.000Z",
        complete: true,
        open: 1.1,
        high: 1.11,
        low: 1.09,
        close: 1.105,
        volume: 88,
      },
    ];

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("servers/mt-client-api")) return domainResponse();
      return new Response(JSON.stringify(metaApiResponse), { status: 200 });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).not.toBeInstanceOf(Error);
    const candles = result as Candle[];
    expect(candles).toHaveLength(1);
    expect(candles[0].time).toBe(Date.parse("2024-01-01T00:00:00.000Z"));
    expect(candles[0].open).toBe(1.1);

    mockFetch.mockRestore();
  });

  test("falls back to tickVolume when volume is missing", async () => {
    process.env.METAAPI_TOKEN = "dummy";
    process.env.METAAPI_ACCOUNT_ID = "dummy";
    process.env.METAAPI_REGION = "new-york";

    const metaApiResponse = [
      {
        time: "2024-01-01T00:00:00.000Z",
        open: 1.1,
        high: 1.11,
        low: 1.09,
        close: 1.105,
        tickVolume: 42,
      },
    ];

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("servers/mt-client-api")) return domainResponse();
      return new Response(JSON.stringify(metaApiResponse), { status: 200 });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "M15", 100);
    expect(result).not.toBeInstanceOf(Error);
    const candles = result as Candle[];
    expect(candles).toHaveLength(1);
    expect(candles[0].volume).toBe(42);

    mockFetch.mockRestore();
  });

  test("returns cached data within TTL and re-fetches after TTL expires", async () => {
    process.env.METAAPI_TOKEN = "dummy";
    process.env.METAAPI_ACCOUNT_ID = "dummy";
    process.env.METAAPI_REGION = "new-york";

    let callCount = 0;

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("servers/mt-client-api")) return domainResponse();
      callCount++;
      const o = 1.1 + callCount * 0.001;
      const body = [
        {
          time: "2024-01-01T00:00:00.000Z",
          open: o,
          high: o + 0.01,
          low: o - 0.01,
          close: o + 0.005,
          volume: 100,
        },
      ];
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

  test("passes correct URL and auth-token header (METAAPI_MARKET_DATA_BASE_URL override)", async () => {
    process.env.METAAPI_TOKEN = "test-token-123";
    process.env.METAAPI_ACCOUNT_ID = "test-account";
    process.env.METAAPI_MARKET_DATA_BASE_URL = "https://mt-market-data.example.com";

    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      capturedUrl = String(url);
      capturedHeaders = (opts?.headers as Record<string, string>) || {};
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:XAUUSD", "D1", 50);
    expect(result).not.toBeInstanceOf(Error);

    // Override skips domain/region discovery entirely
    expect(capturedUrl).toContain(
      "https://mt-market-data.example.com/users/current/accounts/test-account/historical-market-data/symbols/XAUUSD/timeframes/1d/candles",
    );
    expect(capturedUrl).toContain("limit=50");
    expect(capturedHeaders["auth-token"]).toBe("test-token-123");

    mockFetch.mockRestore();
  });

  test("discovers domain and region via provisioning API when not overridden", async () => {
    process.env.METAAPI_TOKEN = "test-token-123";
    process.env.METAAPI_ACCOUNT_ID = "test-account";

    const requestedUrls: string[] = [];

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      requestedUrls.push(urlStr);
      if (urlStr.includes("servers/mt-client-api")) return domainResponse("agiliumtrade.ai");
      if (urlStr.includes("/accounts/test-account") && !urlStr.includes("historical-market-data")) {
        return accountResponse("london");
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).not.toBeInstanceOf(Error);
    expect(requestedUrls.some((u) => u.includes("mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/servers/mt-client-api"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/test-account"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("mt-market-data-client-api-v1.london.agiliumtrade.ai"))).toBe(true);

    mockFetch.mockRestore();
  });

  test("uses METAAPI_REGION to skip account lookup but still discovers domain", async () => {
    process.env.METAAPI_TOKEN = "test-token-123";
    process.env.METAAPI_ACCOUNT_ID = "test-account";
    process.env.METAAPI_REGION = "singapore";

    const requestedUrls: string[] = [];

    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      requestedUrls.push(urlStr);
      if (urlStr.includes("servers/mt-client-api")) return domainResponse("agiliumtrade.ai");
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).not.toBeInstanceOf(Error);
    expect(requestedUrls.some((u) => u.includes("/accounts/test-account") && !u.includes("historical-market-data"))).toBe(false);
    expect(requestedUrls.some((u) => u.includes("mt-market-data-client-api-v1.singapore.agiliumtrade.ai"))).toBe(true);

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// toTwelveDataSymbol
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// fetchOhlcHistory — Twelve Data path
// ---------------------------------------------------------------------------

describe("fetchOhlcHistory (Twelve Data)", () => {
  beforeEach(() => {
    delete process.env.METAAPI_TOKEN;
    delete process.env.METAAPI_ACCOUNT_ID;
    delete process.env.TWELVEDATA_API_KEY;
    ohlc.clearOhlcCache();
    ohlc.clearRegionCache();
    resetRateLimitStateForTests();
    vi.restoreAllMocks();
  });

  test("uses Twelve Data instead of MetaApi when TWELVEDATA_API_KEY is set", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const tdResponse = {
      status: "ok",
      values: [
        { datetime: "2024-01-02 00:00:00", open: "1.101", high: "1.102", low: "1.100", close: "1.1015", volume: "500" },
        { datetime: "2024-01-01 00:00:00", open: "1.099", high: "1.100", low: "1.098", close: "1.0995", volume: "400" },
      ],
    };

    let capturedUrl = "";
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
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

    mockFetch.mockRestore();
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
    let capturedUrl = "";
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(tdResponse), { status: 200 });
    });

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).not.toBeInstanceOf(Error);
    const candles = result as Candle[];

    expect(capturedUrl).toContain("timezone=UTC");
    expect(candles).toHaveLength(1);
    expect(candles[0].time).toBe(Date.parse("2024-01-01T08:00:00Z"));

    mockFetch.mockRestore();
    nowSpy.mockRestore();
  });

  test("switches cache entries when provider changes", async () => {
    process.env.METAAPI_TOKEN = "dummy";
    process.env.METAAPI_ACCOUNT_ID = "dummy";
    process.env.METAAPI_REGION = "new-york";

    const metaApiResponse = [
      {
        time: "2024-01-01T00:00:00.000Z",
        open: 1.1,
        high: 1.11,
        low: 1.09,
        close: 1.105,
        volume: 85,
      },
    ];
    const tdResponse = {
      status: "ok",
      values: [
        { datetime: "2024-01-01 12:00:00", open: "2.200", high: "2.210", low: "2.190", close: "2.205", volume: "500" },
      ],
    };

    const requestedUrls: string[] = [];
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      requestedUrls.push(urlStr);
      if (urlStr.includes("servers/mt-client-api")) return domainResponse();
      if (urlStr.includes("api.twelvedata.com")) {
        return new Response(JSON.stringify(tdResponse), { status: 200 });
      }
      return new Response(JSON.stringify(metaApiResponse), { status: 200 });
    });

    const metaResult = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(metaResult).not.toBeInstanceOf(Error);
    expect((metaResult as Candle[])[0].open).toBe(1.1);

    process.env.TWELVEDATA_API_KEY = "td-key";
    const tdResult = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(tdResult).not.toBeInstanceOf(Error);
    expect((tdResult as Candle[])[0].open).toBe(2.2);
    expect(requestedUrls.some((url) => url.includes("api.twelvedata.com/time_series"))).toBe(true);

    mockFetch.mockRestore();
  });

  test("returns Error when Twelve Data responds with status error", async () => {
    process.env.TWELVEDATA_API_KEY = "td-key";

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "error", message: "invalid symbol" }), { status: 200 }),
    );

    const result = await ohlc.fetchOhlcHistory("OANDA:EURUSD", "H4", 100);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("invalid symbol");

    mockFetch.mockRestore();
  });
});
