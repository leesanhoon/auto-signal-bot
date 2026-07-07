# Task 05 — Fix unreachable IRB fallback branch (MEDIUM)

## Vấn đề (đã xác nhận toán học)

`src/charts/setups/irb.ts` sau khi fix bug off-by-one (task
`fix-volman-compression-bug/01`), `rangeInner`/`rangeOuter` được tính với
`endIndex = index - 1` — nghĩa là `rangeInner.high`/`.low` đã là max/min bao
gồm CHÍNH `candles[index - 1]`.

Đoạn fallback (dòng ~95-106 cho LONG, ~113-124 cho SHORT):
```ts
const prevCandle = candles[index - 1];
if (prevCandle.high > rangeInner.high && candles[index].high > rangeOuter.high) {
  trace.push(`RangeInner pha index ${index - 1}, RangeOuter pha index ${index} -> chap nhan`);
} else {
  return null;
}
```
Vì `rangeInner.high` đã bao gồm `candles[index-1].high` trong phép tính max,
luôn có `rangeInner.high >= prevCandle.high` → điều kiện
`prevCandle.high > rangeInner.high` KHÔNG BAO GIỜ đúng. Nhánh này luôn rơi
vào `else { return null; }` — dead code, dù message log nói "chap nhan"
(accept) nhưng không bao giờ thực thi được. Tương tự cho nhánh SHORT
(`prevCandle.low < rangeInner.low`).

## Yêu cầu

Ý định ban đầu của đoạn code: cho phép trường hợp RangeInner breakout xảy ra ở
nến TRƯỚC (`index - 1`), rồi RangeOuter breakout xảy ra ở nến hiện tại
(`index`) — tức break xảy ra cách nhau 1 nến. Để làm đúng ý định này SAU KHI
`rangeInner`/`rangeOuter` đã tính trên window kết thúc ở `index - 1`:

Sửa điều kiện fallback để kiểm tra candle TRƯỚC `index - 1` (tức
`candles[index - 2]`) có phải là candle đã phá `rangeInner` hay không — vì
window tính rangeInner giờ đã "ăn" candle `index-1` vào bên trong, nên
"candle trước đó phá RangeInner" giờ phải lùi thêm 1 mốc:

```ts
// LONG
if (!breaksOuterUp) {
  trace.push(...);
  if (index >= 2) {
    const prevCandle = candles[index - 2];
    if (prevCandle.high > rangeInner.high && candles[index].high > rangeOuter.high) {
      trace.push(`RangeInner da pha truoc do, RangeOuter pha tai index ${index} -> chap nhan`);
    } else {
      return null;
    }
  } else {
    return null;
  }
}
```//tương tự cho SHORT với `candles[index - 2].low < rangeInner.low`.

TRƯỚC KHI áp dụng fix này y hệt, hãy tự kiểm chứng lại bằng cách viết 1 test
case cụ thể (xem phần Verification) — nếu vẫn không kích hoạt được nhánh
"chấp nhận", ghi rõ vào `blocked.md` những gì đã thử, KHÔNG tự ý nới lỏng
điều kiện `breaksOuterUp`/`breaksOuterDown` chính hay các ngưỡng
`kBlockOuter`/`kBlockInner`/`nearThreshold` khác.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts
```

Viết 1 test mới trong `tests/charts/setups.test.ts` (nhóm IRB) với fixture
mô phỏng đúng case: RangeInner breakout ở nến `index - 2` (sau khi tính theo
window mới), RangeOuter breakout ở nến `index` — xác nhận `detectIrb` trả về
signal khác null qua nhánh fallback này (không phải qua breakout thường).

## Ghi kết quả

`result.md`: điều kiện mới, test mới (hoặc `blocked.md` nếu không tái tạo
được case), kết quả build + test.
