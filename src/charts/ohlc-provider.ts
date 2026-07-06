import type { ChartTimeframe } from "./chart-types.js";
import { withRetry } from "../shared/retry.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:ohlc-provider");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Candle = {
  time: number; // epoch ms, thời điểm mở nến
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  candles: Candle[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCacheTtl(timeframe: ChartTimeframe): number {
  switch (timeframe) {
    case "M15":
      return 5 * 60 * 1000; // 5 phút
    case "H4":
      return 30 * 60 * 1000; // 30 phút
    case "D1":
      return 6 * 60 * 60 * 1000; // 6 giờ
  }
}

/** Cache key: `${symbol}:${timeframe}` */
function cacheKey(symbol: string, timeframe: ChartTimeframe): string {
  return `${symbol}:${timeframe}`;
}

// ---------------------------------------------------------------------------
// Symbol mapping
// ---------------------------------------------------------------------------

/**
 * Map internal symbol → OANDA instrument name.
 * Covers both 6-char currency pairs (XXXYYY) and XAU/XAG which are 3+3.
 */
export function toOandaInstrument(symbol: string): string | null {
  const prefix = "OANDA:";
  if (!symbol.startsWith(prefix)) return null;
  const instrument = symbol.slice(prefix.length); // e.g. "EURUSD", "XAUUSD"
  if (instrument.length < 6) return null;

  // Insert underscore between base and quote (after first 3 chars)
  // Works for pairs like EUR/USD, GBP/USD, XAU/USD, XAG/USD, USD/JPY etc.
  if (instrument.length === 6) {
    return `${instrument.slice(0, 3)}_${instrument.slice(3)}`;
  }

  // Fallback: split at last 3 chars for longer instrument names
  const quote = instrument.slice(-3);
  const base = instrument.slice(0, -3);
  return `${base}_${quote}`;
}

// ---------------------------------------------------------------------------
// Timeframe mapping
// ---------------------------------------------------------------------------

function toOandaGranularity(timeframe: ChartTimeframe): string | null {
  switch (timeframe) {
    case "M15":
      return "M15";
    case "H4":
      return "H4";
    case "D1":
      return "D";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch OHLC history
// ---------------------------------------------------------------------------

/**
 * Fetch historical OHLC candles from OANDA v20 REST API.
 *
 * Returns `Error` object when something goes wrong (missing config, network
 * error, API error) — NEVER throws. Caller is responsible for fallback logic.
 */
export async function fetchOhlcHistory(
  symbol: string,
  timeframe: ChartTimeframe,
  bars: number,
): Promise<Candle[] | Error> {
  // ---- Check cache first ----
  const key = cacheKey(symbol, timeframe);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.candles.slice();
  }

  // ---- Validate env ----
  const token = process.env.OANDA_API_TOKEN?.trim();
  const accountId = process.env.OANDA_ACCOUNT_ID?.trim();
  if (!token || !accountId) {
    return new Error("OANDA_API_TOKEN/OANDA_ACCOUNT_ID chưa cấu hình");
  }

  // ---- Map symbol ----
  const instrument = toOandaInstrument(symbol);
  if (!instrument) {
    return new Error(
      `Symbol không đúng định dạng OANDA:XXXYYY: "${symbol}"`,
    );
  }

  // ---- Map timeframe ----
  const granularity = toOandaGranularity(timeframe);
  if (!granularity) {
    return new Error(`Timeframe không hỗ trợ: "${timeframe}"`);
  }

  // ---- Build URL ----
  const baseUrl =
    process.env.OANDA_API_BASE_URL?.trim() ||
    "https://api-fxpractice.oanda.com";
  const url = `${baseUrl}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${Math.min(bars, 5000)}&price=M`;

  // ---- Fetch with retry ----
  let response: Response;
  try {
    response = await withRetry(async () => {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        // Convert non-ok responses to errors so withRetry can retry 429/5xx
        const err = new Error(`OANDA API trả về ${res.status} cho ${instrument} ${granularity}`);
        (err as any).status = res.status;
        throw err;
      }
      return res;
    }, {
      maxAttempts: 3,
      baseDelayMs: 1000,
      onRetry: (error, attempt, maxAttempts, delayMs) => {
        logger.warn(`OANDA retry ${attempt}/${maxAttempts} sau ${delayMs}ms: ${error instanceof Error ? error.message : error}`);
      },
    });
  } catch (networkError: unknown) {
    const msg =
      networkError instanceof Error
        ? networkError.message
        : "Unknown network error";
    return new Error(`Lỗi mạng khi gọi OANDA: ${msg}`);
  }

  if (!response.ok) {
    const err = new Error(
      `OANDA API trả về ${response.status} cho ${instrument} ${granularity}`,
    );
    (err as any).status = response.status;
    return err;
  }

  // ---- Parse ----
  let body: { candles?: unknown[] };
  try {
    body = (await response.json()) as { candles?: unknown[] };
  } catch {
    return new Error("Không thể parse JSON response từ OANDA");
  }

  if (!Array.isArray(body.candles)) {
    return new Error("OANDA response thiếu trường 'candles'");
  }

  const candles: Candle[] = [];

  for (const raw of body.candles) {
    const r = raw as Record<string, unknown>;

    // Only accept completed candles
    if (r.complete === false) continue;

    const time = typeof r.time === "string" ? Date.parse(r.time) : NaN;
    const volume = typeof r.volume === "number" ? r.volume : 0;
    const mid = r.mid as Record<string, string> | undefined;

    if (!Number.isFinite(time) || !mid) continue;

    const open = Number(mid.o);
    const high = Number(mid.h);
    const low = Number(mid.l);
    const close = Number(mid.c);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    )
      continue;

    candles.push({ time, open, high, low, close, volume });
  }

  // Sort ascending by time
  candles.sort((a, b) => a.time - b.time);

  // ---- Update cache ----
  cache.set(key, {
    candles: candles.slice(),
    expiresAt: Date.now() + getCacheTtl(timeframe),
  });

  return candles;
}

/**
 * Clear the entire OHLC cache. Useful in tests or when forcing a refresh.
 */
export function clearOhlcCache(): void {
  cache.clear();
}

/**
 * Invalidate cache for a specific symbol + timeframe.
 */
export function invalidateOhlcCache(
  symbol: string,
  timeframe: ChartTimeframe,
): void {
  cache.delete(cacheKey(symbol, timeframe));
}