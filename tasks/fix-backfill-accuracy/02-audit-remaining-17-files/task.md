# Task 02 — Audit 17 file result.md backfill còn lại, loại bỏ khẳng định thời điểm không verify được (MEDIUM)

## Vấn đề gốc

Toàn bộ 18 subtask của round 2/3/4 nằm chung 1 working tree diff so với
HEAD gốc — KHÔNG có git commit nào tách biệt giữa các round. Nghĩa là
KHÔNG THỂ dùng `git log`/`git blame` để xác minh chính xác "thay đổi X xảy
ra ở round mấy". Đã xác nhận 1 file cụ thể (round2/02, xem task 01 trong
queue này) bị ghi SAI thời điểm ("round 6") vì worker đoán thay vì thừa
nhận không xác minh được.

## Yêu cầu

Đọc lại 17 file `result.md` còn lại (trừ `round2/02` đã sửa ở task 01):

- 7 file còn lại của round 2: `01-fix-sb-backtest-disabled`,
  `03-verify-metaapi-complete-field`, `04-fix-twelvedata-weekend-heuristic`,
  `05-harden-gettwelvedataintervalms`, `06-detectcompression-runtime-guard`,
  `07-dedupe-candle-parsing`, `08-dedupe-irb-fallback-blocks`
- 5 file round 3: `01-fix-sb-lookahead-bias`,
  `02-fix-uncaught-timeframe-throws`, `03-dedupe-timeframe-switches`,
  `04-dedupe-fetch-retry-pattern`, `05-dedupe-irb-fallback-scaffolding`
- 5 file round 4: `01-redesign-backtest-pending-queue`,
  `02-verify-irb-fallback-window-change`, `03-consolidate-sb-duplication`,
  `04-complete-fetchjson-dedup`, `05-clean-irb-dead-branch`

Với MỖI file, tìm và loại bỏ/sửa lại BẤT KỲ câu nào khẳng định "việc này xảy
ra ở round N" hoặc "được thay thế/sửa ở round N sau đó" MÀ KHÔNG CÓ CĂN CỨ
XÁC THỰC (git commit, hoặc trích dẫn cụ thể nội dung review đã ghi trong
chính task.md/plan.md của round liên quan — CHỈ tin những gì có trong các
file `.md` đã tồn tại sẵn trong `tasks/`, KHÔNG tự đoán).

Cách sửa: đổi khẳng định thời điểm cụ thể thành mô tả TRUNG TÍNH hơn, ví dụ:
- SAI: "Đã được sửa lại ở round 5."
- ĐÚNG (nếu không chắc): "Code liên quan hiện tại KHÁC với mô tả trong
  task.md gốc — có thể đã được điều chỉnh ở 1 round sau, không xác định
  được chính xác round nào do không có git history tách biệt giữa các
  round."

NẾU tìm thấy bằng chứng CỤ THỂ (ví dụ: task.md của 1 subtask round sau TRÍCH
DẪN NGUYÊN VĂN dòng code/vấn đề từ subtask đang audit — như cách round 4 và
5 đã làm khi mô tả regression từ round trước) — được phép giữ khẳng định
thời điểm, NHƯNG PHẢI trích dẫn rõ nguồn (đường dẫn file + đoạn trích) trong
chính `result.md` đó để người đọc sau tự kiểm chứng được.

## KHÔNG làm

- Không sửa code.
- Không tự đoán thêm thông tin mới không có căn cứ — mục tiêu là làm tài
  liệu TRUNG THỰC hơn, không phải đầy đủ hơn bằng cách bịa thêm.

## Ghi kết quả

`result.md` trong `tasks/fix-backfill-accuracy/02-audit-remaining-17-files/`:
liệt kê 17 file đã audit, bao nhiêu file có sửa (và sửa gì), bao nhiêu file
giữ nguyên (vì đã đủ căn cứ hoặc không có khẳng định thời điểm nào cần sửa).
