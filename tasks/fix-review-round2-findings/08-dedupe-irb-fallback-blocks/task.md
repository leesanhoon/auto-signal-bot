# Task 08 — Deduplicate IRB LONG/SHORT fallback blocks (LOW)

## Vấn đề

`src/charts/setups/irb.ts`, 2 nhánh fallback (LONG ~dòng 95-108, SHORT ~dòng
114-127) copy-paste gần như y hệt nhau, chỉ khác chiều so sánh
(`high`/`.high` vs `low`/`.low`) và điều kiện breakout. Rủi ro: sửa 1 nhánh
quên sửa nhánh kia, hoặc gõ nhầm field (`.high` thay vì `.low`) khi mirror
tay.

## Yêu cầu

Trong `src/charts/setups/irb.ts`, trích xuất helper dùng chung cho cả 2 nhánh:

```ts
function checkShiftedFallback(
  candles: Candle[],
  ctx: DetectionContext,
  index: number,
  matchedInnerWindow: number,
  kBlockInner: number,
  direction: "LONG" | "SHORT",
  rangeOuter: NonNullable<ReturnType<typeof detectCompression>>,
): boolean {
  if (index < 2) return false;
  const fallbackInner = detectCompression(candles, ctx.ema20, ctx.atr14, index - 2, matchedInnerWindow, kBlockInner);
  if (fallbackInner === null) return false;
  const prevCandle = candles[index - 1];
  return direction === "LONG"
    ? prevCandle.high > fallbackInner.high && candles[index].high > rangeOuter.high
    : prevCandle.low < fallbackInner.low && candles[index].low < rangeOuter.low;
}
```

Gọi hàm này ở cả 2 nhánh LONG/SHORT thay cho code lặp hiện có, giữ nguyên
`trace.push(...)` message tương ứng ở call site (helper chỉ trả `boolean`,
không tự viết trace — để trace message vẫn khác nhau đúng như hiện tại nếu
cần).

## KHÔNG làm

- Không đổi logic/threshold — hành vi phải giữ nguyên 100% (đây thuần túy
  refactor).
- Không đổi các phần khác của `detectIrb` (phần detect RangeOuter/RangeInner
  chính, phần tính entry/stop/confidence).

## Verification

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts tests/charts/irb-fallback.test.ts
```

Toàn bộ test IRB hiện có (kể cả test mới từ task 02 nếu đã làm xong) PHẢI
pass không đổi kết quả.

## Ghi kết quả

`result.md`: helper mới, diff tóm tắt, kết quả build + test.
