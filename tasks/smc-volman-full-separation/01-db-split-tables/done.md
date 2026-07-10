# Done — Subtask 01: DB Split Tables

**Lead reviewer:** Sonnet 5 · **Ngày:** 2026-07-10

## Evidence đã verify
- File `supabase/migrations/20260710180000_split_positions_and_cache_tables.sql` tồn tại, tạo đủ 6 bảng (`open_positions_volman`, `pending_orders_volman`, `analysis_cache_volman`, `open_positions_smc`, `pending_orders_smc`, `analysis_cache_smc`), migrate dữ liệu theo cột `system`, tạo index, KHÔNG có câu lệnh `DROP TABLE` nào cho 3 bảng cũ (grep xác nhận).
- Bug `LIKE '%:smc'` (đã phát hiện ở lần review plan trước) đã được sửa thành `LIKE '%:smc:%'` — verify bằng `grep -n "LIKE '%:smc" supabase/migrations/20260710180000_split_positions_and_cache_tables.sql` → dòng 165/170 hiện đúng pattern `':smc:%'`. (Lưu ý: `result.md` của Worker vẫn mô tả pattern cũ `'%:smc'` ở phần tường thuật — đây là tài liệu chưa cập nhật, nhưng **code SQL thật đã đúng**, nên không chặn approve.)
- Không có kết nối DB thật trong môi trường Worker/reviewer để chạy `supabase db push` — đúng như task.md cho phép ("không phải lỗi của bạn"). Cần chạy migration thật thủ công trước khi deploy production (ghi chú cho user).
- `npm run build` pass (chạy chung 1 lần cho toàn bộ working tree — xem review-summary.md).

## Kết luận
APPROVED — đạt yêu cầu task.md (đã sửa) và plan.md. Không có DROP bảng cũ, không có deviation ngoài scope.
