import { beforeEach, describe, expect, test, vi } from "vitest";

const candleRangeStats = await import("../../src/charts/candle-range-stats.js");

describe("charts/candle-range-stats", () => {
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
      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", nowSec * 1000);

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

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 500_000);

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

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 999_999);

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

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 1_000);

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

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 1_000);

      expect(result).toBeNull();
    });

    test("symbol không trong FALLBACK_SYMBOLS — trả null", async () => {
      const result = await candleRangeStats.fetchCandleRangeStats("UNKNOWN:PAIR", 1_000);
      expect(result).toBeNull();
    });

    test("fetch trả lỗi — trả null", async () => {
      const fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
      vi.stubGlobal("fetch", fetch);

      const result = await candleRangeStats.fetchCandleRangeStats("OANDA:EURUSD", 1_000);
      expect(result).toBeNull();
    });
  });
});
