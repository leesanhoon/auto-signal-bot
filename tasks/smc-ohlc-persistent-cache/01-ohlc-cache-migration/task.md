# Task 01: Migration Supabase — bảng `ohlc_candle_cache`

## Bối cảnh

Dự án cache dữ liệu nến OHLC (TwelveData) chỉ trong bộ nhớ (`Map` trong `src/charts/ohlc-provider.ts`), nên mỗi lần GitHub Actions chạy job SMC (VM/process mới) đều mất cache và phải gọi lại TwelveData API cho tất cả timeframe. Task này (01/04) chỉ tạo migration SQL cho bảng cache mới — KHÔNG viết code TypeScript, KHÔNG sửa file nào khác.

## Việc cần làm

Tạo file migration mới tại `supabase/migrations/20260710000000_ohlc_candle_cache.sql` với nội dung sau (copy chính xác):

```sql
create table if not exists public.ohlc_candle_cache (
  cache_key text primary key,
  candles jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

## Tham khảo convention

Xem file migration tương tự đã có trong repo: `supabase/migrations/20260705080001_chart_analysis_cache.sql` — nội dung:

```sql
create table if not exists public.chart_analysis_cache (
  candle_key text primary key,
  result jsonb not null,
  created_at timestamptz not null default now()
);
```

Migration mới của bạn theo đúng style này (lowercase, `create table if not exists`, không thêm index/RLS/comment gì thêm).

## Ràng buộc

- KHÔNG sửa `supabase/migrations/20260705080001_chart_analysis_cache.sql` hay bất kỳ migration nào khác.
- KHÔNG tạo file TypeScript nào ở task này (repository sẽ làm ở task 02).
- Tên file PHẢI đúng: `20260710000000_ohlc_candle_cache.sql`.
- Không thêm feature ngoài scope (không RLS policy, không trigger, không index phụ).

## Cách verify

- File tồn tại đúng path, đúng nội dung SQL như trên.
- `npm run build && npm test` vẫn pass (migration SQL không ảnh hưởng build/test TypeScript, chỉ cần xác nhận không có gì vỡ).

## Output

Ghi kết quả vào `tasks/smc-ohlc-persistent-cache/01-ohlc-cache-migration/result.md`:
- Đường dẫn file đã tạo
- Nội dung file (paste lại)
- Kết quả `npm run build && npm test`

Nếu bị chặn (vd. không biết timestamp nào là "mới nhất" trong `supabase/migrations/`) → ghi `blocked.md`, không tự đoán, không đổi tên file khác với yêu cầu.
