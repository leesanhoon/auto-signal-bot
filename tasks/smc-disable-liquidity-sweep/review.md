# Review: Disable SMC_LIQUIDITY_SWEEP Setup

## Phương pháp review

- Đọc trực tiếp `smc-pipeline.ts` sau khi sửa (dòng 162-320+), xác nhận ranh giới xoá đúng — khối OB kết thúc dòng 286, khối FVG bắt đầu liền dòng 288, không mất/thừa code.
- Grep xác nhận `detectLiquiditySweep`, `SMC_LIQUIDITY_SWEEP`, `createEntryZone` không còn dấu vết nào trong `smc-pipeline.ts`.
- Kiểm tra `git status`/`git diff --stat` xác nhận không đụng `smc-structure.ts`, `smc-types.ts`, `smc-signal-assembly.ts`, `smc-liquidity-context.ts`, `smc-session.ts`, `smc-confluence.ts`, `smc-htf-context.ts`, `tests/charts/smc/smc-structure.test.ts` — đúng ràng buộc `plan.md`. Diff còn lại trong `smc-backtest.ts` là từ task `smc-rolling-htf-backtest` đã approve trước đó, không liên quan sweep (verify bằng grep không có "sweep").
- Đọc test mới `"SMC_LIQUIDITY_SWEEP setup is permanently disabled and never appears in signals"` (dòng 802-819).
- Tự chạy `npm run build` + `npm test` độc lập.

## Kết quả verify độc lập

```
npm run build   → tsc pass
npm test        → Test Files 65 passed (65), Tests 704 passed (704)
```

Khớp đúng báo cáo Worker (715 → 704, giảm đúng 11 = xoá 12 + thêm 1).

## Đối chiếu

| Yêu cầu | Đạt? |
|---|---|
| Xoá import `detectLiquiditySweep` | ✅ |
| Xoá helper `createEntryZone` (không còn dùng) | ✅ |
| Xoá đúng khối sweep, không đụng OB/FVG | ✅ (verify trực tiếp bằng đọc code) |
| Giữ nguyên `smc-structure.ts`/`detectLiquiditySweep` gốc | ✅ |
| Giữ nguyên `smc-types.ts`, các file khác ngoài phạm vi | ✅ |
| Xoá 12 test không còn áp dụng, ghi rõ danh sách | ✅ |
| Thêm test xác nhận invariant "không bao giờ có signal Sweep" | ✅ |
| Build sạch, không unused import/variable | ✅ |

Không phát hiện vấn đề nào.

## Quyết định: APPROVED

## Việc tiếp theo

- Lead sẽ chạy lại backtest thật (chỉ còn OB + FVG) để xác nhận tổng win rate/avg R:R cải thiện so với khi còn Sweep, đúng cam kết trong `plan.md`.
