# Task 02 — FVG candidate bắt buộc có xác nhận cấu trúc

> Phụ thuộc: chạy SAU khi subtask 01 hoàn thành (cùng sửa `smc-pipeline.ts`).

## Mục tiêu

Hiện tại `buildSmcCandidatesAtIndex` trong `src/charts/smc/smc-pipeline.ts` tạo candidate `SMC_FVG_CONTINUATION` cho *mọi* Fair Value Gap, kể cả khi chưa có xác nhận cấu trúc cùng hướng (nhánh confidence 60). FVG trên M15 xuất hiện gần như liên tục nên đây là nguồn nhiễu chính. Sửa để FVG chỉ trở thành candidate khi có structure break cùng hướng.

## Không được làm

- KHÔNG sửa nhánh BOS/CHOCH + Order Block phía trên.
- KHÔNG đổi cách tính entry/SL/TP của FVG candidate.
- KHÔNG refactor, KHÔNG thêm feature ngoài mô tả.

## Thay đổi — `src/charts/smc/smc-pipeline.ts`

Trong `buildSmcCandidatesAtIndex`, khối FVG (dòng ~290-337) hiện tại:

```ts
const fvg = detectFairValueGap(scopedCandles, index);
if (fvg) {
  const dir = fvg.direction;
  if (!isAgainstHtfBias(htfContext, dir)) {
    const structure = detectStructureBreak(scopedCandles, swings, index, dir);
    const hasConfirmingStructure = structure !== null && structure.direction === dir;
    const baseConfidence = hasConfirmingStructure ? 74 : 60;
    const sessionAdjusted = applySessionPenalty(
      ...
      hasConfirmingStructure
        ? ["FVG cùng hướng cấu trúc đang mở rộng."]
        : ["FVG xuất hiện nhưng chưa có xác nhận cấu trúc cùng hướng."],
    );
    ... // build signal + push candidate
  }
}
```

Sửa thành: nếu `hasConfirmingStructure` là `false` thì **không tạo candidate** (bỏ qua toàn bộ phần build signal). Cụ thể:

- Sau dòng tính `hasConfirmingStructure`, thêm guard: `if (!hasConfirmingStructure) { /* không push candidate */ }` — cách sạch nhất là gộp điều kiện: chỉ đi tiếp khi `hasConfirmingStructure === true`.
- `baseConfidence` giữ nguyên giá trị 74 (nhánh 60 chết, xoá luôn ternary).
- `ruleTrace` chỉ còn nhánh `["FVG cùng hướng cấu trúc đang mở rộng."]` (xoá string nhánh không xác nhận).
- Phần build signal giữ nguyên, kể cả `structureEvent: structure ?? undefined` có thể đơn giản thành `structureEvent: structure` nếu type cho phép — nếu TypeScript báo lỗi thì giữ nguyên `?? undefined`.

## Tests — `tests/charts/smc/smc-pipeline.test.ts`

Đọc test hiện có trước, theo đúng pattern fixture. Sau đó:

1. **Cập nhật test cũ**: nếu có test khẳng định FVG không xác nhận cấu trúc vẫn tạo signal confidence 60 → đổi expectation thành không có candidate/signal (mô tả test đổi theo).
2. **Thêm test mới**:
   - FVG có structure break cùng hướng → có candidate `SMC_FVG_CONTINUATION`, confidence base 74 (trước session penalty).
   - FVG KHÔNG có structure break cùng hướng → `analyzeSmcSignalsAtIndex` trả về `[]` (hoặc không chứa `SMC_FVG_CONTINUATION`).

## Lưu ý ảnh hưởng

`buildSmcCandidatesAtIndex` dùng chung cho backtest (`smc-backtest.ts`). Thay đổi này làm backtest sinh ít signal FVG hơn — đây là chủ đích của plan, KHÔNG cần sửa gì trong backtest. Nếu test backtest fail vì fixture dựa vào FVG không xác nhận, cập nhật fixture/expectation của test đó cho khớp hành vi mới và ghi rõ trong result.md.

## Verification

```bash
npm run build
npm run test
```

Cả hai phải pass. Ghi kết quả vào `tasks/smc-signal-noise-reduction/02-fvg-structure-confirmation/result.md` (file sửa, output build/test). Nếu blocked → `blocked.md`.
