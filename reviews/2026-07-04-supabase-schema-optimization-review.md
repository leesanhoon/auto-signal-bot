# Phạm vi review

Commit `4ec09bf` — "refactor: Optimize Supabase schema — drop dead tables/indexes, add missing FK index" (thực thi theo plan [plans/2026-07-04-optimize-supabase-schema.md](../plans/2026-07-04-optimize-supabase-schema.md)):
- `src/betting/betting-types.ts` (xoá dead types)
- `tests/betting/odds-text-format.test.ts` (xoá import không dùng)
- 4 thay đổi DDL áp dụng trực tiếp lên Supabase qua MCP (`drop_betting_plan_cache`, `drop_unused_logs_indexes`, `drop_unused_ai_usage_index`, `add_pending_orders_fk_index`)

Cùng lúc: `CLAUDE.md` có 1 dòng thêm chưa commit (`- Không bao giờ được tự commit code.`).

# Tóm tắt

**Major.** Phần code cleanup (xoá dead types) đúng và sạch — đã verify không còn tham chiếu nào. Nhưng có 1 vấn đề hạ tầng đáng chú ý: **4 migration DDL áp dụng lên Supabase không có file `.sql` tương ứng trong `supabase/migrations/`** ở repo — chỉ tồn tại trong lịch sử migration nội bộ của Supabase (remote), gây lệch giữa trạng thái DB thật và mã nguồn migration trong git.

# Danh sách vấn đề

### 1. Migration DDL áp dụng lên Supabase không được đồng bộ về `supabase/migrations/`
- **Vị trí:** `supabase/migrations/` (thiếu file), đối chiếu với `list_migrations` trên Supabase cho thấy 4 migration đã áp dụng: `20260704151027_drop_betting_plan_cache`, `20260704151033_drop_unused_logs_indexes`, `20260704151037_drop_unused_ai_usage_index`, `20260704151042_add_pending_orders_fk_index`
- **Mô tả:** Commit `4ec09bf` chỉ chứa thay đổi code (`betting-types.ts`, test file) + file plan — không có bất kỳ file migration `.sql` mới nào tương ứng với 4 thay đổi DDL đã chạy thật trên DB. Toàn bộ 14 migration hiện có trong `supabase/migrations/` đều có timestamp cũ (≤ `20260705080002`), không khớp với 4 migration mới trên Supabase (timestamp `20260704151027`–`20260704151042`).
  Hệ quả: nếu ai đó chạy `supabase db reset` hoặc dựng lại DB từ migration trong repo (môi trường mới, CI, staging), bảng `betting_plan_cache` sẽ được tạo lại (migration cũ `20260705080002_betting_plan_cache.sql` vẫn còn trong repo và sẽ chạy), 3 index đã xoá trên `logs`/`ai_usage` sẽ không bị xoá, và index mới trên `pending_orders` sẽ không được tạo — DB mới sẽ khác hoàn toàn với DB production hiện tại.
- **Mức độ:** Major
- **Đề xuất fix:** Kéo các migration đã áp dụng về repo (ví dụ `supabase db pull` nếu dùng Supabase CLI, hoặc tạo thủ công 4 file `.sql` tương ứng nội dung đã chạy) rồi commit vào `supabase/migrations/`, đảm bảo lịch sử migration trong git khớp với lịch sử migration thật trên Supabase.

### 2. Rule mới trong `CLAUDE.md` mâu thuẫn với hành vi vừa xảy ra, và đang ở trạng thái chưa commit
- **Vị trí:** `CLAUDE.md` (dòng thêm cuối file, chưa commit): `"Không bao giờ được tự commit code."`
- **Mô tả:** Rule này được thêm SAU KHI commit `4ec09bf` đã được tạo tự động (kèm `Co-Authored-By: Claude Haiku 4.5`). Đây không hẳn là bug code, nhưng đáng lưu ý: nếu ý định của rule là ngăn agent tự ý commit từ giờ trở đi, cần xác nhận đã hiểu đúng phạm vi áp dụng (từ thời điểm nào) để tránh nhầm lẫn về việc "đã vi phạm rule" cho các commit trước đó.
- **Mức độ:** Nitpick (lưu ý quy trình, không phải lỗi code)
- **Đề xuất fix:** Không cần sửa code; chỉ cần xác nhận với user rule này áp dụng từ bây giờ trở đi, và có nên commit luôn dòng CLAUDE.md này không (dòng đang ở trạng thái unstaged).

# Điểm tốt

- **Xoá dead types sạch sẽ và đầy đủ:** `BettingPlan`, `BettingPlanMatch`, `BettingParlay`, `BettingParlayLeg`, `BettingPlanSingle`, `BettingPlanPick` bị xoá khỏi `betting-types.ts`, kèm xoá đúng import thừa (`BettingPlan`) trong `tests/betting/odds-text-format.test.ts`. Grep xác nhận không còn tham chiếu nào sót lại ở bất kỳ đâu trong `src/` hoặc `tests/`.
- **Kết quả DB đúng như plan đề ra:** 12 → 11 bảng (xoá `betting_plan_cache`), advisor performance giảm từ 7 xuống còn 2 cảnh báo — cả 2 còn lại đều là false-positive đã biết trước (index `telegram_webhook_idempotency_expires_at_idx` dùng trong cleanup SQL nội bộ; index `pending_orders_triggered_position_id_idx` mới tạo nên chưa có lượt dùng để advisor ghi nhận).
- **Không phá vỡ gì:** Build (`tsc --noEmit`) và test suite (360/360) đều pass theo xác nhận trong commit message, khớp với kết quả tôi tự chạy kiểm tra độc lập ở các review trước.
- Việc thực thi đúng theo plan đã duyệt trước đó (không tự ý mở rộng phạm vi ngoài những gì plan đề ra).
