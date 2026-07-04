# Phạm vi review

Thay đổi chưa commit (working tree) — đổi tên 4 file migration để khớp version thật đã áp dụng trên Supabase (fix cho vấn đề Minor ở [reviews/2026-07-04-migration-sync-review.md](2026-07-04-migration-sync-review.md)):
- `supabase/migrations/20260705090000_drop_betting_plan_cache.sql` → `20260704151027_drop_betting_plan_cache.sql`
- `supabase/migrations/20260705090001_drop_unused_logs_indexes.sql` → `20260704151033_drop_unused_logs_indexes.sql`
- `supabase/migrations/20260705090002_drop_unused_ai_usage_index.sql` → `20260704151037_drop_unused_ai_usage_index.sql`
- `supabase/migrations/20260705090003_add_pending_orders_fk_index.sql` → `20260704151042_add_pending_orders_fk_index.sql`

# Tóm tắt

**Critical.** Việc đổi tên đã đúng ý định (khớp version thật với lịch sử migration trên Supabase), nhưng lại tạo ra một lỗi thứ tự nghiêm trọng hơn: file `20260704151027_drop_betting_plan_cache.sql` giờ có timestamp **NHỎ HƠN** file `20260705080002_betting_plan_cache.sql` (file gốc tạo bảng, vẫn còn trong repo). Khi Supabase migration replay theo thứ tự tên file tăng dần từ đầu (ví dụ `supabase db reset`), thứ tự thực thi sẽ là: ... → DROP betting_plan_cache (lúc 15:10:27, bảng chưa tồn tại nên không làm gì) → ... → CREATE betting_plan_cache (lúc 08:00:02 ngày hôm sau theo tên file, tức là chạy SAU) → **bảng `betting_plan_cache` sẽ tồn tại trở lại** trên mọi DB build mới từ migration. Đây đúng là vấn đề gốc ban đầu ("DB mới sẽ khác production") — chỉ khác cách biểu hiện.

# Danh sách vấn đề

### 1. Thứ tự file migration khiến `betting_plan_cache` được tạo lại khi rebuild từ đầu
- **Vị trí:** `supabase/migrations/20260704151027_drop_betting_plan_cache.sql` (DROP) so với `supabase/migrations/20260705080002_betting_plan_cache.sql` (CREATE, đã có sẵn trong repo, không đổi)
- **Mô tả:** Sắp xếp theo tên file tăng dần (thứ tự Supabase CLI dùng để replay migration):
  ```
  ...
  20260704080000_lottery_predictions_add_method_version.sql
  20260704151027_drop_betting_plan_cache.sql        ← DROP (bảng chưa tồn tại → no-op)
  20260704151033_drop_unused_logs_indexes.sql
  20260704151037_drop_unused_ai_usage_index.sql
  20260704151042_add_pending_orders_fk_index.sql
  20260705080000_lottery_draw_status_cache.sql
  20260705080001_chart_analysis_cache.sql
  20260705080002_betting_plan_cache.sql             ← CREATE (chạy SAU, bảng được tạo lại!)
  ```
  Nếu chạy `supabase db reset` hoặc dựng DB mới hoàn toàn từ thư mục `migrations/`, kết quả cuối cùng sẽ có bảng `betting_plan_cache` tồn tại — trái ngược hoàn toàn với trạng thái production hiện tại (đã xoá vĩnh viễn). Việc đổi tên theo version thật (đúng về mặt "khớp lịch sử Supabase remote") đã vô tình phá vỡ tính đúng đắn khi replay từ đầu, vì nó không tính đến vị trí của file CREATE gốc vẫn còn trong repo với timestamp muộn hơn.
- **Mức độ:** Critical — làm DB mới dựng từ migration khác hẳn DB production, đúng loại rủi ro mà cả 2 lần fix trước đều nhắm tới giải quyết.
- **Đề xuất fix:** Chọn 1 trong 2 hướng:
  1. **Xoá hẳn file `20260705080002_betting_plan_cache.sql`** (CREATE gốc) khỏi repo — vì bảng này chưa từng cần thiết cho bất kỳ code nào đang chạy, và production đã không còn bảng này. Xoá file tạo bảng thay vì giữ cặp create/drop mâu thuẫn thứ tự. Cách này đơn giản nhất và phản ánh đúng thực tế: "bảng này chưa bao giờ nên tồn tại lâu dài".
  2. Nếu cần giữ nguyên lịch sử audit (không xoá file cũ), phải đổi tên file DROP sang timestamp **muộn hơn** `20260705080002` (ví dụ `20260705080003_drop_betting_plan_cache.sql`), chấp nhận không khớp 100% với version trên Supabase remote — đánh đổi giữa "khớp remote" và "thứ tự replay đúng". Cần cân nhắc kỹ, có thể cần `supabase migration repair` để đồng bộ lại bảng lịch sử remote cho khớp với tên file mới.
  - Dù chọn hướng nào, **bắt buộc phải test lại bằng cách dựng 1 DB mới hoàn toàn từ migration** (ví dụ Supabase branch mới hoặc `supabase db reset` trên local) và xác nhận bảng `betting_plan_cache` KHÔNG tồn tại sau khi migrate xong, trước khi coi là đã fix.

# Điểm tốt

- Ý định đổi tên đúng đắn — khớp version thật giúp `supabase migration list` không còn báo lệch giữa local/remote cho 4 migration này về mặt định danh.
- Nội dung SQL bên trong từng file vẫn giữ nguyên, đúng và idempotent như đã review ở vòng trước.
