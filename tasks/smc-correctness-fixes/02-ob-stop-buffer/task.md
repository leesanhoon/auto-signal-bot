# Task 02: Add ATR Buffer to Order Block Stop Loss

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 01 đã approved** (cùng sửa `smc-pipeline.ts`, tránh conflict).

## Mục tiêu

Setup `SMC_BOS_OB` và `SMC_CHOCH_OB` hiện đặt SL thẳng vào biên order block (`ob.low`/`ob.high`) không có buffer, trong khi 2 setup còn lại (`SMC_LIQUIDITY_SWEEP`, `SMC_FVG_CONTINUATION`) đều dùng buffer dựa trên ATR proxy. Cần đồng nhất để tránh bị wick/spread quét SL sát biên OB.

## Vị trí cần sửa

`src/charts/smc/smc-pipeline.ts`, trong `buildSmcCandidatesAtIndex`, đoạn xử lý BOS/CHOCH+OB (khoảng dòng 134-198):

```ts
const stopLoss = structure.direction === "LONG" ? ob.low : ob.high;
const risk = Math.abs(entry - stopLoss) || 0.0001;
```

So sánh với cách 2 setup khác đã làm (đã có sẵn trong cùng file, dùng làm mẫu):
- `SMC_LIQUIDITY_SWEEP` (dòng ~204-209): `calculateLocalAtr(...)`, `stopBuffer = Math.max(atrProxy * 0.25, Math.abs(entry) * 0.00002, 0.0001)`.
- `SMC_FVG_CONTINUATION` (dòng ~241-244): `atrProxy`, `stopBuffer = Math.max(atrProxy * 0.2, gapSize * 0.25, ...)`.

## Việc cần làm

1. Trong đoạn xử lý BOS/CHOCH+OB, gọi `calculateLocalAtr(scopedCandles, index)` để lấy `atrProxy` (hàm này đã tồn tại sẵn trong file, đang được dùng ở 2 setup khác — không viết lại).
2. Tính `stopBuffer = Math.max(atrProxy * 0.2, Math.abs(entry) * 0.00002, 0.0001)` (hệ số 0.2 — nằm giữa 2 setup kia, dùng đúng số này để nhất quán, không tự chọn số khác).
3. Sửa `stopLoss`:
   ```ts
   const stopLoss = structure.direction === "LONG"
     ? ob.low - stopBuffer
     : ob.high + stopBuffer;
   ```
4. `risk`, `takeProfit1`, `takeProfit2` giữ nguyên công thức cũ (tính lại tự động vì dựa trên `entry` và `stopLoss` mới) — không đổi hệ số R (vẫn 2R/3R).
5. `entryZone: { low: Math.min(entry, ob.low), high: Math.max(entry, ob.high) }` (dòng ~192): giữ nguyên dùng `ob.low`/`ob.high` gốc (không cộng buffer) — entryZone là vùng chờ giá vào, khác với SL. Không đổi dòng này.

## Việc KHÔNG được làm

- Không đổi `calculateLocalAtr` — chỉ gọi lại hàm có sẵn.
- Không đổi setup Liquidity Sweep / FVG Continuation.
- Không đổi hệ số R (2R/3R) cho TP.
- Không đổi `entryZone` của setup OB.

## Test cần thêm/sửa

Trong `tests/charts/smc/smc-pipeline.test.ts`:
1. Test case cho setup `SMC_BOS_OB` (hoặc `SMC_CHOCH_OB`): dựng dữ liệu nến có ATR xác định, assert `stopLoss` KHÔNG bằng chính xác `ob.low`/`ob.high` mà thấp hơn/cao hơn theo đúng buffer (`ob.low - stopBuffer` cho LONG).
2. Rà soát test case cũ liên quan setup OB đang assert `stopLoss === ob.low` (nếu có) — cập nhật assertion theo công thức mới có buffer, không xoá test.
3. Assert `takeProfit1`/`takeProfit2` vẫn giữ đúng tỉ lệ 2R/3R theo `risk` mới (risk lớn hơn do SL xa hơn).

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm số test.
- SL của setup OB LONG luôn `< ob.low`, SL setup OB SHORT luôn `> ob.high` (verify bằng test, không chỉ đọc code).

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau.
- Test case đã thêm/sửa và lý do.
- Output build/test.
- Nếu bị chặn → ghi `blocked.md`.
