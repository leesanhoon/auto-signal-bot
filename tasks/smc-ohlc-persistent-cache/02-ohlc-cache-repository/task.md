# Task 02: Tạo `src/charts/ohlc-cache-repository.ts`

## Bối cảnh

Subtask 01 đã tạo bảng Supabase `ohlc_candle_cache` (`cache_key text primary key`, `candles jsonb not null`, `expires_at timestamptz not null`, `created_at timestamptz not null default now()`). Task này viết repository TypeScript để đọc/ghi bảng đó — mirror đúng pattern fail-silent đã có trong `src/charts/chart-cache-repository.ts`. KHÔNG sửa `ohlc-provider.ts` ở task này (sẽ làm ở task 03) — task này CHỈ tạo file repository độc lập.

## Việc cần làm

Tạo file mới `src/charts/ohlc-cache-repository.ts` với nội dung theo khung sau (điều chỉnh cho đúng, giữ đúng tinh thần fail-silent + validate shape):

```typescript
import { getDb } from "../shared/db.js";
import { createLogger } from "../shared/logger.js";
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
```

## Tham khảo convention (đọc file này trước khi viết)

`src/charts/chart-cache-repository.ts` — đặc biệt các hàm `saveChartAnalysisCache` (dòng 10-35) và `loadChartAnalysisCache` (dòng 122-142) cho pattern upsert/`maybeSingle`/try-catch/fail-silent. Repository mới của bạn PHẢI theo đúng tinh thần này (không throw ra ngoài, luôn trả `null`/không làm gì khi lỗi).

## Ràng buộc

- KHÔNG sửa `src/charts/chart-cache-repository.ts`, `src/charts/ohlc-provider.ts`, hay bất kỳ file nào khác. Chỉ tạo file mới `src/charts/ohlc-cache-repository.ts`.
- Import `Candle` bằng `import type { Candle } from "./ohlc-provider.js"` — CHỈ import type, không import bất kỳ giá trị/hàm nào từ `ohlc-provider.ts` (tránh circular dependency runtime, vì `ohlc-provider.ts` sẽ import repo này ở task 03).
- Không throw lỗi ra ngoài ở cả `saveOhlcCandleCache` và `loadOhlcCandleCache` — mọi lỗi DB phải được nuốt (catch) và xử lý fail-silent/trả `null`.
- `loadOhlcCandleCache` phải tự lọc bản ghi đã hết hạn (`expires_at <= Date.now()`) — không dựa vào caller để check.
- Không thêm tính năng ngoài scope (không thêm hàm xoá cache, không thêm hàm list, không thêm index).

## Cách verify

- `npm run build` pass — không có lỗi TypeScript, đặc biệt không có circular import lỗi.
- `npm test` pass (chưa có test riêng cho file này ở task 02 — test sẽ được viết ở task 04, nhưng các test hiện có không được vỡ).

## Output

Ghi kết quả vào `tasks/smc-ohlc-persistent-cache/02-ohlc-cache-repository/result.md`:
- Nội dung file `src/charts/ohlc-cache-repository.ts` đã tạo
- Kết quả `npm run build && npm test`

Nếu bị chặn → ghi `blocked.md`, không tự đoán schema Supabase khác với migration đã có ở task 01.
