# Task 03 — Backfill result.md cho round 4 (5 subtask)

## Yêu cầu

Với MỖI subtask trong `tasks/fix-review-round4-findings/` (5 cái:
`01-redesign-backtest-pending-queue`, `02-verify-irb-fallback-window-change`,
`03-consolidate-sb-duplication`, `04-complete-fetchjson-dedup`,
`05-clean-irb-dead-branch`):

1. Đọc `task.md` của subtask đó — hiểu yêu cầu gốc.
2. Đối chiếu với code HIỆN TẠI trong repo. Lưu ý đặc biệt:
   `01-redesign-backtest-pending-queue` liên quan `setup-backtest.ts` — file
   này đã bị redesign lại LẦN NỮA ở round 5 (do round 4 tạo ra regression
   nghiêm trọng: mất invariant không chồng lệnh, double-counting) — ghi rõ
   round 4's cách tiếp cận đã bị THAY THẾ HOÀN TOÀN bởi round 5, kèm tóm tắt
   ngắn gọn lý do (đọc `tasks/fix-review-round5-findings/plan.md` để biết
   context).
3. Viết `result.md` trong đúng thư mục subtask.

## KHÔNG làm

- Không sửa code.
- Không bịa nội dung — nếu không chắc, ghi rõ cần Lead xác nhận thêm.

## Ghi kết quả

Viết `result.md` cho từng subtask (5 file), cộng 1 file tổng hợp
`tasks/backfill-missing-results/03-backfill-round4/result.md`.
