# Phạm vi review

Commit `c55313c` — "chore: Sync Supabase migrations to repo" (fix cho vấn đề Major đã nêu ở [reviews/2026-07-04-supabase-schema-optimization-review.md](2026-07-04-supabase-schema-optimization-review.md)):
- `supabase/migrations/20260705090000_drop_betting_plan_cache.sql`
- `supabase/migrations/20260705090001_drop_unused_logs_indexes.sql`
- `supabase/migrations/20260705090002_drop_unused_ai_usage_index.sql`
- `supabase/migrations/20260705090003_add_pending_orders_fk_index.sql`
- `CLAUDE.md` (thêm rule)

# Tóm tắt

**Minor.** Nội dung SQL của cả 4 file khớp đúng với DDL đã áp dụng thật trên Supabase, và thứ tự file (sau `20260705080002_betting_plan_cache.sql` — file tạo bảng gốc) đảm bảo `supabase db reset` sẽ tạo bảng rồi xoá đúng thứ tự, không lỗi. Tuy nhiên vẫn còn 1 điểm chưa hoàn toàn "đồng bộ": **timestamp trong tên file không khớp với version migration thực tế đã ghi nhận trên Supabase**, nên đây là "sync về mặt schema" chứ chưa phải "sync về mặt version lịch sử".

# Danh sách vấn đề

### 1. Timestamp tên file migration không khớp version đã áp dụng trên Supabase
- **Vị trí:** `supabase/migrations/20260705090000_drop_betting_plan_cache.sql` và 3 file còn lại
- **Mô tả:** Theo `list_migrations` trên Supabase, 4 migration đã áp dụng thật có version là `20260704151027`, `20260704151033`, `20260704151037`, `20260704151042` (ngày 04/07, 15:10). Nhưng 4 file mới thêm vào repo lại đặt timestamp `20260705090000`–`20260705090003` (ngày 05/07, 09:00) — khác hoàn toàn version đã ghi trong bảng lịch sử migration nội bộ của Supabase (`supabase_migrations.schema_migrations`).
  Hệ quả: nội dung SQL đã khớp (nên schema tạo ra từ `supabase db reset` sẽ đúng), nhưng nếu sau này dùng Supabase CLI để đối chiếu (`supabase migration list` hoặc `supabase db push`), CLI sẽ thấy 4 version "mới" trong repo (`20260705090000`...) không tồn tại trong lịch sử remote, và cố áp dụng lại chúng — dù có `IF EXISTS`/`IF NOT EXISTS` nên sẽ không lỗi crash, nhưng remote sẽ ghi nhận thêm 4 dòng version trùng lặp về mặt hiệu ứng (khác định danh) trong bảng lịch sử migration, gây khó theo dõi lịch sử thực về sau.
- **Mức độ:** Minor (không gây lỗi vận hành nhờ guard `IF EXISTS`, nhưng chưa giải quyết triệt để mục tiêu "khớp lịch sử migration")
- **Đề xuất fix:** Đổi tên 4 file để timestamp khớp đúng version đã áp dụng: `20260704151027_drop_betting_plan_cache.sql`, `20260704151033_drop_unused_logs_indexes.sql`, `20260704151037_drop_unused_ai_usage_index.sql`, `20260704151042_add_pending_orders_fk_index.sql`. Lưu ý: cần kiểm tra thứ tự — version `20260704151027` sớm hơn `20260705080002_betting_plan_cache.sql` (file tạo bảng gốc, timestamp 05/07 08:00) trong repo hiện tại, nên nếu đổi tên đúng version thật, thứ tự file sẽ đảo ngược (drop chạy trước create khi rebuild từ đầu) — cần rà lại toàn bộ thứ tự migration hoặc xác nhận với Supabase CLI bằng lệnh `supabase migration repair`/`db pull` thay vì tự đặt tên thủ công.

# Điểm tốt

- Nội dung SQL của cả 4 migration mới đúng 100% với DDL đã áp dụng thật (đối chiếu với mô tả trong commit `4ec09bf` và kết quả `list_migrations`/`get_advisors` tôi tự kiểm tra độc lập).
- Dùng `DROP TABLE IF EXISTS ... CASCADE`, `DROP INDEX IF EXISTS`, `CREATE INDEX IF NOT EXISTS` — tất cả đều idempotent, an toàn khi chạy lại nhiều lần hoặc trên môi trường đã có/chưa có object đó.
- Có comment giải thích rõ lý do xoá/thêm từng index — hữu ích cho người đọc sau này hiểu quyết định mà không cần lục lại review/plan.
- Đã xử lý đúng phần cốt lõi của vấn đề Major trước đó (schema sẽ khớp khi rebuild từ migration), chỉ còn phần "định danh version" cần tinh chỉnh thêm.
