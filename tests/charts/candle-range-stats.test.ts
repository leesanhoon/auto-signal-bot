import { beforeEach, describe, expect, test, vi } from "vitest";

const candleRangeStats = await import("../../src/charts/candle-range-stats.js");

describe("charts/candle-range-stats", () => {
  describe("fetchCandleRangeStats — Yahoo Finance fallback (forex/gold)", () => {
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
      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", nowSec * 1000);

      if (result instanceof Error) throw result;
      expect(result.high).toBe(101);  // max(100, 101), KHÔNG phải 999
      expect(result.low).toBe(98);    // min(98, 99), KHÔNG phải 0
      expect(result.lastClose).toBe(100); // close cuối cùng
    });

    test("toàn bộ nến đều cũ hơn sinceMs — trả lỗi", async () => {
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

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 500_000);

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("EURUSD=X");
    });

    test("timestamps rỗng — trả lỗi (không thể lọc theo sinceMs)", async () => {
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

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 999_999);

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("timestamp");
    });

    test("thiếu field timestamp trong response — trả lỗi", async () => {
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

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 1_000);

      expect(result).toBeInstanceOf(Error);
    });

    test("timestamps không khớp độ dài highs — trả lỗi", async () => {
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

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 1_000);

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("khong khop do dai");
    });

    test("symbol không trong FALLBACK_SYMBOLS — trả lỗi", async () => {
      const result = await candleRangeStats.fetchCandleRangeStats("UNKNOWN:PAIR", 1_000);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("UNKNOWN:PAIR");
    });

    test("fetch trả lỗi HTTP — trả lỗi kèm status", async () => {
      const fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
      vi.stubGlobal("fetch", fetch);

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 1_000);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("429");
    });
  });

  describe("fetchCandleRangeStats — Binance (crypto)", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    test("thành công — trả về high/low/lastClose", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          [1000, "1.0", "1.30", "0.90", "1.10", "10", 1899, "0", 0, "0", "0", "0"],
          [2000, "1.10", "1.25", "1.00", "1.20", "10", 2899, "0", 0, "0", "0", "0"],
        ],
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await candleRangeStats.fetchCandleRangeStats("BINANCE:FLOWUSDT", 1000);

      if (result instanceof Error) throw result;
      expect(result.high).toBe(1.3);
      expect(result.low).toBe(0.9);
      expect(result.lastClose).toBe(1.2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("klines rỗng — trả lỗi", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
      vi.stubGlobal("fetch", fetchMock);

      const result = await candleRangeStats.fetchCandleRangeStats("BINANCE:FLOWUSDT", 1000);

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("FLOWUSDT");
    });

    test("lỗi tạm thời (500) rồi thành công — retry đúng cách", async () => {
      vi.useFakeTimers();
      try {
        let callCount = 0;
        const fetchMock = vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              ok: false,
              status: 500,
              clone: () => ({ json: async () => ({}) }),
            };
          }
          return {
            ok: true,
            json: async () => [
              [1000, "1.0", "1.20", "0.90", "1.10", "10", 1899, "0", 0, "0", "0", "0"],
            ],
          };
        });
        vi.stubGlobal("fetch", fetchMock);

        const promise = candleRangeStats.fetchCandleRangeStats("BINANCE:FLOWUSDT", 1000);
        await vi.advanceTimersByTimeAsync(1000);
        const result = await promise;

        if (result instanceof Error) throw result;
        expect(result.high).toBe(1.2);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    test("429 — không retry, trả lỗi kèm status và message thật từ Binance", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        clone: () => ({ json: async () => ({ msg: "Way too many requests" }) }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await candleRangeStats.fetchCandleRangeStats("BINANCE:FLOWUSDT", 1000);

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("429");
      expect((result as Error).message).toContain("Way too many requests");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("418 — không retry (ban)", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 418,
        clone: () => ({ json: async () => ({}) }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await candleRangeStats.fetchCandleRangeStats("BINANCE:FLOWUSDT", 1000);

      expect(result).toBeInstanceOf(Error);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
