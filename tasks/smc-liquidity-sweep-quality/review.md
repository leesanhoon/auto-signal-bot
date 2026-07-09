# Review: SMC Liquidity Sweep Quality Filter (subtasks 01-02)

## Phương pháp review

- Đọc lại `plan.md` + 2 `task.md` + 2 `result.md`.
- Đọc trực tiếp code hiện tại tại `src/charts/smc/smc-pipeline.ts` (khối xử lý sweep, dòng 283-343) và khối FVG ngay sau (dòng 345+).
- Tự chạy `npm run build` và `npm test` độc lập.

## Kết quả verify độc lập

```
npm run build   → tsc pass
npm test        → Test Files 64 passed (64), Tests 679 passed (679)
```

Khớp số liệu Worker báo cáo ở `02-rejection-rvol-gate/result.md`.

## Vấn đề nghiêm trọng phát hiện — CHẶN APPROVAL

### `return candidates;` ở depth gate thoát luôn khỏi cả hàm, làm mất FVG candidate

[`smc-pipeline.ts:293-295`](../../src/charts/smc/smc-pipeline.ts#L293-L295):

```ts
if (atrProxy > 0 && sweepDepth < atrProxy * 0.1) {
  return candidates;
}
```

`buildSmcCandidatesAtIndex` xử lý 3 setup tuần tự trong cùng 1 hàm: OB (dòng ~176-281) → Sweep (dòng 283-343) → FVG (dòng 345+). Task 01 yêu cầu "không push sweep candidate vào candidates khi sweep quá nông" — nhưng Worker implement bằng `return candidates;`, tức là **thoát luôn khỏi toàn bộ hàm**, bỏ qua hoàn toàn khối FVG phía sau, dù FVG là phép kiểm tra hoàn toàn độc lập với sweep (dựa trên 3 nến liền kề, không liên quan gì đến swing/sweep).

**Hệ quả:** tại bất kỳ index nào có sweep nông (rất phổ biến, đây chính là lý do subtask 01 được tạo ra để lọc) **và** đồng thời có FVG hợp lệ, tín hiệu FVG — setup có win rate tốt nhất hệ thống (69-95% theo backtest trước) — bị mất hoàn toàn khỏi candidates.

**Vì sao test không bắt được:** test `Liquidity sweep is skipped when sweep depth is shallower than 10% ATR` ([tests/charts/smc/smc-pipeline.test.ts:609-622](../../tests/charts/smc/smc-pipeline.test.ts#L609-L622)) tự mock `detectFairValueGap.mockReturnValue(null)` — nên tương tác giữa 2 setup chưa từng được test.

## Quyết định

**CHANGES_REQUIRED** — không approve cho tới khi fix xong bug này.

### Fix cần làm

Đổi depth-gate từ `return candidates;` (thoát cả hàm) sang chỉ bỏ qua việc build/push sweep candidate — bọc phần logic build signal còn lại (dòng 297-342) trong `if (!isTooShallow) { ... }`, ví dụ:

```ts
const isSweepTooShallow = atrProxy > 0 && sweepDepth < atrProxy * 0.1;
if (!isSweepTooShallow) {
  const rejection = detectRejectionWick(candle, direction);
  // ... toàn bộ phần còn lại của khối sweep (rvol, sessionAdjusted, signal, candidates.push)
}
```

### Test bắt buộc phải thêm

Case mới: dựng dữ liệu (hoặc mock) sao cho **đồng thời** có sweep quá nông **và** FVG hợp lệ tại cùng index → assert `analyzeSmcSignalsAtIndex` vẫn trả về đúng 1 signal `SMC_FVG_CONTINUATION` (không bị mất do sweep bị chặn). Đây là test bắt buộc để chứng minh bug đã fix, không chỉ sửa code.

## Các phần đã đúng (không cần sửa)

- Depth gate: công thức `sweepDepth` và ngưỡng `0.1 * atrProxy` đúng theo task 01, case `atrProxy <= 0` không bị chặn — đúng yêu cầu.
- Rejection/RVOL gate (subtask 02): logic AND (`hasRejectionWick && rvol >= 1.2`), confidence 72/55, áp dụng trước session penalty, field `hasRejectionWick`/`rvol` gắn vào signal — tất cả đúng theo task 02.
- Không đụng `detectLiquiditySweep`, `detectRejectionWick`, `calculateRvol`, `calculateLocalAtr` — đúng ràng buộc.
- Không đụng 2 setup còn lại (OB, FVG logic gốc) — đúng, chỉ có tác dụng phụ ngoài ý muốn qua control-flow bug ở trên, không phải sửa trực tiếp.

## Việc cần làm tiếp theo

- Worker: sửa depth-gate theo hướng dẫn trên, thêm test case sweep-nông + FVG cùng lúc, cập nhật `result.md`.
- Sau khi fix: Lead sẽ review lại lần 2, rồi mới chạy backtest thật (so trước/sau) để verify win rate Sweep có cải thiện — chưa chạy backtest ở vòng này vì code còn bug ảnh hưởng đến cả FVG.

## Round 2 — verify fix bug `return candidates`

- Đọc lại `smc-pipeline.ts:283-342`: xác nhận đã đổi `return candidates;` thành `const isSweepTooShallow = ...; if (!isSweepTooShallow) { ... }`, bọc toàn bộ phần build/push signal — không còn thoát cả hàm, khối FVG phía sau không còn bị ảnh hưởng.
- Đọc test mới `FVG signal is not lost when shallow sweep is present at same index` ([tests/charts/smc/smc-pipeline.test.ts:777-807](../../tests/charts/smc/smc-pipeline.test.ts#L777-L807)): mock sweep nông + FVG hợp lệ cùng index 6, assert `sweepSignals` rỗng nhưng `fvgSignal` vẫn tồn tại đúng field — đúng test bắt buộc đã yêu cầu.
- Tự chạy lại `npm run build` (pass) và `npm test`: **Test Files 64 passed (64), Tests 680 passed (680)** (679 + 1 test mới, không giảm test nào).
- Không còn finding nào mở.

## Kết luận round 2: APPROVED — sẵn sàng chạy backtest thật để verify hiệu quả.
