# Mục tiêu

Rà soát toàn bộ 12 bảng trong Supabase project `auto_signal_bot` (irgworcpfyfuigyvylkj), xác định bảng/index dư thừa (không còn được code sử dụng) và index còn thiếu, sau đó lên kế hoạch dọn dẹp tối ưu schema.

# Bối cảnh / Phân tích

Đã dùng Supabase MCP (`list_tables` verbose + `get_advisors` type=performance) để lấy toàn bộ 12 bảng public schema, rồi grep chéo với code trong `src/` và `supabase/functions/` để xác nhận bảng nào thực sự được đọc/ghi.

## Danh sách bảng và kết luận

| Bảng | Rows | Trạng thái | Ghi chú |
|---|---|---|---|
| `lottery_draws` | 7,210 | ✅ Đang dùng | Archive kết quả xổ số chính, dùng bởi `lottery-repository.ts` |
| `matches` | 6 | ✅ Đang dùng | `match-repository.ts` (upsert/prune/read) |
| `lottery_predictions` | 60 | ✅ Đang dùng | `lottery-predictions-repository.ts` |
| `open_positions` | 4 | ✅ Đang dùng | `positions-repository.ts` (forex trading) |
| `pending_orders` | 2 | ✅ Đang dùng | FK tới `open_positions.id`, nhưng **thiếu index cho FK** (xem bên dưới) |
| `logs` | 384 | ✅ Đang dùng (ghi) | `shared/logger.ts` chỉ INSERT khi `warn`/`error`, **không có code nào SELECT lọc theo timestamp/level/source** → 3 index trên bảng này không được dùng |
| `telegram_webhook_idempotency` | 0 | ✅ Đang dùng | Dùng trong `supabase/functions/telegram-webhook/index.ts` + hàm SQL cleanup (`where expires_at < now()` trong migration) — 0 rows chỉ vì chưa có duplicate webhook nào, không phải dead |
| `betting_analysis_snapshots` | 12 | ✅ Đang dùng | Cache phân tích AI 30 phút, `betting-analysis-repository.ts` |
| `ai_usage` | 734 | ✅ Đang dùng | `shared/ai-usage.ts`, nhưng cột `source` chỉ được lọc/gộp **trong bộ nhớ JS** (`aggregateAiUsageByDay`), không có `.eq("source", ...)` nào trong SQL → index `ai_usage_source_idx` không được dùng |
| `chart_analysis_cache` | 1 | ✅ Đang dùng | `chart-cache-repository.ts` |
| `lottery_draw_status_cache` | 6 | ✅ Đang dùng | Cache riêng "đã quay chưa" theo ngày/miền — khác mục đích với `lottery_draws` (archive đầy đủ), không trùng lặp |
| **`betting_plan_cache`** | **0** | ❌ **DEAD — đề xuất xoá** | **0 dòng, 0 tham chiếu code** (`grep betting_plan_cache` trong toàn repo không ra kết quả nào). Là bảng cache cho tính năng "kèo ghép/xiên" (parlay) đã bị gỡ bỏ ở commit `e1f95b3` ("Refactor and cleanup: Remove obsolete plans..."). Các type liên quan (`BettingPlan`, `BettingParlay`, `BettingPlanSingle`, `BettingPlanMatch`, `BettingPlanPick` trong `betting-types.ts`) cũng không còn được dùng ở đâu khác — dead type. |

## Advisor (performance) đã xác nhận

- `pending_orders_triggered_position_id_fkey` — **thiếu index** cho FK → cần bổ sung (ngược lại với dư thừa, đây là thiếu).
- `logs_timestamp_idx`, `logs_level_idx`, `logs_source_idx` — unused (khớp với phân tích code ở trên).
- `idx_betting_plan_cache_created_at` — unused (bảng dead, sẽ mất theo khi xoá bảng).
- `telegram_webhook_idempotency_expires_at_idx` — advisor báo unused nhưng **là false positive**: index này được dùng trong hàm SQL cleanup nội bộ migration, chỉ chưa "unused" vì bảng có 0 dòng nên chưa từng chạy — **giữ nguyên**.
- `ai_usage_source_idx` — unused (khớp phân tích code ở trên).

# Các bước thực hiện

1. **Xoá bảng dead `betting_plan_cache`**
   - Viết migration mới `supabase/migrations/<timestamp>_drop_betting_plan_cache.sql`: `DROP TABLE IF EXISTS public.betting_plan_cache;` (index đi kèm tự động bị xoá theo).
   - Áp dụng qua `apply_migration` (Supabase MCP) sau khi user xác nhận.

2. **Dọn dead types liên quan trong code** (tuỳ chọn, đi kèm bước 1 để nhất quán)
   - Xoá `BettingPlan`, `BettingPlanMatch`, `BettingParlay`, `BettingParlayLeg`, `BettingPlanSingle`, `BettingPlanPick` khỏi `src/betting/betting-types.ts` nếu xác nhận không còn dùng ở test nào (`grep -r "BettingPlan" tests/`).

3. **Xoá 2 index không dùng trên `logs`**
   - `DROP INDEX IF EXISTS logs_timestamp_idx;`
   - `DROP INDEX IF EXISTS logs_level_idx;`
   - Giữ lại `logs_source_idx` HOẶC xoá luôn nếu xác nhận không ai query dashboard theo `source` — **cần hỏi user trước vì đây có thể là index dùng khi debug thủ công qua Supabase Studio, code không phản ánh hết mọi cách dùng**.

4. **Xoá index không dùng `ai_usage_source_idx`**
   - `DROP INDEX IF EXISTS ai_usage_source_idx;`
   - An toàn vì đã xác nhận code chỉ gộp theo `source` trong JS, không bao giờ query SQL theo cột này.

5. **Bổ sung index còn thiếu cho `pending_orders.triggered_position_id`**
   - `CREATE INDEX IF NOT EXISTS pending_orders_triggered_position_id_idx ON public.pending_orders (triggered_position_id);`
   - Giải quyết cảnh báo `unindexed_foreign_keys` từ advisor.

6. **Giữ nguyên, không đụng tới:**
   - `telegram_webhook_idempotency` và index `expires_at` (đã xác nhận đang dùng qua edge function + cleanup SQL).
   - `lottery_draw_status_cache` (mục đích khác biệt rõ với `lottery_draws`, không trùng lặp).

7. **Chạy lại `get_advisors(type=performance)`** sau khi áp dụng migration để xác nhận các cảnh báo cũ đã biến mất và không phát sinh cảnh báo mới.

# Rủi ro / Lưu ý

- **`betting_plan_cache` xoá là an toàn** vì 0 dòng dữ liệu và 0 tham chiếu code — nhưng nên double-check bằng `grep -r "betting_plan" .` lần cuối ngay trước khi chạy migration, đề phòng nhánh/branch khác hoặc script ngoài `src/` (ví dụ cron ngoài repo) còn dùng.
- **Index `logs_source_idx`**: khác với 2 index kia, cột `source` trên bảng `logs` là cột hay dùng để lọc log thủ công khi debug qua Supabase Studio (không phải qua code app) — nên hỏi user xác nhận trước khi xoá, tránh làm chậm việc debug sau này.
- **`telegram_webhook_idempotency_expires_at_idx`**: KHÔNG xoá dù advisor báo unused — đã xác minh có dùng trong logic cleanup nội bộ, false positive do bảng chưa có dữ liệu thực tế.
- Migration `DROP TABLE`/`DROP INDEX` là thao tác không thể hoàn tác dễ dàng (mất dữ liệu nếu có) — dù bảng đang 0 dòng, vẫn cần user xác nhận rõ ràng trước khi `apply_migration` chạy thật (không tự động thực thi).

# Tiêu chí hoàn thành

1. Bảng `betting_plan_cache` không còn tồn tại trong `list_tables`.
2. `get_advisors(type=performance)` không còn báo `unused_index` cho `logs_timestamp_idx`, `logs_level_idx`, `ai_usage_source_idx` (và `logs_source_idx` nếu user đồng ý xoá).
3. `get_advisors(type=performance)` không còn báo `unindexed_foreign_keys` cho `pending_orders`.
4. `npx tsc --noEmit` và `npx vitest run` vẫn pass sau khi xoá dead types (nếu thực hiện bước 2).
5. Không có lỗi runtime nào liên quan đến bảng/index đã xoá khi chạy thử các luồng chính (betting, lottery, logging).
