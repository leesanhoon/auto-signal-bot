# Plan — Fix 8 findings từ review vòng 2 (sau khi áp dụng fix-ohlc-review-findings)

## Context

Sau khi worker fix xong 7 finding ở `tasks/fix-ohlc-review-findings/`, review lại
(8-angle, medium effort) trên diff mới phát hiện 8 vấn đề tiếp theo — trong đó có
1 vấn đề **CRITICAL**: fix SB boundary (task 03 vòng trước) vô tình làm SB
**không bao giờ ra tín hiệu trong backtest nữa** (0 lệnh vĩnh viễn), ngược hẳn với
giả định ghi trong task đó. Đây là bug mới nghiêm trọng hơn bug cũ, cần fix trước
khi tin tưởng số liệu backtest.

## Subtasks (độc lập, có thể giao song song)

- `01-fix-sb-backtest-disabled/` — **CRITICAL**: SB detection chết hẳn trong backtest
- `02-fix-irb-fallback-test-mock/` — **HIGH**: test IRB mock chính hàm cần test
- `03-verify-metaapi-complete-field/` — **HIGH**: filter nến MetaApi có thể là dead code
- `04-fix-twelvedata-weekend-heuristic/` — **MEDIUM**: heuristic nến "đang hình thành" sai gần cuối tuần
- `05-harden-gettwelvedataintervalms/` — **MEDIUM**: thiếu default case, có thể silent NaN
- `06-detectcompression-runtime-guard/` — **LOW**: JSDoc không đủ ngăn bug tái diễn
- `07-dedupe-candle-parsing/` — **LOW**: trùng lặp logic parse OHLCV + switch timeframe
- `08-dedupe-irb-fallback-blocks/` — **LOW**: 2 nhánh LONG/SHORT IRB copy-paste

## Thứ tự khuyến nghị

01 làm TRƯỚC TIÊN — đây là regression nghiêm trọng nhất, ảnh hưởng trực tiếp đến
độ tin cậy của mọi số liệu backtest từ giờ trở đi. 02, 03 làm tiếp theo (test
coverage giả + có thể còn bug MetaApi chưa fix thật). 04-08 có thể làm sau,
không block sử dụng hệ thống.

Mỗi subtask độc lập, có thể giao nhiều worker chạy song song — trừ 01 và 02 nên
ưu tiên trước vì ảnh hưởng đến việc tin tưởng kết quả backtest/test suite.

## Verification chung

Sau khi TẤT CẢ subtask xong:
```bash
npm run build
npm run test -- --run
```
Toàn bộ phải pass. Sau đó Lead sẽ tự chạy `npm run backtest:setups` (H4 và M15,
cần Twelve Data API key thật) để xác nhận SB thực sự ra tín hiệu trở lại trong
backtest — worker không cần tự chạy backtest thật.
