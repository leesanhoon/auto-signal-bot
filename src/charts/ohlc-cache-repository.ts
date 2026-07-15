import { getDb } from "../shared/infra/db.js";
import { createLogger } from "../shared/infra/logger.js";
import type { Candle } from "./ohlc-provider.js";

const logger = createLogger("ohlc-cache-repository");

/** Lưu candles OHLC theo cache_key (upsert). Fail-silent — không throw khi lỗi DB. */
export async function saveOhlcCandleCache(
  cacheKey: string,
  candles: Candle[],
  expiresAtMs: number,
): Promise<void> {
  try {
    await (getDb().from("ohlc_candle_cache") as any).upsert(
      {
        cache_key: cacheKey,
        candles,
        expires_at: new Date(expiresAtMs).toISOString(),
        created_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" },
    );
  } catch {
    // Fail silently — không crash job vì lỗi lưu cache
  }
}

type OhlcCandleCacheRow = {
  cache_key: string;
  candles: unknown;
  expires_at: string;
};

function isValidCandleArray(value: unknown): value is Candle[] {
  if (!Array.isArray(value)) return false;
  return value.every((c) => {
    if (typeof c !== "object" || c === null) return false;
    const candle = c as Record<string, unknown>;
    return (
      typeof candle.time === "number" &&
      typeof candle.open === "number" &&
      typeof candle.high === "number" &&
      typeof candle.low === "number" &&
      typeof candle.close === "number" &&
      typeof candle.volume === "number"
    );
  });
}

/**
 * Đọc candles OHLC theo cache_key. Trả null nếu không có, lỗi DB, schema sai,
 * hoặc bản ghi đã hết hạn (so expires_at với Date.now()).
 */
export async function loadOhlcCandleCache(
  cacheKey: string,
): Promise<{ candles: Candle[]; expiresAtMs: number } | null> {
  try {
    const { data, error } = await (getDb().from("ohlc_candle_cache") as any)
      .select("cache_key, candles, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as OhlcCandleCacheRow;
    const expiresAtMs = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;

    if (!isValidCandleArray(row.candles)) {
      logger.warn("OHLC cache schema invalid, treating as miss", { cacheKey });
      return null;
    }

    return { candles: row.candles, expiresAtMs };
  } catch {
    return null;
  }
}
