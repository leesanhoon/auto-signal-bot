# Task 01 — Backfill result.md cho round 2 (8 subtask)

## Yêu cầu

Với MỖI subtask trong `tasks/fix-review-round2-findings/` (8 cái:
`01-fix-sb-backtest-disabled`, `02-fix-irb-fallback-test-mock`,
`03-verify-metaapi-complete-field`, `04-fix-twelvedata-weekend-heuristic`,
`05-harden-gettwelvedataintervalms`, `06-detectcompression-runtime-guard`,
`07-dedupe-candle-parsing`, `08-dedupe-irb-fallback-blocks`):

1. Đọc `task.md` của subtask đó — hiểu yêu cầu gốc.
2. Xác định code liên quan HIỆN TẠI trong repo (dùng `git log --all -p --
   <file>` nếu cần xem lịch sử, hoặc chỉ cần đọc code hiện tại nếu đủ rõ) có
   khớp với yêu cầu hay không. Lưu ý: 1 số thay đổi có thể đã bị GHI ĐÈ hoàn
   toàn bởi các round sau (đặc biệt `01-fix-sb-backtest-disabled` liên quan
   tới `setup-backtest.ts` — file này đã được redesign lại nhiều lần ở round
   3/4/5, nên kết quả round 2 có thể KHÔNG còn tồn tại nguyên trạng trong
   code hiện tại).
3. Viết `result.md` trong đúng thư mục subtask, mô tả THỰC TẾ đã xảy ra:
   - Nếu code hiện tại vẫn phản ánh đúng yêu cầu: mô tả thay đổi cụ thể
     (dòng nào, file nào).
   - Nếu đã bị ghi đè bởi round sau: ghi rõ "Yêu cầu ban đầu đã được thực
     hiện nhưng sau đó bị thay thế hoàn toàn bởi [tên round/subtask sau] do
     [lý do, ví dụ: tìm thấy bug mới trong cùng vùng code]."

## KHÔNG làm

- Không sửa bất kỳ file code nào (`src/`, `tests/`).
- Không tự bịa nội dung `result.md` nếu không xác nhận được — nếu không chắc
  chắn, ghi rõ "không xác định được chắc chắn, cần Lead xác nhận thêm" thay
  vì đoán.

## Ghi kết quả

Viết `result.md` cho TỪNG subtask (8 file). Sau khi xong cả 8, viết thêm 1
file tổng hợp `tasks/backfill-missing-results/01-backfill-round2/result.md`
liệt kê: đã viết xong 8/8, có bao nhiêu cái phải ghi "đã bị ghi đè" (nếu có).
