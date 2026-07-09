# Lead Review — Round 2 (sau fix loop)

**Verdict: CHANGES_REQUIRED** — còn 2 issue nhỏ, phần lớn đã đạt.

## Đã verify pass

- `npm run build`: PASS (tsc sạch).
- `npm run test`: **68/68 test files, 766/766 tests PASS** — Issue 1 round 1 (8 test fail trong `smc-index.test.ts`) đã fix thật, mock đã có `getConfiguredSmcMinSignalConfidence` (dòng 36).

## Đối chiếu từng issue round 1

| Issue round 1 | Trạng thái |
|---|---|
| 1 — 8 test fail | ✅ Fixed, full suite pass |
| 2 — option default `?? 70` → `?? 0` | ✅ Fixed (`smc-pipeline.ts:405`) |
| 3 — env đọc trong `analyzeSmcWindow` → options param | ✅ Fixed đúng thiết kế: param `options?: { freshnessCandles?: number }` default 1, getter gọi tại `analyzeAllChartsSmc`, logic filter-first giữ nguyên như Lead đã chấp nhận |
| 4 — threshold check sau confluence | ✅ Fixed: guard đặt trước `checkMultiTimeframeConfluence` |
| 5 — naming `getConfigured*` | ✅ Fixed: rename cả 2 getter + imports + mocks |
| 6 — clamp `<= 20` + reason tiếng Việt | ✅ Fixed cả hai |
| 7 — folder duplicate | ✅ Đã dọn: result.md nằm đúng 3 folder gốc |

## Issue mới phát sinh trong fix loop

### Issue R2-1 — [BLOCKING] Env getter default sai: 0 thay vì 65

- **Vị trí**: `src/charts/chart-config-env.ts` — `getConfiguredSmcMinSignalConfidence` trả `0` khi env không set và khi giá trị invalid.
- **Vấn đề**: Task 03 và review round 1 (Issue 2) quy định rõ: chỉ có **option trong pipeline** default 0 (backward compat cho caller trực tiếp); còn **env getter** default **65** để entrypoint `smc-index.ts` có filter mặc định. Với default 0 hiện tại, min-confidence filter bị tắt hoàn toàn trừ khi user set env — Fix 3 của plan vô hiệu ở cấu hình mặc định.
- **Action**: đổi cả 2 chỗ fallback trong getter từ `0` → `65`. Không test nào assert default này (chỉ có mock), nên không cần sửa test.

### Issue R2-2 — [MINOR] Import không dùng trong `smc-pipeline.ts`

- **Vị trí**: `src/charts/smc/smc-pipeline.ts:6` — import `getConfiguredSmcMinSignalConfidence` nhưng pipeline nhận giá trị qua `options.minSignalConfidence`, không dùng getter.
- **Action**: bỏ `getConfiguredSmcMinSignalConfidence` khỏi import statement (giữ `getConfiguredSmcSignalFreshnessCandles`). Đồng thời có thể bỏ mock getter này trong `tests/charts/smc/smc-pipeline.test.ts` (dòng 16, 26, 141, 1209) nếu bỏ xong test vẫn pass — nếu không chắc thì chỉ cần bỏ import ở src.

## Definition of done

1. Fix R2-1 và R2-2.
2. `npm run build` + full `npm run test` pass, dán số liệu vào result.md của subtask 03 (hoặc FIXES_APPLIED.md).
3. Không sửa gì khác.

Sau khi 2 fix này xong, Lead sẽ ghi `done.md`.
