# OHLC Fallback Retry & Error Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Binance OHLC fallback path used to check SL/TP for positions/pending orders without a `binanceSymbol` resilient to transient failures (retry + shared rate limit) and surface the real error reason in Telegram warnings instead of a generic message.

**Architecture:** `fetchCandleRangeStats()` (src/charts/candle-range-stats.ts) changes its return type from `CandleRangeStats | null` to `CandleRangeStats | Error`, matching the `T | Error` convention already used by `fetchOhlcHistory`/`fetchLastPrice` in this codebase. Its Binance branch gains retry (`withRetry`) and rate limiting (`withConfiguredRateLimit`, sharing the same `"binance"` bucket as `ohlc-provider.ts`). Its two callers (`check-open-trades-runner-volman.ts`, `check-pending-orders-runner-volman.ts`) switch from `=== null` checks to `instanceof Error` checks and append the error message to their Telegram warnings.

**Tech Stack:** TypeScript, Vitest, existing `src/shared/retry.ts` (`withRetry`) and `src/shared/rate-limit.ts` (`withConfiguredRateLimit`) utilities.

## Global Constraints

- Retry: `maxAttempts: 3`, `baseDelayMs: 1000` (exponential backoff), applied only to the Binance branch of `fetchCandleRangeStats`.
- Retry skip list: do not retry on HTTP `418` (ban), `429` (rate limit), or `400` (bad request) — same policy as `fetchFromBinance` in `src/charts/ohlc-provider.ts`.
- Rate limit: `key: "binance"`, `envVar: "BINANCE_RATE_LIMIT_RPM"`, `defaultRpm: 300` — must reuse the same limiter bucket as `ohlc-provider.ts` (same `key` string), not a separate one.
- The Yahoo Finance (forex/gold) branch of `fetchCandleRangeStats` gets NO retry/rate-limit changes — only its `return null` points become `return new Error(...)` for type consistency.
- Every Telegram warning sent when the OHLC fetch fails must include the underlying `Error.message` text.
- `resolveOpenPositionDecision` / `resolvePendingOrderDecision` (src/charts/position-decision-volman.ts) keep their existing signature (`CandleRangeStats | null` + optional `reason`) — do not modify that file.
- Do not touch `reconcileBinancePosition` or the `binanceSymbol`-based branch selection — out of scope (decided in the design brainstorm).

---

### Task 1: Harden `fetchCandleRangeStats` — Error return type + Binance retry/rate-limit/error detail

**Files:**
- Modify: `src/charts/candle-range-stats.ts`
- Test: `tests/charts/candle-range-stats.test.ts`

**Interfaces:**
- Produces: `fetchCandleRangeStats(symbol: string, sinceMs: number): Promise<CandleRangeStats | Error>` (return type changes from `CandleRangeStats | null`; callers in Task 2 and Task 3 depend on this).

- [ ] **Step 1: Replace the test file with the updated expectations (RED)**

Replace the full contents of `tests/charts/candle-range-stats.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/charts/candle-range-stats.test.ts`
Expected: FAIL — existing assertions like `toBeNull()` mismatched against current `null` returns still pass by coincidence in some cases, but the new Binance describe block fails because `fetchBinanceCandleRangeStats` today swallows errors as `null` (e.g. the 429/418 "không retry" tests will see `fetchMock` called once and `result` be `null`, so `toBeInstanceOf(Error)` fails), and the retry test fails because there is no retry (only 1 call, second mock response never consumed).

- [ ] **Step 3: Implement the changes**

In `src/charts/candle-range-stats.ts`, add two imports after the existing `toBinanceSymbol` import (after line 3):

```ts
import { withRetry } from "../shared/retry.js";
import { withConfiguredRateLimit } from "../shared/rate-limit.js";
```

Replace the entire block from `const BINANCE_KLINES_URL = ...` through the end of `fetchBinanceCandleRangeStats` (originally lines 79–111) with:

```ts
const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";
const BINANCE_RATE_LIMIT_CONFIG = {
  key: "binance",
  envVar: "BINANCE_RATE_LIMIT_RPM",
  defaultRpm: 300,
} as const;

async function fetchBinanceKlinesForRangeStats(bnSymbol: string, sinceMs: number): Promise<unknown> {
  const url = `${BINANCE_KLINES_URL}?symbol=${encodeURIComponent(bnSymbol)}&interval=15m&startTime=${sinceMs}&limit=1000`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) {
    let apiMessage: string | undefined;
    try {
      apiMessage = ((await response.clone().json()) as { msg?: string })?.msg;
    } catch {
      // ignore — Binance error body isn't always JSON
    }
    const error = new Error(
      `Binance API tra ve ${response.status} cho ${bnSymbol}${apiMessage ? `: ${apiMessage}` : ""}`,
    );
    (error as any).status = response.status;
    throw error;
  }
  return response.json();
}

async function fetchBinanceCandleRangeStats(bnSymbol: string, sinceMs: number): Promise<CandleRangeStats | Error> {
  let body: unknown;
  try {
    body = await withConfiguredRateLimit(BINANCE_RATE_LIMIT_CONFIG, () =>
      withRetry(() => fetchBinanceKlinesForRangeStats(bnSymbol, sinceMs), {
        maxAttempts: 3,
        baseDelayMs: 1000,
        isRetryable: (error) => {
          const status = (error as { status?: number }).status;
          // 418/429 = ban/rate-limit; retrying immediately makes bans worse.
          // 400 = bad request; retrying won't change the outcome.
          return status !== 418 && status !== 429 && status !== 400;
        },
        onRetry: (error, attempt, maxAttempts, delayMs) => {
          logger.warn(
            `Binance candle range stats retry ${attempt}/${maxAttempts} sau ${delayMs}ms cho ${bnSymbol}: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      }),
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn("Failed to fetch Binance candle range stats", { symbol: bnSymbol, error: err });
    return err;
  }

  if (!Array.isArray(body) || body.length === 0) {
    return new Error(`Binance khong tra ve klines cho ${bnSymbol}`);
  }

  let high = -Infinity;
  let low = Infinity;
  let lastClose: number | null = null;
  for (const row of body) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const h = Number(row[2]);
    const l = Number(row[3]);
    const c = Number(row[4]);
    if (Number.isFinite(h)) high = Math.max(high, h);
    if (Number.isFinite(l)) low = Math.min(low, l);
    if (Number.isFinite(c)) lastClose = c;
  }

  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return new Error(`Khong parse duoc high/low tu klines Binance cho ${bnSymbol}`);
  }

  return { high, low, lastClose };
}
```

Replace the exported `fetchCandleRangeStats` function (originally lines 113–204) with:

```ts
export async function fetchCandleRangeStats(symbol: string, sinceMs: number): Promise<CandleRangeStats | Error> {
  const bnSymbol = toBinanceSymbol(symbol);
  if (bnSymbol) {
    return fetchBinanceCandleRangeStats(bnSymbol, sinceMs);
  }

  const fallbackSymbol = FALLBACK_SYMBOLS[symbol];
  if (!fallbackSymbol) {
    return new Error(`Khong co Binance hoac Yahoo fallback symbol cho ${symbol}`);
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(fallbackSymbol)}?interval=2m&range=1d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    return new Error(`Yahoo Finance API tra ve ${response.status} cho ${fallbackSymbol}`);
  }

  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!quote) {
    return new Error(`Yahoo Finance response thieu quote cho ${fallbackSymbol}`);
  }

  const timestamps = result?.timestamp ?? [];
  const highs = quote.high ?? [];
  const lows = quote.low ?? [];
  const closes = quote.close ?? [];

  // Yahoo Finance trả timestamp ở đơn vị epoch-seconds
  // Chuyển sinceMs về seconds để so sánh
  const sinceSec = Math.floor(sinceMs / 1000);

  // Nếu không có timestamp, không thể lọc theo sinceMs — trả lỗi để fallback về AI vision
  if (timestamps.length === 0) {
    return new Error(`Yahoo Finance response thieu timestamp cho ${fallbackSymbol}`);
  }

  // Nếu timestamps không khớp độ dài với highs/lows → dữ liệu không nhất quán, trả lỗi
  if (timestamps.length !== highs.length) {
    return new Error(`Yahoo Finance timestamps/highs khong khop do dai cho ${fallbackSymbol}`);
  }

  // Lọc chỉ giữ các nến có timestamp >= sinceMs
  const filteredHighs: number[] = [];
  const filteredLows: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (timestamps[i] < sinceSec) {
      continue;
    }
    const h = highs[i];
    const l = lows[i];
    if (typeof h === "number" && Number.isFinite(h)) {
      filteredHighs.push(h);
    }
    if (typeof l === "number" && Number.isFinite(l)) {
      filteredLows.push(l);
    }
  }

  if (filteredHighs.length === 0 || filteredLows.length === 0) {
    return new Error(`Khong co nen nao sau sinceMs cho ${fallbackSymbol}`);
  }

  const high = Math.max(...filteredHighs);
  const low = Math.min(...filteredLows);

  // lastClose lấy từ toàn bộ mảng gốc (giá đóng cửa gần nhất luôn có nghĩa)
  const lastClose = [...closes].reverse().find((value) => typeof value === "number" && Number.isFinite(value));

  return {
    high,
    low,
    lastClose: typeof lastClose === "number" ? lastClose : null,
  };
}
```

Leave `getTimeframeRank`, `findChartForPair`, `FALLBACK_SYMBOLS`, and `fetchFallbackLastPrice` untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/charts/candle-range-stats.test.ts`
Expected: PASS (all tests in both describe blocks green)

- [ ] **Step 5: Run the TypeScript build to catch downstream type errors**

Run: `npm run build`
Expected: FAILS at this point — `src/charts/check-open-trades-runner-volman.ts` and `src/charts/check-pending-orders-runner-volman.ts` still compare `stats === null` against the new `CandleRangeStats | Error` type. This is expected; Task 2 and Task 3 fix it. Confirm the only errors reported are in those two files (no errors in `candle-range-stats.ts` itself).

- [ ] **Step 6: Commit**

```bash
git add src/charts/candle-range-stats.ts tests/charts/candle-range-stats.test.ts
git commit -m "feat: add retry, rate limit, and error detail to Binance OHLC range stats fetch"
```

---

### Task 2: Update `check-open-trades-runner-volman.ts` to handle `Error` and report the real reason

**Files:**
- Modify: `src/charts/check-open-trades-runner-volman.ts:36-42`
- Test: `tests/charts/check-open-trades-runner-volman.test.ts`

**Interfaces:**
- Consumes: `fetchCandleRangeStats(symbol, sinceMs): Promise<CandleRangeStats | Error>` (from Task 1).

- [ ] **Step 1: Add a failing test for the OHLC-fetch-failure path**

In `tests/charts/check-open-trades-runner-volman.test.ts`, add this test inside the existing `describe("check-open-trades-runner-volman", ...)` block, after the `"persists and announces a stop-loss close"` test:

```ts
  test("khi fetchCandleRangeStats trả về Error, gửi cảnh báo kèm lý do lỗi và giữ vị thế", async () => {
    candles.fetchCandleRangeStats.mockResolvedValue(
      new Error("Binance API tra ve 429 cho FLOWUSDT: Way too many requests"),
    );
    decisions.resolveOpenPositionDecision.mockReturnValue({
      decision: "HOLD",
      confidence: 50,
      comment: "Chưa lấy được OHLC để kiểm tra SL/TP, giữ vị thế.",
      managementAction: "NONE",
    });
    repository.buildPositionManagementPatch.mockReturnValue({
      patch: null,
      closePosition: false,
    });

    const sentNotification = await processPosition(position as any);

    expect(decisions.resolveOpenPositionDecision).toHaveBeenCalledWith(
      position,
      null,
      undefined,
      null,
    );
    expect(telegramClient.sendMessage).toHaveBeenCalledTimes(1);
    const message = telegramClient.sendMessage.mock.calls[0][0] as string;
    expect(message).toContain("Không lấy được OHLC");
    expect(message).toContain("Way too many requests");
    expect(sentNotification).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/charts/check-open-trades-runner-volman.test.ts`
Expected: FAIL — current code checks `stats === null`, so an `Error` object is treated as truthy "valid stats" and passed straight into `resolveOpenPositionDecision`; no `sendMessage` call happens, so `expect(telegramClient.sendMessage).toHaveBeenCalledTimes(1)` fails.

- [ ] **Step 3: Update the source**

In `src/charts/check-open-trades-runner-volman.ts`, replace lines 36–42:

```ts
  const stats = await fetchCandleRangeStats(chart.symbol, new Date(position.openedAt).getTime());
  if (stats === null) {
    logger.warn("Failed to fetch OHLC for open position; sending explicit warning", { pair: position.pair, id: position.id });
    await sendMessage(
      `⚠️ *Check Open Trades*\n\nKhông lấy được OHLC để kiểm tra vị thế #${position.id} ${position.pair}.\nBot tạm giữ vị thế nhưng không thể xác minh SL/TP trong lượt này. Vui lòng kiểm tra dữ liệu thị trường / nguồn chart.`,
    );
  }
```

with:

```ts
  const statsResult = await fetchCandleRangeStats(chart.symbol, new Date(position.openedAt).getTime());
  const stats = statsResult instanceof Error ? null : statsResult;
  if (statsResult instanceof Error) {
    logger.warn("Failed to fetch OHLC for open position; sending explicit warning", { pair: position.pair, id: position.id, error: statsResult });
    await sendMessage(
      `⚠️ *Check Open Trades*\n\nKhông lấy được OHLC để kiểm tra vị thế #${position.id} ${position.pair}.\nBot tạm giữ vị thế nhưng không thể xác minh SL/TP trong lượt này. Vui lòng kiểm tra dữ liệu thị trường / nguồn chart.\nLỗi: ${statsResult.message}`,
    );
  }
```

The rest of `evaluateOpenPosition` (the `emaContext` block and the final `return resolveOpenPositionDecision(position, stats, undefined, emaContext);`) stays unchanged — it already references the `stats` variable, which now correctly holds `CandleRangeStats | null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/charts/check-open-trades-runner-volman.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Commit**

```bash
git add src/charts/check-open-trades-runner-volman.ts tests/charts/check-open-trades-runner-volman.test.ts
git commit -m "fix: surface real OHLC fetch error in check-open-trades Telegram warning"
```

---

### Task 3: Update `check-pending-orders-runner-volman.ts` to handle `Error` and report the real reason

**Files:**
- Modify: `src/charts/check-pending-orders-runner-volman.ts:41-59`
- Create: `tests/charts/check-pending-orders-runner-volman.test.ts`

**Interfaces:**
- Consumes: `fetchCandleRangeStats(symbol, sinceMs): Promise<CandleRangeStats | Error>` (from Task 1).
- Produces: exports `reviewPendingOrder(order: PendingOrder): Promise<{ status: "TRIGGERED" | "CANCELLED" | "PENDING"; confidence: number; comment: string }>` (was previously unexported/untested).

- [ ] **Step 1: Write the new test file (RED)**

Create `tests/charts/check-pending-orders-runner-volman.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const candles = vi.hoisted(() => ({
  fetchCandleRangeStats: vi.fn(),
  findChartForPair: vi.fn(),
}));
const telegramClient = vi.hoisted(() => ({ sendMessage: vi.fn() }));
const decisions = vi.hoisted(() => ({ resolvePendingOrderDecision: vi.fn() }));

vi.mock("../../src/charts/candle-range-stats.js", () => candles);
vi.mock("../../src/shared/telegram-client.js", () => telegramClient);
vi.mock("../../src/charts/volman-charts.config.js", () => ({
  getCharts: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/charts/position-decision-volman.js", () => decisions);

import { reviewPendingOrder } from "../../src/charts/check-pending-orders-runner-volman.js";

const order = {
  id: 5,
  pair: "FLOW/USDT",
  direction: "LONG" as const,
  setup: "RB",
  orderType: "BUY_STOP" as const,
  entry: "1.1000",
  stopLoss: "1.0900",
  takeProfit1: "1.1200",
  takeProfit2: null,
  confidence: 70,
  reasons: ["test"],
  risks: [],
  primaryTimeframe: "H1" as const,
  sourceChartFilepath: null,
  status: "pending" as const,
  runCount: 0,
  expiryRuns: 10,
  createdAt: "2026-07-01T00:00:00.000Z",
  resolvedAt: null,
  resolvedReason: null,
  triggeredPositionId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  candles.findChartForPair.mockReturnValue({ symbol: "BINANCE:FLOWUSDT" });
});

describe("check-pending-orders-runner-volman", () => {
  test("khi fetchCandleRangeStats trả về stats hợp lệ, dùng thẳng để đánh giá", async () => {
    const stats = { high: 1.12, low: 1.08, lastClose: 1.11 };
    candles.fetchCandleRangeStats.mockResolvedValue(stats);
    decisions.resolvePendingOrderDecision.mockReturnValue({
      status: "PENDING",
      confidence: 50,
      comment: "chưa chạm entry",
    });

    const result = await reviewPendingOrder(order as any);

    expect(decisions.resolvePendingOrderDecision).toHaveBeenCalledWith(order, stats);
    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(result.status).toBe("PENDING");
  });

  test("khi fetchCandleRangeStats trả về Error, gửi cảnh báo kèm lý do lỗi và coi như thiếu dữ liệu", async () => {
    candles.fetchCandleRangeStats.mockResolvedValue(
      new Error("Binance API tra ve 429 cho FLOWUSDT: Way too many requests"),
    );
    decisions.resolvePendingOrderDecision.mockReturnValue({
      status: "PENDING",
      confidence: 0,
      comment: "Chưa lấy được OHLC để kiểm tra lệnh chờ, giữ pending.",
    });

    await reviewPendingOrder(order as any);

    expect(decisions.resolvePendingOrderDecision).toHaveBeenCalledWith(order, null);
    expect(telegramClient.sendMessage).toHaveBeenCalledTimes(1);
    const message = telegramClient.sendMessage.mock.calls[0][0] as string;
    expect(message).toContain("Không lấy được OHLC");
    expect(message).toContain("Way too many requests");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/charts/check-pending-orders-runner-volman.test.ts`
Expected: FAIL — `reviewPendingOrder` is not exported yet, so the import in the test file fails to resolve (`undefined` is not callable), and the source still uses `stats === null` even after exporting, so the Error path wouldn't trigger the warning.

- [ ] **Step 3: Update the source**

In `src/charts/check-pending-orders-runner-volman.ts`, replace lines 41–59:

```ts
async function reviewPendingOrder(order: PendingOrder): Promise<{ status: "TRIGGERED" | "CANCELLED" | "PENDING"; confidence: number; comment: string }> {
  const chart = findChartForPair(await getCharts(), order.pair, order.primaryTimeframe ?? "H4");
  if (!chart) {
    logger.warn("No chart configuration found; sending explicit warning", { pair: order.pair, id: order.id });
    await sendMessage(
      `⚠️ *Check Pending Orders*\n\nKhông tìm thấy cấu hình chart cho lệnh chờ #${order.id} ${order.pair}.\nBot không thể xác minh trigger / invalidation trong lượt này. Vui lòng kiểm tra cấu hình chart / mapping pair.`,
    );
    return resolvePendingOrderDecision(order, null, "missing_chart_config");
  }

  const stats = await fetchCandleRangeStats(chart.symbol, new Date(order.createdAt).getTime());
  if (stats === null) {
    logger.warn("Failed to fetch OHLC for pending order; sending explicit warning", { pair: order.pair, id: order.id });
    await sendMessage(
      `⚠️ *Check Pending Orders*\n\nKhông lấy được OHLC để kiểm tra lệnh chờ #${order.id} ${order.pair}.\nBot tạm giữ lệnh chờ nhưng không thể xác minh trigger / invalidation trong lượt này. Vui lòng kiểm tra dữ liệu thị trường / nguồn chart.`,
    );
  }
  return resolvePendingOrderDecision(order, stats);
}
```

with:

```ts
export async function reviewPendingOrder(order: PendingOrder): Promise<{ status: "TRIGGERED" | "CANCELLED" | "PENDING"; confidence: number; comment: string }> {
  const chart = findChartForPair(await getCharts(), order.pair, order.primaryTimeframe ?? "H4");
  if (!chart) {
    logger.warn("No chart configuration found; sending explicit warning", { pair: order.pair, id: order.id });
    await sendMessage(
      `⚠️ *Check Pending Orders*\n\nKhông tìm thấy cấu hình chart cho lệnh chờ #${order.id} ${order.pair}.\nBot không thể xác minh trigger / invalidation trong lượt này. Vui lòng kiểm tra cấu hình chart / mapping pair.`,
    );
    return resolvePendingOrderDecision(order, null, "missing_chart_config");
  }

  const statsResult = await fetchCandleRangeStats(chart.symbol, new Date(order.createdAt).getTime());
  const stats = statsResult instanceof Error ? null : statsResult;
  if (statsResult instanceof Error) {
    logger.warn("Failed to fetch OHLC for pending order; sending explicit warning", { pair: order.pair, id: order.id, error: statsResult });
    await sendMessage(
      `⚠️ *Check Pending Orders*\n\nKhông lấy được OHLC để kiểm tra lệnh chờ #${order.id} ${order.pair}.\nBot tạm giữ lệnh chờ nhưng không thể xác minh trigger / invalidation trong lượt này. Vui lòng kiểm tra dữ liệu thị trường / nguồn chart.\nLỗi: ${statsResult.message}`,
    );
  }
  return resolvePendingOrderDecision(order, stats);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/charts/check-pending-orders-runner-volman.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/charts/check-pending-orders-runner-volman.ts tests/charts/check-pending-orders-runner-volman.test.ts
git commit -m "fix: surface real OHLC fetch error in check-pending-orders Telegram warning"
```

---

### Task 4: Full regression verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: All tests pass, including the three touched files and every other existing test (no regressions from the `fetchCandleRangeStats` signature change — Task 1–3 covered every call site).

- [ ] **Step 2: Run the TypeScript build**

Run: `npm run build`
Expected: Compiles with no errors — confirms no other file in `src/` still compares `fetchCandleRangeStats`'s result against `null` or expects the old return type.

- [ ] **Step 3: Confirm no other callers were missed**

Run: `grep -rn "fetchCandleRangeStats" src/`
Expected: Only three matches — the export in `src/charts/candle-range-stats.ts`, and the two call sites in `src/charts/check-open-trades-runner-volman.ts` and `src/charts/check-pending-orders-runner-volman.ts`, both already updated in Task 2 and Task 3.
