# Task 05 — Deduplicate IRB LONG/SHORT scaffolding around checkShiftedFallback (LOW)

## Vấn đề

`src/charts/setups/irb.ts` đã có helper `checkShiftedFallback` (dùng chung
cho cả 2 nhánh — tốt), nhưng phần code BAO QUANH lời gọi helper đó (dòng
~117-128 cho LONG, ~129-141 cho SHORT) vẫn copy-paste gần như y hệt: check
`breaksInner*` → return null với trace message nếu chưa phá, check
`breaksOuter*` → gọi `checkShiftedFallback` hoặc return null, push cùng dạng
trace message "RangeInner pha index... -> chap nhan".

## Yêu cầu

Trích xuất phần scaffolding còn lặp thành 1 helper dùng chung, ví dụ:

```ts
function resolveIrbBreakout(
  candles: Candle[],
  ctx: DetectionContext,
  index: number,
  direction: "LONG" | "SHORT",
  rangeInner: NonNullable<ReturnType<typeof detectCompression>>,
  rangeOuter: NonNullable<ReturnType<typeof detectCompression>>,
  matchedInnerWindow: number,
  kBlockInner: number,
  trace: string[],
): boolean {
  const breaksInner = direction === "LONG" ? candles[index].close > rangeInner.high : candles[index].close < rangeInner.low;
  if (!breaksInner) {
    trace.push(`Chua pha RangeInner ${direction === "LONG" ? "high" : "low"}`);
    return false;
  }
  const breaksOuter = direction === "LONG" ? candles[index].close > rangeOuter.high : candles[index].close < rangeOuter.low;
  if (!breaksOuter) {
    if (!checkShiftedFallback(candles, ctx, index, matchedInnerWindow, kBlockInner, direction, rangeOuter)) {
      return false;
    }
    trace.push(`RangeInner da pha truoc do, RangeOuter pha tai index ${index} -> chap nhan`);
  }
  return true;
}
```

Điều chỉnh chữ ký/logic cho khớp CHÍNH XÁC với code hiện tại (đọc kỹ
`irb.ts` trước khi viết — ví dụ đảm bảo giữ đúng các message trace hiện có để
không làm hỏng test đang assert `ruleTrace`). Gọi hàm này ở cả 2 nhánh LONG/
SHORT trong `detectIrb` thay cho code lặp.

## KHÔNG làm

- Không đổi logic/threshold/message trace theo cách làm thay đổi hành vi —
  đây thuần túy refactor cấu trúc.
- Không đổi `checkShiftedFallback` (đã đúng, không cần sửa).

## Verification

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts tests/charts/irb-fallback.test.ts
```
Toàn bộ test IRB phải pass không đổi kết quả (kể cả assertion trên
`ruleTrace` nếu có).

## Ghi kết quả

`result.md`: helper mới, diff tóm tắt, kết quả build + test.
