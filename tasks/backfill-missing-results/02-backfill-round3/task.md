# Task 02 — Backfill result.md cho round 3 (5 subtask)

## Yêu cầu

Với MỖI subtask trong `tasks/fix-review-round3-findings/` (5 cái:
`01-fix-sb-lookahead-bias`, `02-fix-uncaught-timeframe-throws`,
`03-dedupe-timeframe-switches`, `04-dedupe-fetch-retry-pattern`,
`05-dedupe-irb-fallback-scaffolding`):

1. Đọc `task.md` của subtask đó — hiểu yêu cầu gốc.
2. Đối chiếu với code HIỆN TẠI trong repo. Lưu ý đặc biệt:
   `01-fix-sb-lookahead-bias` liên quan `setup-backtest.ts` — file này đã bị
   redesign lại ở round 4 và round 5 SAU đó, nên cách fix cụ thể của round 3
   (dùng pending-queue hoãn TẤT CẢ signal 2 nến) đã bị THAY THẾ HOÀN TOÀN —
   ghi rõ điều này thay vì mô tả code không còn tồn tại.
3. Viết `result.md` trong đúng thư mục subtask.

## KHÔNG làm

- Không sửa code.
- Không bịa nội dung — nếu không chắc, ghi rõ cần Lead xác nhận thêm.

## Ghi kết quả

Viết `result.md` cho từng subtask (5 file), cộng 1 file tổng hợp
`tasks/backfill-missing-results/02-backfill-round3/result.md`.
