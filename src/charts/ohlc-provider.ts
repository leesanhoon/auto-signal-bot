import type { ChartTimeframe } from "./chart-types.js";
import { withRetry } from "../shared/retry.js";
import { withConfiguredRateLimit } from "../shared/rate-limit.js";
import { createLogger } from "../shared/logger.js";

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

type OhlcProvider = "metaapi" | "twelvedata";

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
  metaApiCode: string;
  twelveDataCode: string;
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
    metaApiCode: "15m",
    twelveDataCode: "15min",
  },
  H4: {
    intervalMs: 4 * 60 * 60 * 1000,
    metaApiCode: "4h",
    twelveDataCode: "4h",
  },
  D1: {
    intervalMs: 24 * 60 * 60 * 1000,
    metaApiCode: "1d",
    twelveDataCode: "1day",
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

function cacheKey(symbol: string, timeframe: ChartTimeframe, provider: OhlcProvider): string {
  return `${provider}:${symbol}:${timeframe}`;
}

function parseUtcTimestamp(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const normalized = value.replace(" ", "T");
  return /([zZ]|[+-]\d\d:?\d\d)$/.test(normalized) ? Date.parse(normalized) : Date.parse(`${normalized}Z`);
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

function getIntervalMs(timeframe: ChartTimeframe): number {
  return getTimeframeConfig(timeframe).intervalMs;
}

function getNextCandleCloseMs(timeframe: ChartTimeframe, fromMs: number): number {
  const intervalMs = getIntervalMs(timeframe);
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

function shouldSkipLatestCandle(latestTime: number, timeframe: ChartTimeframe): boolean {
  if (!Number.isFinite(latestTime)) return false;
  if (isForexWeekendClosed(Date.now())) return false;
  return Date.now() - latestTime < getIntervalMs(timeframe);
}

function getNextWeekendReopenMs(fromMs: number): number {
  const date = new Date(fromMs);
  const day = date.getUTCDay();
  const daysUntilSunday = (7 - day) % 7;
  const reopen = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + daysUntilSunday,
    21,
    0,
    0,
    0,
  ));

  if (reopen.getTime() <= fromMs) {
    reopen.setUTCDate(reopen.getUTCDate() + 7);
  }

  return reopen.getTime();
}

function getCacheExpiryMs(timeframe: ChartTimeframe, nowMs: number, latestCandleTime: number | null): number {
  if (isForexWeekendClosed(nowMs)) {
    return getNextWeekendReopenMs(nowMs);
  }

  const anchor = typeof latestCandleTime === "number" && Number.isFinite(latestCandleTime)
    ? latestCandleTime + getIntervalMs(timeframe)
    : nowMs;
  return getNextCandleCloseMs(timeframe, anchor) + CANDLE_CLOSE_BUFFER_MS;
}

async function fetchWithRetry(url: string, options: FetchWithRetryOptions): Promise<Response | Error> {
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
          logger.warn(`${options.label} retry ${attempt}/${maxAttempts} sau ${delayMs}ms: ${error instanceof Error ? error.message : error}`);
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
    const msg = error instanceof Error ? error.message : "Unknown network error";
    return new Error(`Loi mang khi goi ${options.label}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Region + domain resolution
// ---------------------------------------------------------------------------

const PROVISIONING_HOST = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

let regionDomainCache: { region: string; domain: string; expiresAt: number } | null = null;
const REGION_DOMAIN_CACHE_TTL = 60 * 60 * 1000;

async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T | Error> {
  const response = await fetchWithRetry(url, options);
  if (response instanceof Error) return response;

  try {
    return (await response.json()) as T;
  } catch {
    return new Error(`Khong the parse JSON response tu ${options.label}`);
  }
}

async function resolveRegionAndDomain(
  token: string,
  accountId: string,
): Promise<{ region: string; domain: string } | Error> {
  if (regionDomainCache && regionDomainCache.expiresAt > Date.now()) {
    return regionDomainCache;
  }

  const envRegion = process.env.METAAPI_REGION?.trim();

  const domainBody = await fetchJson<{ domain?: string }>(
    `${PROVISIONING_HOST}/users/current/servers/mt-client-api`,
    {
      label: "MetaApi domain discovery",
      headers: { "auth-token": token, Accept: "application/json" },
      retryOptions: { maxAttempts: 3, baseDelayMs: 1000 },
    },
  );
  if (domainBody instanceof Error) return domainBody;
  if (!domainBody.domain) return new Error("MetaApi domain discovery response thieu truong 'domain'");

  let region = envRegion;
  if (!region) {
    const accountBody = await fetchJson<{ region?: string }>(
      `${PROVISIONING_HOST}/users/current/accounts/${accountId}`,
      {
        label: "MetaApi account lookup",
        headers: { "auth-token": token, Accept: "application/json" },
        retryOptions: { maxAttempts: 3, baseDelayMs: 1000 },
      },
    );
    if (accountBody instanceof Error) return accountBody;
    if (!accountBody.region) return new Error("MetaApi account lookup response thieu truong 'region'");
    region = accountBody.region;
  }

  regionDomainCache = { region, domain: domainBody.domain, expiresAt: Date.now() + REGION_DOMAIN_CACHE_TTL };
  return regionDomainCache;
}

/** Clear cached account region/domain. */
export function clearRegionCache(): void {
  regionDomainCache = null;
}

// ---------------------------------------------------------------------------
// Symbol mapping
// ---------------------------------------------------------------------------

export function toMetaApiSymbol(symbol: string): string | null {
  const prefix = "OANDA:";
  if (!symbol.startsWith(prefix)) return null;
  const instrument = symbol.slice(prefix.length);
  if (instrument.length < 6) return null;

  const suffix = process.env.METAAPI_SYMBOL_SUFFIX?.trim() || "";
  return `${instrument}${suffix}`;
}

// ---------------------------------------------------------------------------
// Timeframe mapping
// ---------------------------------------------------------------------------

function toMetaApiTimeframe(timeframe: ChartTimeframe): string {
  return getTimeframeConfig(timeframe).metaApiCode;
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
    rateLimit: { key: "twelvedata", envVar: "TWELVEDATA_RATE_LIMIT_RPM", defaultRpm: 7 },
    retryOptions: { maxAttempts: 3, baseDelayMs: 1000 },
    onHttpError: async (res) => {
      let apiMessage: string | undefined;
      try {
        apiMessage = ((await res.clone().json()) as { message?: string })?.message;
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
  if (candles.length > 0 && shouldSkipLatestCandle(candles[candles.length - 1].time, timeframe)) {
    candles.pop();
  }

  return candles;
}

// ---------------------------------------------------------------------------
// Fetch OHLC history
// ---------------------------------------------------------------------------

export async function fetchOhlcHistory(
  symbol: string,
  timeframe: ChartTimeframe,
  bars: number,
): Promise<Candle[] | Error> {
  const twelveDataApiKey = process.env.TWELVEDATA_API_KEY?.trim();
  const provider: OhlcProvider = twelveDataApiKey ? "twelvedata" : "metaapi";
  const key = cacheKey(symbol, timeframe, provider);
  const cached = isCacheEnabled(timeframe) ? cache.get(key) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.candles.slice();
  }

  if (twelveDataApiKey) {
    const result = await fetchFromTwelveData(symbol, timeframe, bars, twelveDataApiKey);
    if (result instanceof Error) return result;
    if (isCacheEnabled(timeframe)) {
      const latestCandleTime = result.length > 0 ? result[result.length - 1].time : null;
      cache.set(key, { candles: result.slice(), expiresAt: getCacheExpiryMs(timeframe, Date.now(), latestCandleTime) });
    }
    return result;
  }

  const token = process.env.METAAPI_TOKEN?.trim();
  const accountId = process.env.METAAPI_ACCOUNT_ID?.trim();
  if (!token || !accountId) {
    return new Error("METAAPI_TOKEN/METAAPI_ACCOUNT_ID chua cau hinh");
  }

  const instrument = toMetaApiSymbol(symbol);
  if (!instrument) {
    return new Error(`Symbol khong dung dinh dang OANDA:XXXYYY: "${symbol}"`);
  }

  const mtTimeframe = toMetaApiTimeframe(timeframe);

  let baseUrl = process.env.METAAPI_MARKET_DATA_BASE_URL?.trim();
  if (!baseUrl) {
    const resolved = await resolveRegionAndDomain(token, accountId);
    if (resolved instanceof Error) {
      return resolved;
    }
    baseUrl = `https://mt-market-data-client-api-v1.${resolved.region}.${resolved.domain}`;
  }
  const url = `${baseUrl}/users/current/accounts/${accountId}/historical-market-data/symbols/${instrument}/timeframes/${mtTimeframe}/candles?limit=${Math.min(bars, 1000)}`;

  const body = await fetchJson<unknown>(url, {
    label: "MetaApi",
    headers: {
      "auth-token": token,
      Accept: "application/json",
    },
    retryOptions: { maxAttempts: 3, baseDelayMs: 1000 },
    onHttpError: async (res) => {
      const error = new Error(`MetaApi API tra ve ${res.status} cho ${instrument} ${mtTimeframe}`);
      (error as any).status = res.status;
      return error;
    },
  });
  if (body instanceof Error) return body;

  if (!Array.isArray(body)) {
    return new Error("MetaApi response khong phai mang candles");
  }

  const candles: Candle[] = [];
  for (const raw of body) {
    const candle = parseCandleRow(raw, {
      timeField: "time",
      openField: "open",
      highField: "high",
      lowField: "low",
      closeField: "close",
      volumeField: "volume",
      fallbackVolumeField: "tickVolume",
      skipIfCompleteFalse: true,
    });
    if (candle) candles.push(candle);
  }

  candles.sort((a, b) => a.time - b.time);
  if (candles.length > 0 && shouldSkipLatestCandle(candles[candles.length - 1].time, timeframe)) {
    candles.pop();
  }

  if (isCacheEnabled(timeframe)) {
    cache.set(key, {
      candles: candles.slice(),
      expiresAt: getCacheExpiryMs(timeframe, Date.now(), candles.length > 0 ? candles[candles.length - 1].time : null),
    });
  }

  return candles;
}

export function clearOhlcCache(): void {
  cache.clear();
}

export function invalidateOhlcCache(
  symbol: string,
  timeframe: ChartTimeframe,
): void {
  cache.delete(cacheKey(symbol, timeframe, "metaapi"));
  cache.delete(cacheKey(symbol, timeframe, "twelvedata"));
}
