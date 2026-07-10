# Task 04: Cập nhật tests + chạy extended baseline

Prerequisite: Tasks 01, 02, 03 đã xong.
File được sửa: `tests/charts/smc/smc-backtest.test.ts` (chỉ file này). KHÔNG sửa src — nếu test lộ bug trong src, ghi blocked.md. KHÔNG commit.

## Phần 1 — Sửa/thêm tests

1. Sửa các test fail do task 02/03 (RR giờ là weighted partial + trừ fee). Với các test kiểm tra RR chính xác: set `BACKTEST_FEE_RATE=0`/`BACKTEST_SLIPPAGE_RATE=0` qua `process.env` trong test (nhớ restore sau test — dùng `beforeEach`/`afterEach`) hoặc tính expected theo default fee — chọn cách env=0 cho dễ đọc.
2. Thêm test mới (vitest, theo pattern file hiện có):
   - **partial-exit-a**: LONG có TP3, giá lần lượt qua TP1 (nến n), TP2 (nến n+1), TP3 (nến n+2) → outcome `tp3`, RR (gross) = `0.5*R1 + 0.3*R2 + 0.2*R3` với `Ri = (tpi - entry)/risk`.
   - **partial-exit-b (breakeven)**: LONG chạm TP1 rồi quay về xuyên entry → outcome `tp1`, RR (gross) = `0.5*R1 + 0.5*0` (phần còn lại thoát tại entry, breakeven).
   - **partial-exit-c**: LONG không có TP3, chạm TP1 rồi TP2 → outcome `tp2`, RR = `0.5*R1 + 0.5*R2`.
   - **fee-d**: cùng fixture với partial-exit-c nhưng bật fee mặc định → RR net < RR gross đúng bằng tổng costR theo công thức trong task 03 (kiểm tra xấp xỉ `toBeCloseTo`).

## Phần 2 — Extended baseline

Chạy (PowerShell):

```powershell
npm run build
npm run test
$env:BACKTEST_TIMEFRAME="M15"; $env:BACKTEST_BARS="1000"; npm run backtest:smc
$env:BACKTEST_TIMEFRAME="H4";  $env:BACKTEST_BARS="1000"; npm run backtest:smc
```

Lưu ý: nếu provider chỉ trả về ít hơn số bars yêu cầu (giới hạn Binance 1000 nến/request), dùng số lớn nhất khả dụng và ghi rõ số bars thực nhận. KHÔNG tự viết pagination.

## Phần 3 — result.md

`tasks/smc-expand-and-realism/04-extended-baseline/result.md` gồm:

1. Danh sách test sửa/thêm + kết quả (`npm run test` full pass).
2. Bảng so sánh: baseline cũ (45.71% WR / 0.39 RR / 280 trades, M15 500 bars, 22 pairs, no-partial, no-fee) vs M15 mới vs H4 mới (64+ pairs, partial, net fee).
3. Breakdown bySetup và byGrade (lấy từ report JSON — nếu runner không in bySetup/byGrade, lấy từ `bySetupStats` bằng cách thêm log tạm KHÔNG được commit... KHÔNG sửa runner: thay vào đó ghi rõ trong result.md là dữ liệu bySetup không được in và đề xuất Lead mở task riêng).
4. Kết luận: setup/grade nào có expectancy dương net fee (expectancy ≈ mean realizedRiskReward), pair nào tệ nhất, đề xuất filter.

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục, không đoán.
