# Plan — Fix 8 findings from code review of Twelve Data + Volman off-by-one fix

## Context

Sau khi thêm Twelve Data provider và fix bug off-by-one ở 5 setup detector
(xem `tasks/fix-volman-compression-bug/`), một review 8-angle (medium effort)
trên toàn bộ diff phát hiện 8 vấn đề — phần lớn đã xác nhận trực tiếp (gọi API
thật, `git show HEAD`, đọc code), không phải suy đoán. 4 vấn đề đầu là
correctness bug nghiêm trọng (dữ liệu sai hoặc mất tín hiệu ngầm không báo
lỗi); còn lại là reuse/robustness.

## Subtasks (độc lập, có thể giao song song cho nhiều worker)

- `01-fix-twelvedata-timezone/` — **CRITICAL**: timestamp Twelve Data sai ~10h
- `02-restore-completed-candle-filter/` — **CRITICAL**: mất filter loại nến chưa đóng
- `03-fix-sb-boundary-regression/` — **HIGH**: SB mất tín hiệu ở boundary real-time
- `04-fix-ratelimit-use-shared-helper/` — **HIGH**: rate limiter tự viết bị lỗi + nên dùng lại helper có sẵn
- `05-fix-irb-dead-fallback/` — **MEDIUM**: nhánh fallback IRB không bao giờ chạy được
- `06-tag-cache-by-provider/` — **MEDIUM**: cache không phân biệt nguồn dữ liệu
- `07-harden-detectcompression-contract/` — **LOW**: ngăn bug off-by-one tái diễn

## Thứ tự khuyến nghị

01, 02, 03, 04 nên làm trước (correctness, ảnh hưởng dữ liệu/tín hiệu thật).
05, 06, 07 có thể làm sau, không block việc dùng hệ thống.

Mỗi subtask độc lập với nhau (không phụ thuộc lẫn nhau), có thể giao cho
nhiều worker chạy song song.

## Verification chung

Sau khi TẤT CẢ subtask xong:
```bash
npm run build
npm run test -- --run
```
Toàn bộ phải pass. Lead sẽ tự chạy lại backtest thật (cần Twelve Data API key)
để xác nhận số liệu thay đổi đúng hướng — worker không cần làm việc đó.
