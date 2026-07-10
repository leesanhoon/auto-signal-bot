# Task 01: Chạy 4 pinned window mới (M15 + H4)

Không sửa file src nào — chỉ chạy lệnh có sẵn (`npm run backtest:smc` với env vars) và lưu output. KHÔNG commit.

## Việc cần làm

Chạy 8 lệnh sau (4 window × 2 timeframe), mỗi lệnh lưu output ra file JSON trong thư mục `tasks/smc-multi-window-validation/01-run-additional-windows/`. Dùng `BACKTEST_BARS=1000` cho mọi lệnh.

```powershell
$env:BACKTEST_BARS="1000"

$env:BACKTEST_TIMEFRAME="M15"; $env:BACKTEST_END_TIME="2026-06-24T00:00:00Z"; npm run backtest:smc > tasks/smc-multi-window-validation/01-run-additional-windows/m15-0624.json
$env:BACKTEST_TIMEFRAME="H4";  $env:BACKTEST_END_TIME="2026-06-24T00:00:00Z"; npm run backtest:smc > tasks/smc-multi-window-validation/01-run-additional-windows/h4-0624.json

$env:BACKTEST_TIMEFRAME="M15"; $env:BACKTEST_END_TIME="2026-06-10T00:00:00Z"; npm run backtest:smc > tasks/smc-multi-window-validation/01-run-additional-windows/m15-0610.json
$env:BACKTEST_TIMEFRAME="H4";  $env:BACKTEST_END_TIME="2026-06-10T00:00:00Z"; npm run backtest:smc > tasks/smc-multi-window-validation/01-run-additional-windows/h4-0610.json

$env:BACKTEST_TIMEFRAME="M15"; $env:BACKTEST_END_TIME="2026-05-27T00:00:00Z"; npm run backtest:smc > tasks/smc-multi-window-validation/01-run-additional-windows/m15-0527.json
$env:BACKTEST_TIMEFRAME="H4";  $env:BACKTEST_END_TIME="2026-05-27T00:00:00Z"; npm run backtest:smc > tasks/smc-multi-window-validation/01-run-additional-windows/h4-0527.json

$env:BACKTEST_TIMEFRAME="M15"; $env:BACKTEST_END_TIME="2026-05-13T00:00:00Z"; npm run backtest:smc > tasks/smc-multi-window-validation/01-run-additional-windows/m15-0513.json
$env:BACKTEST_TIMEFRAME="H4";  $env:BACKTEST_END_TIME="2026-05-13T00:00:00Z"; npm run backtest:smc > tasks/smc-multi-window-validation/01-run-additional-windows/h4-0513.json
```

Lưu ý: output file chứa cả log pino (nhiều dòng) lẫn khối JSON cuối cùng (bắt đầu bằng dòng `{` chứa `"timeframe":`) — đây là hành vi bình thường của `console.log` khi bị redirect chung với `logger`, KHÔNG cần lọc sạch, task 02 sẽ tự tìm khối JSON cuối khi đọc.

## Kiểm tra trước khi coi là xong

Với MỖI file trong 8 file trên, mở và xác nhận:
1. Có khối JSON hợp lệ ở cuối file (chứa `"summary"`, `"bySetup"`, `"byGrade"`, `"pairs"`).
2. `"bars": 1000` và `"timeframe"` đúng như tên file.
3. `summary.pairs` gần bằng 64 (nếu thấp hơn nhiều, có thể nhiều symbol thiếu dữ liệu lịch sử ở thời điểm đó — bình thường với symbol mới list gần đây, KHÔNG cần xử lý gì, chỉ ghi số liệu thật vào result.md).

Nếu 1 symbol cụ thể liên tục bị lỗi fetch ở tất cả window (ví dụ symbol mới list sau `2026-05-13`), đó là hiện tượng bình thường — không phải lỗi cần sửa.

## Verification

```bash
npm run build
npm run test
```
(Xác nhận không có gì bị đổi ngoài ý muốn — task này không sửa code.)

## result.md

Ghi vào `tasks/smc-multi-window-validation/01-run-additional-windows/result.md`:
- Danh sách 8 file đã tạo, kèm `summary.pairs`/`summary.trades`/`summary.winRatePct`/`summary.avgRiskReward` của từng file (đọc nhanh từ JSON, không cần phân tích sâu — task 02 sẽ làm).
- Xác nhận build/test pass.

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục — ví dụ nếu Binance rate-limit khiến nhiều symbol fail liên tục, thử lại sau vài phút trước khi báo blocked.
