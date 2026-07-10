# Task 02: Mô phỏng partial exit + breakeven trong backtest

File duy nhất được sửa: `src/charts/smc/smc-backtest.ts`
KHÔNG sửa file nào khác (kể cả tests — task 04 xử lý). KHÔNG commit.

## Bối cảnh

Hiện tại `scanOutcome()` đóng toàn bộ position tại TP xa nhất mà nến chạm được (ưu tiên TP3 > TP2 > TP1) — lạc quan hơn thực tế. Trade management thật: chốt từng phần tại mỗi TP và dời SL về entry (breakeven) sau TP1.

## Spec mô phỏng (Lead đã quyết, làm đúng như sau)

Vị thế chia 3 phần theo trọng số:
- Có TP3: TP1 = 50%, TP2 = 30%, TP3 = 20%
- Không có TP3 (`takeProfit3 === undefined`): TP1 = 50%, TP2 = 50%

Thêm hằng số module-level:

```ts
const PARTIAL_WEIGHTS_WITH_TP3 = { tp1: 0.5, tp2: 0.3, tp3: 0.2 } as const;
const PARTIAL_WEIGHTS_NO_TP3 = { tp1: 0.5, tp2: 0.5 } as const;
```

Viết lại `scanOutcome()` thành state machine quét từng nến từ `fillIndex` đến `maxIndex` (giữ nguyên `MAX_HOLD_BARS = 96`):

State: `currentStop` (khởi tạo = `stopLoss`), `remainingWeight` (khởi tạo = 1), `realizedR` (tích luỹ, đơn vị R với `risk = |entry - stopLoss|`), `tp1Done/tp2Done/tp3Done`.

Mỗi nến (LONG; SHORT đối xứng):
1. **Check stop trước** (giữ conservative): nếu `low <= currentStop` → cộng `remainingWeight * (currentStop - entry) / risk` vào `realizedR`, đóng trade. Outcome: nếu chưa TP nào → `"stop"`; nếu đã chốt TP1+ (breakeven stop) → outcome giữ theo TP xa nhất đã chốt (`"tp1"`/`"tp2"`), `exitIndex` = nến hiện tại.
2. **TP chỉ xét khi `i > fillIndex`** (giữ quy tắc từ task smc-backtest-fixes), theo thứ tự TP1 → TP2 → TP3 (từng mức một, cùng nến được phép chốt nhiều mức nếu high vượt):
   - Chạm TP1 lần đầu: cộng `weight_tp1 * (tp1 - entry) / risk`, trừ `remainingWeight`, set `currentStop = entry` (breakeven).
   - Chạm TP2 lần đầu: cộng `weight_tp2 * (tp2 - entry) / risk`, trừ `remainingWeight`. (Không có TP3 → trade đóng, outcome `"tp2"`.)
   - Chạm TP3 lần đầu (nếu có): cộng `weight_tp3 * (tp3 - entry) / risk`, `remainingWeight = 0`, đóng, outcome `"tp3"`.
3. Hết vòng lặp mà còn `remainingWeight > 0`:
   - Nếu hết hạn hold (`fillIndex + MAX_HOLD_BARS <= candles.length - 1`): cộng `remainingWeight * (close - entry) / risk` tại nến `fillIndex + MAX_HOLD_BARS`; outcome `"expired_hold"` nếu chưa TP nào, ngược lại giữ TP xa nhất đã chốt; `exitIndex = fillIndex + MAX_HOLD_BARS`.
   - Ngược lại (hết data): nếu chưa TP nào → `"open_at_end"` (exitIndex null, RR = phần đã realize = 0); nếu đã TP một phần → outcome TP xa nhất đã chốt, `exitIndex = candles.length - 1`, RR = phần đã realize + `remainingWeight * (close_cuối - entry) / risk`.

`realizedRiskReward` của trade = `realizedR` tổng. `exitPrice` = giá exit của phần cuối cùng được đóng.

Lưu ý: outcome `"tp1"` giờ nghĩa là "TP xa nhất chốt được là TP1" — ngữ nghĩa không đổi với report structure, không cần field mới, nhưng cập nhật `assumptions`:

- Thay dòng TP hiện tại bằng: `"Partial exit: 50% tại TP1 (SL dời về entry), 30% tại TP2, 20% tại TP3 (không có TP3 thì 50/50); outcome ghi theo TP xa nhất chốt được."`

## Ràng buộc

- Giữ nguyên signature `runSmcBacktest` và mọi field hiện có của `SmcBacktestReport`/`SmcBacktestTrade`.
- Giữ nguyên `fillSignal` và quy tắc "TP không xét trên nến fill, SL có xét".
- Test hiện có có thể fail (RR thay đổi) — KHÔNG sửa test, ghi danh sách fail vào result.md (task 04 xử lý).

## Verification (ghi vào result.md)

```bash
npm run build
npm run test        # ghi lại test fail nếu có, không sửa
npm run backtest:smc
```

Ghi summary backtest (kỳ vọng: avgRR và winRate thay đổi so với baseline 45.71%/0.39; win rate có thể TĂNG nhẹ vì breakeven stop biến một số stop thành tp1) vào `tasks/smc-expand-and-realism/02-partial-exit-sim/result.md`.

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục, không đoán.
