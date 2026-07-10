# Task 01: Fix look-ahead trong fill và outcome scan

File duy nhất được sửa: `src/charts/smc/smc-backtest.ts`
KHÔNG sửa file nào khác. KHÔNG refactor ngoài scope. KHÔNG commit.

## Thay đổi 1 — `fillSignal` (hiện ở line ~190)

Hiện tại:

```ts
const start = Math.max(0, signal.triggerIndex);
```

Đổi thành:

```ts
const start = Math.max(0, signal.triggerIndex + 1);
```

Lý do: signal chỉ tồn tại sau khi nến `triggerIndex` đóng, không thể fill bằng high/low của chính nến đó. Giữ nguyên `maxLookahead = 5` (5 nến kể từ `start`).

## Thay đổi 2 — `scanOutcome` (hiện ở line ~152)

Hiện tại vòng lặp bắt đầu `for (let i = fillIndex; ...)` và check SL + TP1/TP2/TP3 trên mọi nến kể cả nến fill.

Hành vi mới:

- Trên nến `i === fillIndex`: CHỈ check stop loss (LONG: `low <= stopLoss`; SHORT: `high >= stopLoss`). Không check TP nào.
- Từ nến `i > fillIndex`: check như cũ — SL trước, rồi TP3 > TP2 > TP1.

Cách đơn giản nhất: trong vòng lặp, wrap các nhánh TP trong điều kiện `if (i > fillIndex)`. Ví dụ nhánh LONG:

```ts
if (low <= stopLoss) {
  return { exitIndex: i, exitPrice: stopLoss, outcome: "stop", realizedRiskReward: -1 };
}
if (i > fillIndex) {
  if (takeProfit3 !== undefined && high >= takeProfit3) { ... }
  if (high >= takeProfit2) { ... }
  if (high >= takeProfit1) { ... }
}
```

Lưu ý: `realizedRiskReward` của stop hiện được tính bằng biểu thức `(stopLoss - entry) / (entry - stopLoss)` (luôn = -1). Có thể giữ nguyên biểu thức hoặc thay bằng `-1` — không bắt buộc.

## Thay đổi 3 — cập nhật `assumptions`

Cả hai mảng `assumptions` trong file (một ở early-return khi `candles.length < 30`, một ở `computeReport`) — sửa dòng nói về fill/TP thành:

- `"Limit entry fill nếu giá chạm entry zone trong 5 nến SAU nến sinh tín hiệu (không fill trên nến sinh tín hiệu)."`
- `"Trên nến fill chỉ xét stop loss; TP1/TP2/TP3 xét từ nến sau nến fill, ưu tiên TP3 > TP2 > TP1."`

Giữ nguyên các dòng assumption khác.

## Verification (bắt buộc chạy và ghi output vào result.md)

```bash
npm run build
npm run test
npm run backtest:smc
```

- Test hiện có ở `tests/charts/smc/smc-backtest.test.ts` có thể fail vì hành vi thay đổi — nếu fail, KHÔNG sửa test trong task này (task 03 sẽ xử lý), chỉ ghi rõ test nào fail và vì sao trong result.md.
- Ghi output tóm tắt của backtest (summary tổng) vào `tasks/smc-backtest-fixes/01-fix-lookahead-fill/result.md`.

## Nếu bị chặn

Ghi `tasks/smc-backtest-fixes/01-fix-lookahead-fill/blocked.md`, không đoán.
