import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  launch: vi.fn(),
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: state.launch,
  },
}));

const screenshot = await import("../../src/charts/screenshot.js");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("charts/screenshot", () => {
  beforeEach(() => {
    state.launch.mockReset();
  });

  test("captureChartScreenshot waits for screenshot promise before closing the page", async () => {
    const screenshotResult = deferred<Buffer>();
    const close = vi.fn(async () => undefined);
    const screenshotMock = vi.fn(() => screenshotResult.promise);
    const waitForTimeout = vi.fn(async () => undefined);
    const waitForSelector = vi.fn(async () => ({
      contentFrame: async () => ({
        waitForSelector: async () => undefined,
        locator: () => ({
          innerText: async () => "1m\n30m\n1h\n4h\nIndicators\nC\n1.14525",
        }),
      }),
    }));

    state.launch.mockResolvedValue({
      newContext: async () => ({
        newPage: async () => ({
          setContent: async () => undefined,
          waitForSelector,
          waitForTimeout,
          screenshot: screenshotMock,
          close,
        }),
      }),
      close: async () => undefined,
    });

    const promise = screenshot.captureChartScreenshot({
      symbol: "OANDA:EURUSD",
      name: "EUR/USD H4",
      interval: "240",
      description: "EUR/USD — H4",
      timeframe: "H4",
    });

    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();

    screenshotResult.resolve(Buffer.from("image"));
    const result = await promise;

    expect(close).toHaveBeenCalledTimes(1);
    expect(screenshotMock).toHaveBeenCalledTimes(1);
    expect(result.lastPrice).toBe(1.14525);
    expect(result.buffer).toEqual(Buffer.from("image"));
  });

  describe("fetchCandleRangeStats", () => {
    const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/EURUSD%3DX?interval=2m&range=1d";

    function makePayload(
      timestamps: number[],
      highs: (number | null)[],
      lows: (number | null)[],
      closes: (number | null)[],
    ) {
      return {
        chart: {
          result: [{
            timestamp: timestamps,
            indicators: {
              quote: [{ high: highs, low: lows, close: closes }],
            },
          }],
        },
      };
    }

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    test("lọc high/low theo sinceMs — bỏ nến cũ, chỉ tính nến sau mốc", async () => {
      // Nến cũ (timestamp < sinceMs) có high=999, low=0 — KHÔNG được tính
      // Nến mới (timestamp >= sinceMs) có high=100, low=98
      const nowSec = 1_000_000_000;
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          makePayload(
            [nowSec - 7200, nowSec - 3600, nowSec, nowSec + 3600], // timestamps (epoch-seconds)
            [999, 150, 100, 101],        // highs
            [0, 97, 98, 99],             // lows
            [50, 97, 99, 100],           // closes
          ),
      });
      vi.stubGlobal("fetch", fetch);

      // sinceMs = nowSec * 1000 (epoch-ms) → sinceSec = nowSec
      const result = await screenshot.fetchCandleRangeStats("OANDA:EURUSD", nowSec * 1000);

      expect(result).not.toBeNull();
      expect(result!.high).toBe(101);  // max(100, 101), KHÔNG phải 999
      expect(result!.low).toBe(98);    // min(98, 99), KHÔNG phải 0
      expect(result!.lastClose).toBe(100); // close cuối cùng
    });

    test("toàn bộ nến đều cũ hơn sinceMs — trả null", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          makePayload(
            [100, 200, 300],  // tất cả đều < 500
            [1.1, 1.2, 1.3],
            [1.0, 1.1, 1.2],
            [1.05, 1.15, 1.25],
          ),
      });
      vi.stubGlobal("fetch", fetch);

      const result = await screenshot.fetchCandleRangeStats("OANDA:EURUSD", 500_000);

      expect(result).toBeNull();
    });

    test("timestamps rỗng — trả null (không thể lọc theo sinceMs)", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          makePayload([], // timestamps rỗng → không đủ dữ liệu để lọc
            [1.15, 1.10],
            [1.05, 1.08],
            [1.12, 1.09],
          ),
      });
      vi.stubGlobal("fetch", fetch);

      const result = await screenshot.fetchCandleRangeStats("OANDA:EURUSD", 999_999);

      expect(result).toBeNull();
    });

    test("thiếu field timestamp trong response — trả null", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: {
            result: [{
              // timestamp key hoàn toàn không có
              indicators: {
                quote: [{ high: [1.15, 1.10], low: [1.05, 1.08], close: [1.12, 1.09] }],
              },
            }],
          },
        }),
      });
      vi.stubGlobal("fetch", fetch);

      const result = await screenshot.fetchCandleRangeStats("OANDA:EURUSD", 1_000);

      expect(result).toBeNull();
    });

    test("timestamps không khớp độ dài highs — trả null", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: {
            result: [{
              timestamp: [1, 2, 3],   // 3 phần tử
              indicators: {
                quote: [{ high: [1.1, 1.2], low: [1.0, 1.1], close: [1.05, 1.15] }], // 2 phần tử
              },
            }],
          },
        }),
      });
      vi.stubGlobal("fetch", fetch);

      const result = await screenshot.fetchCandleRangeStats("OANDA:EURUSD", 1_000);

      expect(result).toBeNull();
    });

    test("symbol không trong FALLBACK_SYMBOLS — trả null", async () => {
      const result = await screenshot.fetchCandleRangeStats("UNKNOWN:PAIR", 1_000);
      expect(result).toBeNull();
    });

    test("fetch trả lỗi — trả null", async () => {
      const fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
      vi.stubGlobal("fetch", fetch);

      const result = await screenshot.fetchCandleRangeStats("OANDA:EURUSD", 1_000);
      expect(result).toBeNull();
    });
  });
});
