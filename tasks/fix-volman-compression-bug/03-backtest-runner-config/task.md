# Task 03 — Parameterize setup-backtest-runner.ts via env vars

## Bối cảnh

`src/charts/setup-backtest-runner.ts` (chạy qua `npm run backtest:setups`)
hiện hardcode timeframe `"H4"` và số nến `500` (dòng có
`fetchOhlcHistory(symbol, "H4", 500)` và `runSetupBacktest(candles, pair, "H4")`).

Cần backtest lại trên M15 với khoảng thời gian dài hơn (30-60 ngày) sau khi
task 01/02 fix bug detectCompression, thay vì viết script dùng 1 lần.

## Yêu cầu

Sửa `src/charts/setup-backtest-runner.ts`:

1. Đọc 2 biến môi trường (đã có `import "../shared/env.js"` ở đầu file):
   - `BACKTEST_TIMEFRAME` — mặc định `"H4"` nếu không set. Giá trị hợp lệ:
     `"M15" | "H4" | "D1"` (type `ChartTimeframe` đã import từ `./chart-types.js`).
   - `BACKTEST_BARS` — mặc định `500` nếu không set hoặc không parse được số
     nguyên dương.

2. Thay `fetchOhlcHistory(symbol, "H4", 500)` bằng
   `fetchOhlcHistory(symbol, timeframe, bars)` dùng 2 biến trên.

3. Thay `runSetupBacktest(candles, pair, "H4")` bằng
   `runSetupBacktest(candles, pair, timeframe)`.

4. Validate `BACKTEST_TIMEFRAME`: nếu giá trị set nhưng không phải một trong
   3 giá trị hợp lệ, log warning và fallback về `"H4"` — KHÔNG throw, không
   crash chương trình.

5. Cập nhật log "Fetching H4 data for..." → dùng `timeframe` thay vì hardcode
   `"H4"` (interpolate biến vào message).

6. Cập nhật header report `printReport` — đổi `console.log("SETUP BACKTEST REPORT")`
   thành include timeframe, ví dụ `SETUP BACKTEST REPORT (${timeframe})` — cần
   truyền `timeframe` vào hàm `printReport` hoặc đọc lại từ `process.env` bên
   trong đó.

## KHÔNG làm

- Không đổi `package.json` script `backtest:setups` — nó vẫn chạy đúng file
  này, giờ chỉ thêm khả năng override qua env, ví dụ người dùng tự chạy
  `BACKTEST_TIMEFRAME=M15 BACKTEST_BARS=5000 npm run backtest:setups`
  (không cần bạn tự chạy lệnh này — Lead sẽ chạy để lấy số liệu thật với
  Twelve Data API key thật).
- Không sửa `setup-backtest.ts` (logic backtest core) — chỉ sửa runner.

## Verification

```bash
npm run build
```
Phải pass. Không cần chạy backtest thật (cần API key thật, Lead sẽ làm việc
đó sau).

## Ghi kết quả

Viết `result.md`:
- Diff tóm tắt các dòng đã sửa trong `setup-backtest-runner.ts`
- Kết quả `npm run build`
- Ví dụ lệnh người dùng có thể chạy để test M15 60 ngày:
  `BACKTEST_TIMEFRAME=M15 BACKTEST_BARS=5760 npm run backtest:setups`
  (lưu ý: 5760 vượt giới hạn outputsize 5000 của Twelve Data free plan — nên
  gợi ý dùng tối đa `5000` cho M15, tương đương ~52 ngày)
