# Task 02: Thêm max-hold timeout, giải phóng slot trade treo

Prerequisite: Task 01 đã hoàn thành.
File duy nhất được sửa: `src/charts/smc/smc-backtest.ts`
KHÔNG sửa file nào khác. KHÔNG refactor ngoài scope. KHÔNG commit.

## Vấn đề

Trade không đóng được nhận outcome `open_at_end` và `openTradeUntilIndex = candles.length - 1` (line ~307) chặn mọi signal sau đó (SHIB: 11/12 signals bị skip vì 1 trade treo).

## Thay đổi 1 — outcome mới `expired_hold`

- Thêm `expired_hold: number` vào type `SmcBacktestOutcomeCounts` và khởi tạo `expired_hold: 0` trong `createOutcomeCounts()`.
- Thêm `"expired_hold"` vào union `outcome` của `SmcBacktestTrade`.

## Thay đổi 2 — `scanOutcome` nhận maxHoldBars

Thêm hằng số module-level:

```ts
const MAX_HOLD_BARS = 96;
```

Trong `scanOutcome`, giới hạn vòng lặp: `i <= Math.min(candles.length - 1, fillIndex + MAX_HOLD_BARS)`. Nếu vòng lặp kết thúc mà chưa chạm SL/TP:

- Nếu `fillIndex + MAX_HOLD_BARS <= candles.length - 1` (hết hạn hold trong phạm vi data): return outcome `"expired_hold"`, `exitIndex = fillIndex + MAX_HOLD_BARS`, `exitPrice = candles[exitIndex].close`, `realizedRiskReward` tính theo close:
  - LONG: `(exitPrice - entry) / (entry - stopLoss)`
  - SHORT: `(entry - exitPrice) / (stopLoss - entry)`
- Ngược lại (data hết trước): giữ `"open_at_end"` như cũ (`exitIndex: null`, RR = 0).

## Thay đổi 3 — thống kê

Trong `recordTrade`:

- `expired_hold` được tính vào `filledTrades` VÀ `closedTrades` (nó là trade đã đóng tại close): tức điều kiện loại trừ chỉ còn `"expired"` và `"open_at_end"` như hiện tại — kiểm tra lại rằng `expired_hold` rơi vào nhánh closed và `winRate += trade.realizedRiskReward > 0 ? 1 : 0` áp dụng bình thường.

Trong `computeBucket` và `computeReport`, filter `closedTrades` hiện loại `"open_at_end"` và `"expired"` — giữ nguyên, `expired_hold` tự động được tính là closed.

Trong `runSmcBacktest`, `openTradeUntilIndex = outcome.exitIndex ?? candles.length - 1;` giữ nguyên — với `expired_hold` giờ có `exitIndex` cụ thể nên slot được giải phóng đúng.

## Thay đổi 4 — runner hiển thị outcome mới

File `src/charts/smc-backtest-runner.ts`: thêm `expiredHold` vào các object `outcomes` trong `formatPairSummary` và `summarizeReports` (map từ `report.outcomes.expired_hold`). Đây là thay đổi hiển thị duy nhất được phép ở file này.

## Thay đổi 5 — assumptions

Thêm dòng: `"Trade không chạm SL/TP trong 96 nến sau fill sẽ đóng tại close (outcome expired_hold) và giải phóng slot."`

## Verification (bắt buộc, ghi vào result.md)

```bash
npm run build
npm run test
npm run backtest:smc
```

- Xác nhận SHIB không còn `skippedWhileOpen` ≈ toàn bộ signals.
- Test fail do hành vi mới: KHÔNG sửa test (task 03 xử lý), ghi rõ trong result.md.
- Ghi summary backtest mới vào `tasks/smc-backtest-fixes/02-max-hold-timeout/result.md`.

## Nếu bị chặn

Ghi `tasks/smc-backtest-fixes/02-max-hold-timeout/blocked.md`, không đoán.
