import type { ChartTimeframe } from "./chart-types-common.js";
import { withRetry } from "../shared/retry.js";
import { withConfiguredRateLimit } from "../shared/infra/rate-limit.js";
import { createLogger } from "../shared/infra/logger.js";
import { formatFetchErrorDetails } from "../shared/infra/fetch-diagnostics.js";
import { loadOhlcCandleCache, saveOhlcCandleCache } from "./ohlc-cache-repository.js";

const logger = createLogger("charts:ohlc-provider");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Candle = {
  time: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

interface CacheEntry {
  candles: Candle[];
  expiresAt: number;
}

type CandleRowMap = {
  timeField: "time" | "datetime";
  openField: string;
  highField: string;
  lowField: string;
  closeField: string;
  volumeField?: string;
  fallbackVolumeField?: string;
  skipIfCompleteFalse?: boolean;
};

type TimeframeConfig = {
  intervalMs: number;
  twelveDataCode: string;
  binanceCode: string;
};

type FetchWithRetryOptions = {
  label: string;
  headers?: Record<string, string>;
  retryOptions?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    isRetryable?: (error: unknown) => boolean;
  };
  rateLimit?: {
    key: string;
    envVar: string;
    defaultRpm: number;
    windowMs?: number;
  };
  onHttpError?: (response: Response) => Promise<Error> | Error;
};

type FetchJsonOptions = FetchWithRetryOptions;

const TIMEFRAME_CONFIG: Record<ChartTimeframe, TimeframeConfig> = {
  M15: {
    intervalMs: 15 * 60 * 1000,
    twelveDataCode: "15min",
    binanceCode: "15m",
  },
  M30: {
    intervalMs: 30 * 60 * 1000,
    twelveDataCode: "30min",
    binanceCode: "30m",
  },
  H1: {
    intervalMs: 60 * 60 * 1000,
    twelveDataCode: "1h",
    binanceCode: "1h",
  },
  H4: {
    intervalMs: 4 * 60 * 60 * 1000,
    twelveDataCode: "4h",
    binanceCode: "4h",
  },
  D1: {
    intervalMs: 24 * 60 * 60 * 1000,
    twelveDataCode: "1day",
    binanceCode: "1d",
  },
};

const cache = new Map<string, CacheEntry>();
const CANDLE_CLOSE_BUFFER_MS = 60 * 1000;

function getTimeframeConfig(timeframe: ChartTimeframe): TimeframeConfig {
  return TIMEFRAME_CONFIG[timeframe];
}

function isCacheEnabled(timeframe: ChartTimeframe): boolean {
  return timeframe !== "D1";
}

function cacheKey(symbol: string, timeframe: ChartTimeframe): string {
  return `${symbol}:${timeframe}`;
}

function parseUtcTimestamp(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const normalized = value.replace(" ", "T");
  return /([zZ]|[+-]\d\d:?\d\d)$/.test(normalized)
    ? Date.parse(normalized)
    : Date.parse(`${normalized}Z`);
}

function readFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseCandleRow(raw: unknown, map: CandleRowMap): Candle | null {
  const r = raw as Record<string, unknown>;

  if (map.skipIfCompleteFalse && r.complete === false) {
    return null;
  }

  const time = parseUtcTimestamp(r[map.timeField]);
  const open = readFiniteNumber(r[map.openField]);
  const high = readFiniteNumber(r[map.highField]);
  const low = readFiniteNumber(r[map.lowField]);
  const close = readFiniteNumber(r[map.closeField]);

  let volume = map.volumeField ? readFiniteNumber(r[map.volumeField]) : NaN;
  if (!Number.isFinite(volume) && map.fallbackVolumeField) {
    volume = readFiniteNumber(r[map.fallbackVolumeField]);
  }

  if (
    !Number.isFinite(time) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }

  return {
    time,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

function getNextCandleCloseMs(
  timeframe: ChartTimeframe,
  fromMs: number,
): number {
  const intervalMs = getTimeframeConfig(timeframe).intervalMs;
  return Math.floor(fromMs / intervalMs) * intervalMs + intervalMs;
}

function isForexWeekendClosed(nowMs: number): boolean {
  const now = new Date(nowMs);
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  if (day === 6) return true; // Saturday
  if (day === 0 && hour < 21) return true; // Sunday before reopen
  if (day === 5 && hour >= 21) return true; // Friday after close
  return false;
}

function shouldSkipLatestCandle(
  latestTime: number,
  timeframe: ChartTimeframe,
): boolean {
  if (!Number.isFinite(latestTime)) return false;
  if (isForexWeekendClosed(Date.now())) return false;
  return Date.now() - latestTime < getTimeframeConfig(timeframe).intervalMs;
}

function getNextWeekendReopenMs(fromMs: number): number {
  const date = new Date(fromMs);
  const day = date.getUTCDay();
  const daysUntilSunday = (7 - day) % 7;
  const reopen = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + daysUntilSunday,
      21,
      0,
      0,
      0,
    ),
  );

  if (reopen.getTime() <= fromMs) {
    reopen.setUTCDate(reopen.getUTCDate() + 7);
  }

  return reopen.getTime();
}

function getCacheExpiryMs(
  timeframe: ChartTimeframe,
  nowMs: number,
  latestCandleTime: number | null,
  tradesContinuously = false,
): number {
  if (!tradesContinuously && isForexWeekendClosed(nowMs)) {
    return getNextWeekendReopenMs(nowMs);
  }

  const anchor =
    typeof latestCandleTime === "number" && Number.isFinite(latestCandleTime)
      ? latestCandleTime + getTimeframeConfig(timeframe).intervalMs
      : nowMs;
  return getNextCandleCloseMs(timeframe, anchor) + CANDLE_CLOSE_BUFFER_MS;
}

async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions,
): Promise<Response | Error> {
  const run = async (): Promise<Response> =>
    withRetry(
      async () => {
        const response = await fetch(url, { headers: options.headers });
        if (!response.ok) {
          const error = options.onHttpError
            ? await options.onHttpError(response)
            : new Error(`${options.label} tra ve ${response.status}`);
          if (!(error as any).status) {
            (error as any).status = response.status;
          }
          throw error;
        }
        return response;
      },
      {
        maxAttempts: options.retryOptions?.maxAttempts ?? 3,
        baseDelayMs: options.retryOptions?.baseDelayMs ?? 1000,
        isRetryable: options.retryOptions?.isRetryable,
        onRetry: (error, attempt, maxAttempts, delayMs) => {
          logger.warn(
            `${options.label} retry ${attempt}/${maxAttempts} sau ${delayMs}ms: ${formatFetchErrorDetails(error)}`,
          );
        },
      },
    );

  try {
    if (options.rateLimit) {
      return await withConfiguredRateLimit(options.rateLimit, run);
    }
    return await run();
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      return error;
    }
    const msg = formatFetchErrorDetails(error);
    return new Error(`Loi mang khi goi ${options.label}: ${msg}`);
  }
}

async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions,
): Promise<T | Error> {
  const response = await fetchWithRetry(url, options);
  if (response instanceof Error) return response;

  try {
    return (await response.json()) as T;
  } catch {
    return new Error(`Khong the parse JSON response tu ${options.label}`);
  }
}

// ---------------------------------------------------------------------------
// Twelve Data provider
// ---------------------------------------------------------------------------

const TWELVEDATA_BASE_URL = "https://api.twelvedata.com/time_series";

export function toTwelveDataSymbol(symbol: string): string | null {
  const prefix = "OANDA:";
  if (!symbol.startsWith(prefix)) return null;
  const instrument = symbol.slice(prefix.length);
  if (instrument.length < 6) return null;
  return `${instrument.slice(0, 3)}/${instrument.slice(3, 6)}`;
}

function toTwelveDataInterval(timeframe: ChartTimeframe): string {
  return getTimeframeConfig(timeframe).twelveDataCode;
}

async function fetchFromTwelveData(
  symbol: string,
  timeframe: ChartTimeframe,
  bars: number,
  apiKey: string,
): Promise<Candle[] | Error> {
  const tdSymbol = toTwelveDataSymbol(symbol);
  if (!tdSymbol) {
    return new Error(`Symbol khong dung dinh dang OANDA:XXXYYY: "${symbol}"`);
  }

  const interval = toTwelveDataInterval(timeframe);
  const url = `${TWELVEDATA_BASE_URL}?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=${Math.min(bars, 5000)}&apikey=${apiKey}&timezone=UTC`;

  const body = await fetchJson<any>(url, {
    label: "Twelve Data",
    headers: { Accept: "application/json" },
    rateLimit: {
      key: "twelvedata",
      envVar: "TWELVEDATA_RATE_LIMIT_RPM",
      defaultRpm: 7,
    },
    retryOptions: { maxAttempts: 3, baseDelayMs: 1000 },
    onHttpError: async (res) => {
      let apiMessage: string | undefined;
      try {
        apiMessage = ((await res.clone().json()) as { message?: string })
          ?.message;
      } catch {
        // ignore
      }
      const error = new Error(
        `Twelve Data API tra ve ${res.status} cho ${tdSymbol} ${interval}${apiMessage ? `: ${apiMessage}` : ""}`,
      );
      (error as any).status = res.status;
      return error;
    },
  });
  if (body instanceof Error) return body;

  if (body?.status === "error") {
    return new Error(`Twelve Data API loi: ${body.message ?? "unknown error"}`);
  }

  if (!Array.isArray(body?.values)) {
    return new Error("Twelve Data response khong co mang 'values'");
  }

  const candles: Candle[] = [];
  for (const raw of body.values) {
    const candle = parseCandleRow(raw, {
      timeField: "datetime",
      openField: "open",
      highField: "high",
      lowField: "low",
      closeField: "close",
      volumeField: "volume",
    });
    if (candle) candles.push(candle);
  }

  candles.sort((a, b) => a.time - b.time);
  if (
    candles.length > 0 &&
    shouldSkipLatestCandle(candles[candles.length - 1].time, timeframe)
  ) {
    candles.pop();
  }

  return candles;
}

// ---------------------------------------------------------------------------
// Binance provider (crypto USDT-M Futures — bot trades Futures, chart data
// must use the same market so symbol format/availability stay in sync).
// ---------------------------------------------------------------------------

const BINANCE_BASE_URL = "https://fapi.binance.com/fapi/v1/klines";
const BINANCE_MAX_LIMIT = 1000;

export function toBinanceSymbol(symbol: string): string | null {
  const prefix = "BINANCE:";
  if (!symbol.startsWith(prefix)) return null;
  const instrument = symbol.slice(prefix.length).trim().toUpperCase();
  if (!/^[A-Z0-9]{5,}$/.test(instrument)) return null;
  return instrument;
}

export function isBinanceSymbol(symbol: string): boolean {
  return toBinanceSymbol(symbol) !== null;
}

// Kline row: [openTime, open, high, low, close, volume, closeTime, ...]
type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

async function fetchBinanceKlinesPage(
  bnSymbol: string,
  interval: string,
  limit: number,
  endTimeMs: number | undefined,
): Promise<{ candles: Candle[]; rawCount: number } | Error> {
  const url = `${BINANCE_BASE_URL}?symbol=${encodeURIComponent(bnSymbol)}&interval=${interval}&limit=${limit}${endTimeMs ? `&endTime=${endTimeMs}` : ""}`;

  const body = await fetchJson<unknown>(url, {
    label: "Binance",
    headers: { Accept: "application/json" },
    rateLimit: {
      key: "binance",
      envVar: "BINANCE_RATE_LIMIT_RPM",
      defaultRpm: 300,
    },
    retryOptions: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      isRetryable: (error) => {
        const status = (error as { status?: number }).status;
        // 418/429 = ban/rate-limit; retrying immediately makes bans worse.
        return status !== 418 && status !== 429 && status !== 400;
      },
    },
    onHttpError: async (res) => {
      let apiMessage: string | undefined;
      try {
        apiMessage = ((await res.clone().json()) as { msg?: string })?.msg;
      } catch {
        // ignore
      }
      const error = new Error(
        `Binance API tra ve ${res.status} cho ${bnSymbol} ${interval}${apiMessage ? `: ${apiMessage}` : ""}`,
      );
      (error as any).status = res.status;
      return error;
    },
  });
  if (body instanceof Error) return body;

  if (!Array.isArray(body)) {
    return new Error("Binance response khong phai mang klines");
  }

  const nowMs = Date.now();
  const candles: Candle[] = [];
  for (const raw of body as BinanceKline[]) {
    if (!Array.isArray(raw) || raw.length < 7) continue;

    const time = readFiniteNumber(raw[0]);
    const open = readFiniteNumber(raw[1]);
    const high = readFiniteNumber(raw[2]);
    const low = readFiniteNumber(raw[3]);
    const close = readFiniteNumber(raw[4]);
    const volume = readFiniteNumber(raw[5]);
    const closeTime = readFiniteNumber(raw[6]);

    if (
      !Number.isFinite(time) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }

    // Drop the still-forming candle (closeTime is in the future).
    if (Number.isFinite(closeTime) && closeTime > nowMs) continue;

    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }

  candles.sort((a, b) => a.time - b.time);
  return { candles, rawCount: (body as BinanceKline[]).length };
}

/**
 * Binance caps a single klines request at BINANCE_MAX_LIMIT bars. To backtest
 * further back than that, page backwards: each round asks for candles ending
 * just before the oldest one already fetched, until enough bars are collected
 * or the exchange has no older history left.
 */
async function fetchFromBinance(
  symbol: string,
  timeframe: ChartTimeframe,
  bars: number,
  endTimeMs?: number,
): Promise<Candle[] | Error> {
  const bnSymbol = toBinanceSymbol(symbol);
  if (!bnSymbol) {
    return new Error(`Symbol khong dung dinh dang BINANCE:XXXYYY: "${symbol}"`);
  }

  const interval = getTimeframeConfig(timeframe).binanceCode;
  const pages: Candle[][] = [];
  // Fetch 1 extra bar overall: the newest kline is still forming and gets dropped.
  let remaining = bars + 1;
  let cursorEndTime = endTimeMs;

  while (remaining > 0) {
    const limit = Math.min(remaining, BINANCE_MAX_LIMIT);
    const page = await fetchBinanceKlinesPage(bnSymbol, interval, limit, cursorEndTime);
    if (page instanceof Error) {
      if (pages.length > 0) break;
      return page;
    }
    if (page.candles.length === 0) break;

    pages.unshift(page.candles);
    remaining -= page.candles.length;
    cursorEndTime = page.candles[0].time - 1;
    // Use the raw row count (before dropping the still-forming candle) to
    // detect end-of-history — the filtered length is naturally short by one
    // on the most recent page and would otherwise stop pagination early.
    if (page.rawCount < limit) break;
  }

  const dedup = new Map<number, Candle>();
  for (const candle of pages.flat()) {
    dedup.set(candle.time, candle);
  }
  const candles = Array.from(dedup.values()).sort((a, b) => a.time - b.time);

  return candles.slice(-bars);
}

// ---------------------------------------------------------------------------
// Fetch last price (ticker)
// ---------------------------------------------------------------------------

const BINANCE_TICKER_URL = "https://fapi.binance.com/fapi/v1/ticker/price";
const TWELVEDATA_PRICE_URL = "https://api.twelvedata.com/price";

export async function fetchLastPrice(symbol: string): Promise<number | Error> {
  const useBinance = isBinanceSymbol(symbol);

  let twelveDataApiKey: string | undefined;
  if (!useBinance) {
    const tdSymbol = toTwelveDataSymbol(symbol);
    if (!tdSymbol) {
      return new Error(`Symbol khong dung dinh dang OANDA:XXXYYY: "${symbol}"`);
    }
    twelveDataApiKey = process.env.TWELVEDATA_API_KEY?.trim();
    if (!twelveDataApiKey) {
      return new Error("TWELVEDATA_API_KEY chua cau hinh");
    }
  }

  return useBinance
    ? await fetchLastPriceFromBinance(symbol)
    : await fetchLastPriceFromTwelveData(symbol, twelveDataApiKey!);
}

async function fetchLastPriceFromBinance(symbol: string): Promise<number | Error> {
  const bnSymbol = toBinanceSymbol(symbol);
  if (!bnSymbol) {
    return new Error(`Symbol khong dung dinh dang BINANCE:XXXYYY: "${symbol}"`);
  }

  const url = `${BINANCE_TICKER_URL}?symbol=${encodeURIComponent(bnSymbol)}`;

  const body = await fetchJson<any>(url, {
    label: "Binance ticker/price",
    headers: { Accept: "application/json" },
    rateLimit: {
      key: "binance",
      envVar: "BINANCE_RATE_LIMIT_RPM",
      defaultRpm: 300,
    },
    retryOptions: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      isRetryable: (error) => {
        const status = (error as { status?: number }).status;
        return status !== 418 && status !== 429 && status !== 400;
      },
    },
    onHttpError: async (res) => {
      let apiMessage: string | undefined;
      try {
        apiMessage = ((await res.clone().json()) as { msg?: string })?.msg;
      } catch {
        // ignore
      }
      const error = new Error(
        `Binance API tra ve ${res.status} cho ${bnSymbol}${apiMessage ? `: ${apiMessage}` : ""}`,
      );
      (error as any).status = res.status;
      return error;
    },
  });
  if (body instanceof Error) return body;

  const price = body?.price;
  if (!price) {
    return new Error(`Binance khong tra ve price cho ${bnSymbol}`);
  }

  const numPrice = readFiniteNumber(price);
  if (!Number.isFinite(numPrice)) {
    return new Error(`Khong the parse price tu Binance: ${price}`);
  }

  return numPrice;
}

async function fetchLastPriceFromTwelveData(
  symbol: string,
  apiKey: string,
): Promise<number | Error> {
  const tdSymbol = toTwelveDataSymbol(symbol);
  if (!tdSymbol) {
    return new Error(`Symbol khong dung dinh dang OANDA:XXXYYY: "${symbol}"`);
  }

  const url = `${TWELVEDATA_PRICE_URL}?symbol=${encodeURIComponent(tdSymbol)}&apikey=${apiKey}&timezone=UTC`;

  const body = await fetchJson<any>(url, {
    label: "Twelve Data price",
    headers: { Accept: "application/json" },
    rateLimit: {
      key: "twelvedata",
      envVar: "TWELVEDATA_RATE_LIMIT_RPM",
      defaultRpm: 7,
    },
    retryOptions: { maxAttempts: 3, baseDelayMs: 1000 },
    onHttpError: async (res) => {
      let apiMessage: string | undefined;
      try {
        apiMessage = ((await res.clone().json()) as { message?: string })
          ?.message;
      } catch {
        // ignore
      }
      const error = new Error(
        `Twelve Data API tra ve ${res.status} cho ${tdSymbol}${apiMessage ? `: ${apiMessage}` : ""}`,
      );
      (error as any).status = res.status;
      return error;
    },
  });
  if (body instanceof Error) return body;

  if (body?.status === "error") {
    return new Error(`Twelve Data API loi: ${body.message ?? "unknown error"}`);
  }

  const price = body?.price;
  if (!price) {
    return new Error(`Twelve Data khong tra ve price cho ${tdSymbol}`);
  }

  const numPrice = readFiniteNumber(price);
  if (!Number.isFinite(numPrice)) {
    return new Error(`Khong the parse price tu Twelve Data: ${price}`);
  }

  return numPrice;
}

// ---------------------------------------------------------------------------
// Forex/gold weekend closure filter
// ---------------------------------------------------------------------------

/**
 * Loại bỏ nến rơi vào giờ thị trường đóng cửa cho các symbol OANDA (forex/vàng),
 * CHỈ áp dụng cho khung intraday (M15/H1/H4) — nến chết chỉ xuất hiện ở dữ liệu
 * theo giờ. Nến D1 gộp cả ngày/tuần, áp dụng lọc theo giờ ở đây không có ý nghĩa
 * (và có thể xóa nhầm nến D1 hợp lệ đóng dấu vào Chủ nhật). Không ảnh hưởng symbol
 * Binance (crypto 24/7).
 *
 * Lý do cần lọc: khi thị trường đóng cửa, nguồn dữ liệu (Twelve Data/OANDA) vẫn có
 * thể trả về nến H1/H4 "chết" (giá gần như đứng yên, ATR gần 0). Các detector dựa
 * trên nén (BB/RB/ARB/IRB) có thể nhận nhầm đoạn nến chết này là block nén chặt, tạo
 * ra risk gần 0 và R-multiple bị khuếch đại phi thực tế khi thị trường mở cửa trở
 * lại (đã xác nhận cụ thể với XAU/USD trên khung H1 — xem review backtest).
 * Dùng lại `isForexWeekendClosed` (đã có sẵn cho cache expiry) để nhất quán biên
 * đóng/mở cửa (thứ Sáu 21:00 UTC → Chủ nhật 21:00 UTC).
 */
export function filterClosedForexCandles(
  candles: Candle[],
  symbol: string,
  timeframe: ChartTimeframe,
): Candle[] {
  if (isBinanceSymbol(symbol) || timeframe === "D1") return candles;
  return candles.filter((c) => !isForexWeekendClosed(c.time));
}

// ---------------------------------------------------------------------------
// Fetch OHLC history
// ---------------------------------------------------------------------------

export async function fetchOhlcHistory(
  symbol: string,
  timeframe: ChartTimeframe,
  bars: number,
  options?: { bypassCache?: boolean; endTimeMs?: number },
): Promise<Candle[] | Error> {
  const useBinance = isBinanceSymbol(symbol);
  const bypassCache = options?.bypassCache ?? false;
  const endTimeMs = options?.endTimeMs;

  let twelveDataApiKey: string | undefined;
  if (!useBinance) {
    twelveDataApiKey = process.env.TWELVEDATA_API_KEY?.trim();
    if (!twelveDataApiKey) {
      return new Error("TWELVEDATA_API_KEY chua cau hinh");
    }
  }

  const key = cacheKey(symbol, timeframe);
  const cached = !bypassCache && isCacheEnabled(timeframe) ? cache.get(key) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return filterClosedForexCandles(cached.candles.slice(), symbol, timeframe);
  }

  if (!bypassCache && isCacheEnabled(timeframe)) {
    const persisted = await loadOhlcCandleCache(key);
    if (persisted) {
      cache.set(key, { candles: persisted.candles.slice(), expiresAt: persisted.expiresAtMs });
      return filterClosedForexCandles(persisted.candles.slice(), symbol, timeframe);
    }
  }

  if (endTimeMs && !useBinance) {
    logger.warn(`Bỏ qua pin window cho ${symbol}: chưa hỗ trợ TwelveData`);
  }

  const rawResult = useBinance
    ? await fetchFromBinance(symbol, timeframe, bars, endTimeMs)
    : await fetchFromTwelveData(symbol, timeframe, bars, twelveDataApiKey!);
  if (rawResult instanceof Error) return rawResult;
  // Lọc nến "chết" trong giờ đóng cửa cuối tuần TRƯỚC khi cache — cache (memory + DB)
  // chỉ chứa nến giao dịch thật, mọi consumer (live pipeline, backtest) tự động sạch.
  const result = filterClosedForexCandles(rawResult, symbol, timeframe);
  if (!bypassCache && isCacheEnabled(timeframe)) {
    const latestCandleTime =
      result.length > 0 ? result[result.length - 1].time : null;
    const expiresAt = getCacheExpiryMs(
      timeframe,
      Date.now(),
      latestCandleTime,
      useBinance,
    );
    cache.set(key, {
      candles: result.slice(),
      expiresAt,
    });
    await saveOhlcCandleCache(key, result, expiresAt);
  }
  return result;
}

export function clearOhlcCache(): void {
  cache.clear();
}

export function invalidateOhlcCache(
  symbol: string,
  timeframe: ChartTimeframe,
): void {
  cache.delete(cacheKey(symbol, timeframe));
}
