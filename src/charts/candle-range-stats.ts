import type { CandleRangeStats, ChartTimeframe, ChartConfig } from "./chart-types-common.js";
import { createLogger } from "../shared/infra/logger.js";
import { toBinanceSymbol } from "./ohlc-provider.js";
import { withRetry } from "../shared/retry.js";
import { withConfiguredRateLimit } from "../shared/infra/rate-limit.js";

const logger = createLogger("charts:candle-range-stats");

function getTimeframeRank(timeframe: ChartTimeframe): number {
  switch (timeframe) {
    case "D1":
      return 0;
    case "H4":
      return 1;
    case "H1":
      return 2;
    case "M30":
      return 3;
    case "M15":
      return 4;
  }
}

export function findChartForPair(charts: ChartConfig[], pair: string, preferredTimeframe: ChartTimeframe = "H4") {
  const normalized = pair.replace("/", "").toUpperCase();
  const matches = charts.filter((chart) => chart.symbol.toUpperCase().includes(normalized));
  if (matches.length === 0) {
    return undefined;
  }

  return (
    matches.find((chart) => chart.timeframe === preferredTimeframe) ??
    matches.find((chart) => chart.timeframe === "H4") ??
    matches.sort((left, right) => getTimeframeRank(left.timeframe) - getTimeframeRank(right.timeframe))[0]
  );
}

const FALLBACK_SYMBOLS: Record<string, string> = {
  "OANDA:EURUSD": "EURUSD=X",
  "OANDA:GBPUSD": "GBPUSD=X",
  "OANDA:USDJPY": "USDJPY=X",
  "OANDA:AUDUSD": "AUDUSD=X",
  "OANDA:USDCHF": "USDCHF=X",
  "OANDA:USDCAD": "USDCAD=X",
  "OANDA:NZDUSD": "NZDUSD=X",
  "OANDA:XAUUSD": "GC=F",
  "OANDA:XAGUSD": "SI=F",
};

async function fetchFallbackLastPrice(symbol: string): Promise<number | null> {
  const fallbackSymbol = FALLBACK_SYMBOLS[symbol];
  if (!fallbackSymbol) {
    return null;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(fallbackSymbol)}?interval=2m&range=1d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const closes = payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const lastClose = [...closes].reverse().find((value) => typeof value === "number" && Number.isFinite(value));
  return typeof lastClose === "number" ? lastClose : null;
}

const BINANCE_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines";
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
