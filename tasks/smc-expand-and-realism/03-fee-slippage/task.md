# Task 03: Trừ fee/slippage vào RR

Prerequisite: Task 02 đã xong (partial exit).
File duy nhất được sửa: `src/charts/smc/smc-backtest.ts`
KHÔNG sửa file khác, KHÔNG sửa tests, KHÔNG commit.

## Spec

Thêm 2 hằng số đọc từ env (theo pattern env đọc trong `smc-config-env.ts` nhưng KHÔNG sửa file đó — đọc trực tiếp `process.env` trong `smc-backtest.ts`):

```ts
const FEE_RATE = Number(process.env.BACKTEST_FEE_RATE ?? "0.001");      // 0.1%/chiều (Binance spot taker)
const SLIPPAGE_RATE = Number(process.env.BACKTEST_SLIPPAGE_RATE ?? "0.0002"); // 0.02%/chiều
```

Nếu parse ra NaN hoặc < 0 → dùng default.

Cách trừ chi phí, tính bằng đơn vị R (`risk = |entry - stopLoss|`):

- Mỗi lần đóng một phần position với trọng số `w` tại giá `exitPrice`:
  `costR = w * ((entry + exitPrice) * (FEE_RATE + SLIPPAGE_RATE)) / risk`
  (phí vào lệnh phân bổ theo trọng số phần đó + phí thoát phần đó)
- `realizedRiskReward` của trade = tổng realized R các phần − tổng costR các phần.
- Outcome label KHÔNG đổi theo fee (trade chạm TP1 vẫn là `tp1` dù RR net có thể âm).
- Trade `expired` (không fill): không mất phí.

Thêm vào `assumptions`: `"RR đã trừ fee ${FEE_RATE*100}%/chiều và slippage ${SLIPPAGE_RATE*100}%/chiều (đặt BACKTEST_FEE_RATE=0 và BACKTEST_SLIPPAGE_RATE=0 để xem gross)."` (dùng giá trị thực tế đang áp dụng).

## Verification (ghi vào result.md)

```bash
npm run build
npm run test        # ghi test fail nếu có, không sửa
npm run backtest:smc                                   # net
$env:BACKTEST_FEE_RATE="0"; $env:BACKTEST_SLIPPAGE_RATE="0"; npm run backtest:smc   # gross để so sánh
```

Ghi cả 2 summary (net vs gross) vào `tasks/smc-expand-and-realism/03-fee-slippage/result.md`. Kỳ vọng: net avgRR thấp hơn gross rõ rệt vì avg hold ngắn (scalping M15 chịu fee nặng).

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục, không đoán.
