# Plan: Cache dữ liệu nến OHLC (Supabase) để giảm thời gian chạy `analyze-smc.yml`

## Bối cảnh (đã khảo sát trực tiếp code)

`analyze-smc.yml` chạy cron mỗi 15 phút (`*/15 * * * 1-5`), gọi `npm run analyze:smc` → `src/charts/smc-index.ts` → `analyzeAllChartsSmc` ([smc-pipeline.ts:387-478](../../src/charts/smc/smc-pipeline.ts#L387-L478)).

Với 8 cặp đang bật trong `charts.config.ts` (XAU, EUR, GBP, JPY, AUD, CHF, CAD, NZD), mỗi lần chạy gọi TwelveData qua `fetchOhlcHistory` ([ohlc-provider.ts:371](../../src/charts/ohlc-provider.ts#L371)):

- 1 lần **M15** (chart chính, [smc-pipeline.ts:403](../../src/charts/smc/smc-pipeline.ts#L403))
- 1 lần **H4** (HTF bias, `buildHtfContext` → [smc-htf-context.ts:82-94](../../src/charts/smc/smc-htf-context.ts#L82-L94), map M15→H4)
- Khi có signal: thêm 2 lần **H1** + **M30** (confluence, [smc-confluence.ts:31-55](../../src/charts/smc/smc-confluence.ts#L31-L55))

→ tối đa ~32 request TwelveData/lần chạy, bị xếp hàng bởi rate limit mặc định **7 request/phút** (`TWELVEDATA_RATE_LIMIT_RPM`, [rate-limit.ts:43-50](../../src/shared/infra/rate-limit.ts#L43-L50), dùng trong [ohlc-provider.ts:312-316](../../src/charts/ohlc-provider.ts#L312-L316)) → đây là nguyên nhân chính khiến job chạy ~15 phút.

`ohlc-provider.ts` đã có cache, nhưng là **`Map` in-memory** ([ohlc-provider.ts:85](../../src/charts/ohlc-provider.ts#L85)) — vô dụng giữa các lần chạy GitHub Actions vì mỗi lần chạy là 1 process/VM mới, cache luôn rỗng lúc bắt đầu. Cache hiện có **chỉ hữu ích trong cùng 1 lần chạy** (vd. nếu 2 pair dùng chung symbol/timeframe).

Dự án đã có tiền lệ cache bền vững qua Supabase cho **kết quả phân tích** (`chart_analysis_cache`, [chart-cache-repository.ts](../../src/charts/chart-cache-repository.ts), migration [20260705080001_chart_analysis_cache.sql](../../supabase/migrations/20260705080001_chart_analysis_cache.sql)) — theo đúng pattern upsert/`maybeSingle`/fail-silent. Plan này áp dụng đúng pattern đó cho **dữ liệu nến thô**.

**Quan sát quan trọng cần giữ nguyên:** `isCacheEnabled()` ([ohlc-provider.ts:92-94](../../src/charts/ohlc-provider.ts#L92-L94)) cố ý **loại D1** khỏi cache (`timeframe !== "D1"`) — xác nhận qua test [ohlc-provider.test.ts:149-177](../../tests/charts/ohlc-provider.test.ts#L149-L177) "does not cache D1 results yet while daily close timing is still unverified". Cache bền vững (Supabase) **phải tôn trọng đúng ràng buộc này** — không cache D1, không "sửa luôn" vấn đề D1 timing (ngoài scope).

## Mục tiêu

H4 chỉ thực sự đổi mỗi ~4 tiếng, H1/M30 mỗi 1 tiếng/30 phút — nhưng job chạy lại mỗi 15 phút và luôn fetch mới hoàn toàn vì cache in-memory bị xoá theo mỗi process. Thêm 1 tầng cache **bền vững qua Supabase** cho dữ liệu nến (candles thô), tái dùng đúng "cache entry" (`candles` + `expiresAt`) đang có trong `ohlc-provider.ts`, để các lần chạy sau trong cùng chu kỳ nến HTF **đọc từ Supabase thay vì gọi lại TwelveData**. Kỳ vọng giảm số request TwelveData/lần chạy từ ~32 xuống ~8-10 (chỉ M15 + phần H4/H1/M30 thực sự đã hết hạn), giảm thời gian chờ rate-limit tương ứng.

## Thiết kế

1. **Migration Supabase** (mới): bảng `ohlc_candle_cache` — `cache_key text primary key` (định dạng `"${symbol}:${timeframe}"`, giống `cacheKey()` hiện có ở [ohlc-provider.ts:96-98](../../src/charts/ohlc-provider.ts#L96-L98)), `candles jsonb not null`, `expires_at timestamptz not null`, `created_at timestamptz not null default now()`.

2. **`src/charts/ohlc-cache-repository.ts`** (file mới) — mirror đúng pattern fail-silent của `chart-cache-repository.ts`:
   - `saveOhlcCandleCache(cacheKey: string, candles: Candle[], expiresAtMs: number): Promise<void>` — upsert theo `cache_key`, `try/catch` nuốt lỗi (không crash job).
   - `loadOhlcCandleCache(cacheKey: string): Promise<{ candles: Candle[]; expiresAtMs: number } | null>` — đọc theo `cache_key`, trả `null` nếu không có/lỗi/**đã hết hạn** (so `expires_at` với `Date.now()` ngay trong repo, không trả bản ghi hết hạn).
   - Dùng `import type { Candle } from "./ohlc-provider.js"` (chỉ type, không tạo circular dependency runtime vì `ohlc-provider.ts` sẽ import repo này ở bước 3).

3. **Wire vào `src/charts/ohlc-provider.ts`** (`fetchOhlcHistory`, [ohlc-provider.ts:371-403](../../src/charts/ohlc-provider.ts#L371-L403)):
   - Sau khi in-memory cache miss (dòng 382-385), nếu `isCacheEnabled(timeframe)` → thử `loadOhlcCandleCache(key)`. Nếu hit → **ghi luôn vào in-memory cache** (để các lần gọi tiếp trong cùng process không phải hit DB nữa) rồi return `candles.slice()`.
   - Sau khi fetch TwelveData thành công (dòng 393-401), nếu `isCacheEnabled(timeframe)` → ngoài việc set in-memory cache như hiện tại, gọi thêm `saveOhlcCandleCache(key, result, expiresAt)` (dùng đúng `expiresAt` đã tính bằng `getCacheExpiryMs`, dòng 399).
   - **Không đổi** `isCacheEnabled`, `getCacheExpiryMs`, `cacheKey`, logic D1 — chỉ thêm 2 điểm gọi (đọc trước khi fetch, ghi sau khi fetch).

## Ràng buộc bắt buộc

- **Không cache D1** — giữ nguyên `isCacheEnabled(timeframe) = timeframe !== "D1"`, không sửa hàm này, không thêm cache Supabase cho D1.
- **Không đổi schema/hành vi của `chart_analysis_cache`** (bảng khác, mục đích khác — cache kết quả phân tích, không phải cache nến thô).
- **Không đổi** `smc-pipeline.ts`, `smc-htf-context.ts`, `smc-confluence.ts`, `charts.config.ts`, `analyze-smc.yml` — các thay đổi chỉ nằm ở tầng `ohlc-provider.ts` + repository mới + migration.
- Lỗi Supabase (mất kết nối, bảng chưa tồn tại, v.v.) **không được làm crash** `fetchOhlcHistory` — luôn fail-silent về network TwelveData như bình thường (đúng pattern `chart-cache-repository.ts`).
- Sau mỗi subtask: `npm run build && npm test` phải pass.
- Chạy tuần tự 01 → 02 → 03 → 04.

## Subtasks

| Subtask ID | Mô tả | Owner | Files chính | Dependency | Output kỳ vọng |
|---|---|---|---|---|---|
| [01-ohlc-cache-migration](01-ohlc-cache-migration/task.md) | Viết migration Supabase tạo bảng `ohlc_candle_cache` | worker | `supabase/migrations/<timestamp>_ohlc_candle_cache.sql` (mới) | none | Migration file đúng convention, `create table if not exists` |
| [02-ohlc-cache-repository](02-ohlc-cache-repository/task.md) | Tạo `ohlc-cache-repository.ts` với `save`/`load`, mirror `chart-cache-repository.ts` | worker | `src/charts/ohlc-cache-repository.ts` (mới) | 01 | Repo fail-silent, tự lọc bản ghi hết hạn |
| [03-wire-ohlc-provider](03-wire-ohlc-provider/task.md) | Wire read-through + write-through vào `fetchOhlcHistory`, tôn trọng `isCacheEnabled` (không cache D1) | worker | `src/charts/ohlc-provider.ts` | 02 | Cache hit từ Supabase bỏ qua gọi TwelveData; D1 vẫn không cache |
| [04-tests](04-tests/task.md) | Test cho repository mới + test wiring trong `ohlc-provider.test.ts` | worker | `tests/charts/ohlc-cache-repository.test.ts` (mới), `tests/charts/ohlc-provider.test.ts` (sửa) | 03 | Test cover: cache hit bỏ qua fetch, cache miss ghi vào Supabase, D1 không gọi repo, lỗi Supabase không crash |

## Rủi ro & lưu ý

- **Không đổi rate limit / cron** trong plan này — đây là bước giảm số request cần gọi, không phải tăng ngưỡng rate limit. Nếu sau khi deploy vẫn còn chậm, đó là việc riêng (điều chỉnh `TWELVEDATA_RATE_LIMIT_RPM` hoặc cron), Lead sẽ đánh giá lại sau khi đo runtime thực tế.
- **Multi-pair share HTF context**: các pair khác symbol thì HTF context khác nhau (`cacheKey` theo `symbol:timeframe`), nên cache Supabase chỉ giúp giữa **các lần chạy cron kế tiếp nhau** của cùng 1 symbol/timeframe, không giúp giữa các pair khác nhau trong cùng 1 lần chạy (đã đúng — không có gì để tối ưu thêm ở đây).
- Sau khi cả 4 subtask xong, Lead sẽ đọc lại toàn bộ diff, xác nhận D1 vẫn miss cache 100% (không có gọi Supabase cho D1), và xác nhận `chart_analysis_cache` không bị đụng tới.
