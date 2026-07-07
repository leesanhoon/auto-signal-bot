# Plan — Điều tra + fix (nếu đúng bug) phạm vi edge-test scan trong ARB

## Context

Backtest thật (M15, 5000 nến ≈52 ngày, 8 cặp) cho thấy ARB chỉ ra **1 lệnh
duy nhất trong 683 lệnh tổng** — hiếm bất thường so với RB (509) và IRB
(144), dù ARB có cấu trúc detect tương tự RB (dùng chung `detectCompression`
với `windowSizes`/`kBlockArb` giống hệt RB).

Đọc `src/charts/setups/arb.ts` phát hiện dòng 58:
```ts
const testLookback = Math.max(0, range.startIndex - 15);
```
biến `testLookback` được TÍNH nhưng **KHÔNG BAO GIỜ ĐƯỢC DÙNG** ở đâu khác
trong file. Vòng lặp đếm edge-test thực tế (dòng 62) lại quét từ
`range.startIndex` (không phải `testLookback`):
```ts
for (let i = range.startIndex; i < index; i++) { ... }
```

Nghi vấn: `testLookback` là dấu vết của ý định gốc — quét edge-test trong 1
phạm vi RỘNG HƠN (15 nến trước khi range bắt đầu), nhưng code thực thi lại
bị viết nhầm thành chỉ quét TRONG PHẠM VI range (`range.startIndex` đến
`index`, chỉ 6-10 nến vì đó chính là kích thước cửa sổ compression) — hẹp
hơn nhiều so với ý định. Đây có thể là nguyên nhân chính khiến `edgeTestCount
>= 2` gần như không bao giờ đạt được (cần đúng 2 lần test-thất-bại trong 1
cửa sổ rất hẹp).

**LƯU Ý:** đây là NGHI VẤN, chưa xác nhận chắc chắn — cần điều tra kỹ trước
khi sửa, vì đổi ngưỡng phát hiện detector ảnh hưởng trực tiếp tới chất lượng
tín hiệu thật.

## 1 subtask

- `01-investigate-and-fix-arb-scope/`

## Verification

```bash
npm run build
npm run test -- --run
```
Sau khi fix (nếu xác nhận là bug), Lead sẽ tự chạy lại
`BACKTEST_TIMEFRAME=M15 BACKTEST_BARS=5000 npm run backtest:setups` để so
sánh số lệnh ARB trước/sau.
