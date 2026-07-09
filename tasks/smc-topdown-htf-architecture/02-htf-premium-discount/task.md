# Task 02: HTF Premium/Discount Wiring

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 01 đã approved.**

## Mục tiêu

Wire `HtfContext` (từ subtask 01) vào `buildSmcCandidatesAtIndex` trong `smc-pipeline.ts`, dùng HTF dealing range để tính premium/discount cho setup OB thay vì M15-local range hiện tại — khi có HTF context. Chưa thêm gate loại bỏ hướng ở subtask này (đó là subtask 03).

## Vị trí cần sửa

`src/charts/smc/smc-pipeline.ts`:

1. Import thêm `type { HtfContext } from "./smc-htf-context.js"`.
2. Thêm tham số optional `htfContext?: HtfContext | null` vào cuối signature của các hàm sau, truyền xuyên suốt (mặc định `null`/`undefined` để không phá lời gọi cũ):
   - `buildSmcCandidatesAtIndex(candles, pair, timeframe, index, htfContext?)`
   - `collectSmcCandidatesInRange(candles, pair, timeframe, startIndex, endIndex, htfContext?)`
   - `analyzeSmcSignalsAtIndex(candles, pair, timeframe, index, htfContext?)` — hàm export, đang được `smc-backtest.ts` và test gọi trực tiếp, **phải giữ tương thích ngược** (tham số optional ở cuối, không đổi thứ tự tham số cũ).
   - `analyzeSmcWindow(candles, pair, timeframe, htfContext?)` — hàm export, tương tự.
3. Trong đoạn xử lý OB (khoảng dòng 176-281), sửa:

```ts
const pdZone = calculatePremiumDiscountZone(entry, swings, index);
```

thành:

```ts
const pdZone = htfContext
  ? calculatePremiumDiscountZone(entry, htfContext.swings, htfContext.candlesLength)
  : calculatePremiumDiscountZone(entry, swings, index);
```

4. Không đổi gì khác trong logic OB (premium/discount penalty -15 giữ nguyên, chỉ đổi nguồn `swings`/`atIndex` truyền vào).
5. **Chưa** wire `htfContext` vào setup Sweep/FVG ở subtask này (chúng chưa dùng premium/discount) — chỉ chuẩn bị tham số đi qua, dùng ở subtask 03.
6. **Chưa** gọi `buildHtfContext` ở đâu cả trong subtask này — `analyzeAllChartsSmc`/`runSmcBacktest` vẫn gọi các hàm trên KHÔNG truyền `htfContext` (tương đương `undefined`) — đó là việc của subtask 04. Mục tiêu subtask này chỉ là **chuẩn bị đường ống tham số + logic dùng đúng nguồn range**, test bằng cách gọi trực tiếp các hàm export với `htfContext` giả lập.

## Việc KHÔNG được làm

- Không gọi `buildHtfContext` (hàm async, có network) ở bất kỳ đâu trong subtask này.
- Không đổi hành vi khi `htfContext` là `undefined`/`null` — phải giữ y hệt hành vi cũ (M15-local).
- Không thêm gate loại bỏ hướng (đó là subtask 03).
- Không đổi setup Sweep/FVG.

## Test cần thêm/sửa

Trong `tests/charts/smc/smc-pipeline.test.ts`:
1. Gọi `analyzeSmcSignalsAtIndex(candles, pair, timeframe, index, htfContext)` với `htfContext` giả lập có `swings`/`candlesLength` cho ra dealing range khác hẳn M15-local (ví dụ range rất rộng khiến entry rơi vào EQUILIBRIUM dù M15-local sẽ cho ra PREMIUM) → assert `premiumDiscountZone` trong signal phản ánh đúng HTF range, không phải M15-local.
2. Gọi không truyền `htfContext` (hoặc truyền `null`) → assert hành vi giữ nguyên y hệt test cũ đã có (M15-local range).
3. Rà soát toàn bộ test case cũ gọi `analyzeSmcSignalsAtIndex`/`analyzeSmcWindow` — xác nhận không có test nào bị vỡ do thêm tham số optional (tham số optional ở cuối không ảnh hưởng lời gọi cũ không truyền đủ tham số).

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm test hiện có.
- Khi có `htfContext`, `premiumDiscountZone` của setup OB tính từ HTF range (verify bằng test); khi không có, giữ nguyên M15-local.

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau.
- Test case đã thêm, giải thích.
- Output build/test.
- Nếu bị chặn → ghi `blocked.md`.
