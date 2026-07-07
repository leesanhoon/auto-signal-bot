# Plan — Backfill result.md còn thiếu cho round 2, 3, 4

## Context

3 task queue (`fix-review-round2-findings`, `fix-review-round3-findings`,
`fix-review-round4-findings`, tổng 18 subtask) đã có code thực sự được áp
dụng vào working tree (đã xác nhận qua review code trực tiếp nhiều lần sau
đó — `npm run build` sạch, `npm run test -- --run` pass 573 test), nhưng
KHÔNG có `result.md` nào được ghi lại theo đúng quy trình trong CLAUDE.md.
Đây thuần túy là backfill tài liệu (documentation), KHÔNG phải sửa code.

## 3 subtask (1 subtask = 1 round)

- `01-backfill-round2/` — viết `result.md` cho 8 subtask trong
  `tasks/fix-review-round2-findings/`
- `02-backfill-round3/` — viết `result.md` cho 5 subtask trong
  `tasks/fix-review-round3-findings/`
- `03-backfill-round4/` — viết `result.md` cho 5 subtask trong
  `tasks/fix-review-round4-findings/`

Có thể giao song song cho 3 worker khác nhau (không phụ thuộc lẫn nhau).

## Nguyên tắc chung cho cả 3 subtask

- **KHÔNG sửa code** — chỉ đọc code HIỆN TẠI (đã đúng, đã qua nhiều vòng
  review sau đó) và code tại thời điểm round đó áp dụng (dùng `git log -p`
  hoặc so sánh với task.md gốc) để viết lại `result.md` mô tả ĐÚNG những gì
  đã được làm.
- Với mỗi subtask, đọc `task.md` để biết yêu cầu gốc, rồi đối chiếu với code
  hiện tại (hoặc tìm trong lịch sử các round review sau — nhiều finding của
  round N+1 đã trích dẫn chính xác dòng code do round N tạo ra, có thể dùng
  làm bằng chứng) để xác nhận yêu cầu đó đã được thực hiện đúng hay không.
- Nếu 1 subtask hóa ra KHÔNG được thực hiện đúng như task.md yêu cầu (ví dụ
  do bị 1 round sau ghi đè/sửa lại hoàn toàn) — ghi rõ trong `result.md`
  "yêu cầu ban đầu đã bị thay thế bởi round X" thay vì bịa ra là đã làm đúng.
- Format `result.md` giống các subtask khác đã có (xem ví dụ ở
  `tasks/fix-ohlc-review-findings/01-fix-twelvedata-timezone/result.md`).

## Verification

Không cần chạy build/test (không sửa code) — chỉ cần đối chiếu nội dung
`result.md` mới viết với code thực tế đang có trong repo là chính xác.
