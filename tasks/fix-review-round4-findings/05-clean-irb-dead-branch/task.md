# Task 05 — Xóa if/else thừa trong detectIrb (LOW)

## Vấn đề

`src/charts/setups/irb.ts` (~dòng 153-161), `detectIrb`:
```ts
if (direction === "LONG") {
  if (!resolveIrbBreakout(candles, ctx, index, direction, rangeInner, rangeOuter, matchedInnerWindow, kBlockInner, trace)) { return null; }
} else {
  if (!resolveIrbBreakout(candles, ctx, index, direction, rangeInner, rangeOuter, matchedInnerWindow, kBlockInner, trace)) { return null; }
}
```
Cả 2 nhánh gọi CHÍNH XÁC cùng 1 hàm với CÙNG tham số (`direction` đã là tham
số truyền vào, tự xử lý bên trong `resolveIrbBreakout`) — if/else hoàn toàn
thừa, sót lại từ lúc dedup logic LONG/SHORT.

## Yêu cầu

Gộp thành 1 dòng duy nhất:
```ts
if (!resolveIrbBreakout(candles, ctx, index, direction, rangeInner, rangeOuter, matchedInnerWindow, kBlockInner, trace)) {
  return null;
}
```

## KHÔNG làm

- Không đổi logic bên trong `resolveIrbBreakout`.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts tests/charts/irb-fallback.test.ts
```
Phải pass không đổi kết quả (thuần túy dọn code, không đổi hành vi).

## Ghi kết quả

`result.md`: diff, kết quả build + test.
