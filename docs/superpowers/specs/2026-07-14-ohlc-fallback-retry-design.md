# OHLC Fallback Retry & Error Reporting — Design

## Context

Positions/pending orders that don't have a `binanceSymbol` (no real order on the exchange
— this happens when Binance live trading is disabled via `BINANCE_LIVE_TRADING_ENABLED`
/ `BINANCE_LIVE_TRADING_ENABLED_VOLMAN`) are checked against SL/TP using a second,
independent path: `fetchCandleRangeStats()` (src/charts/candle-range-stats.ts) pulls
public OHLC from Binance's spot klines endpoint and `resolveOpenPositionDecision()` /
`resolvePendingOrderDecision()` (src/charts/position-decision-volman.ts) compare it
against the stored SL/TP.

This is deliberately a separate code path from `reconcileBinancePosition()`
(src/charts/binance-execution-shared.ts), which is used when `binanceSymbol` is set and
checks real order status via the authenticated Binance Futures API. The two flows stay
split on `position.binanceSymbol` (decided in this design's brainstorm) — this document
only hardens the fallback path.

### Problem

`fetchBinanceCandleRangeStats()` (src/charts/candle-range-stats.ts:81) calls `fetch()`
directly with no retry, no rate limiting, and no captured error detail. Any single
transient failure — network blip, HTTP 5xx, a stray rate-limit — makes the whole check
fail and immediately sends a generic Telegram warning:

> ⚠️ Check Open Trades — Không lấy được OHLC để kiểm tra vị thế #167 FLOW/USDT.

Live testing during triage confirmed Binance's klines endpoint returns normal data for
both symbols that triggered this (FLOWUSDT, BNXUSDT) — the data exists, the fetch just
isn't resilient to a single bad attempt, and the operator has no way to tell *why* it
failed without digging through server logs.

This is inconsistent with `fetchOhlcHistory()` (src/charts/ohlc-provider.ts:226-283),
which already wraps its Binance/TwelveData calls with `withRetry` +
`withConfiguredRateLimit` and captures the exchange's error message.

## Goal

Bring `fetchBinanceCandleRangeStats()` up to the same reliability bar as
`fetchOhlcHistory()`, and surface the real failure reason in the Telegram warning instead
of a generic message — scoped to the Binance branch only. The Yahoo Finance fallback
branch (forex/gold, `OANDA:*` symbols) is out of scope for retry/rate-limit changes.

## Design

### 1. `fetchCandleRangeStats` return type

Change from `Promise<CandleRangeStats | null>` to `Promise<CandleRangeStats | Error>`,
matching the `T | Error` convention already used by `fetchOhlcHistory` and
`fetchLastPrice` elsewhere in this codebase.

- **Binance branch** (`fetchBinanceCandleRangeStats`): every failure path (HTTP error,
  malformed body, empty klines array) returns a descriptive `Error` instead of `null`.
- **Yahoo Finance branch** (forex/gold fallback, inline in `fetchCandleRangeStats`):
  no retry/rate-limit added. Existing `return null` points become `return new Error(...)`
  with a message describing which check failed (HTTP not ok, missing quote, timestamp
  mismatch, etc.), purely to keep the function's return type consistent for callers.
  No other behavior change on this branch.

### 2. Retry

`fetchBinanceCandleRangeStats` wraps its `fetch()` call with `withRetry` (from
`src/shared/retry.ts`, already used by `ohlc-provider.ts`):

- `maxAttempts: 3`
- `baseDelayMs: 1000` (exponential backoff, same as `fetchOhlcHistory`)
- `isRetryable`: same policy as `fetchFromBinance` in ohlc-provider.ts — do **not**
  retry on `418` (IP ban) or `429` (rate limit, retrying immediately makes it worse) or
  `400` (bad request, retrying won't help); retry everything else (network errors,
  5xx, timeouts).
- On each retry, `logger.warn` logs the attempt number and underlying error (mirrors
  `onRetry` in `fetchWithRetry`, ohlc-provider.ts:249-253).

### 3. Rate limiting

Wrap the same call with `withConfiguredRateLimit` (from `src/shared/rate-limit.ts`)
using:

- `key: "binance"`
- `envVar: "BINANCE_RATE_LIMIT_RPM"`
- `defaultRpm: 300`

This reuses the **same rate-limit bucket** as `ohlc-provider.ts`'s Binance calls (the
limiter state is a module-level `Map` keyed by `key`), so the two code paths share one
real budget against Binance's actual per-IP limit instead of each assuming they have the
full 300 rpm to themselves.

### 4. Error detail capture

On a non-ok HTTP response, parse the response body for Binance's `msg` field (same shape
as `onHttpError` in ohlc-provider.ts:422-434) and build an `Error` with a message like:

```
Binance API tra ve 429 cho FLOWUSDT: Way too many requests; IP banned...
```

and `.status` set to the HTTP status code, so `isRetryable` can inspect it.

### 5. Call sites

Two call sites, both currently do `if (stats === null)`:

- `evaluateOpenPosition()` — src/charts/check-open-trades-runner-volman.ts:36-42
- `reviewPendingOrder()` — src/charts/check-pending-orders-runner-volman.ts:51-57

Both change to:

```ts
const stats = await fetchCandleRangeStats(chart.symbol, sinceMs);
if (stats instanceof Error) {
  logger.warn("Failed to fetch OHLC for open position; sending explicit warning", {
    pair: position.pair, id: position.id, error: stats,
  });
  await sendMessage(
    `⚠️ *Check Open Trades*\n\nKhông lấy được OHLC để kiểm tra vị thế #${position.id} ${position.pair}.\n` +
    `Bot tạm giữ vị thế nhưng không thể xác minh SL/TP trong lượt này.\n` +
    `Lỗi: ${stats.message}`,
  );
}
```

and pass `stats instanceof Error ? null : stats` into
`resolveOpenPositionDecision` / `resolvePendingOrderDecision`, whose signatures
(`CandleRangeStats | null` + `reason` string) stay unchanged — they don't need to know
about the underlying `Error`, only that data wasn't available.

## Testing

- `tests/charts/candle-range-stats.test.ts`:
  - Existing "fetch failure" cases now assert `result instanceof Error` instead of
    `toBeNull()`.
  - New case: first call returns HTTP 500, second call succeeds → result is the parsed
    stats (retry works).
  - New case: HTTP 429/418/400 → no retry attempted (single fetch call), result is an
    `Error` whose message includes the status.
  - New case: error message includes Binance's `msg` field when present in the response
    body.
- `tests/charts/check-open-trades-runner-volman.test.ts` and
  `tests/charts/check-pending-orders-runner-volman.test.ts`:
  - Mock `fetchCandleRangeStats` to resolve an `Error` instead of `null`.
  - Assert the Telegram warning message includes the error's `.message`.

## Out of scope

- Yahoo Finance (forex/gold) fallback retry/rate-limit — explicitly deferred.
- Changing the `binanceSymbol`-based branch selection between `reconcileBinancePosition`
  and the OHLC fallback path — kept as-is (decided during brainstorming).
- Any change to `reconcileBinancePosition` itself.
