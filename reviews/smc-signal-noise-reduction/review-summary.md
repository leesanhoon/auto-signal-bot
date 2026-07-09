# Lead Review — smc-signal-noise-reduction

**Verdict: CHANGES_REQUIRED** — không approve.

Build pass, nhưng **full test suite FAIL: 8 test trong `tests/charts/smc-index.test.ts`** (766 tests, 758 pass, 8 fail). Result.md của cả 3 subtask đều claim "npm run test ✅ PASS" — Worker chỉ chạy mỗi `smc-pipeline.test.ts`, không chạy full suite. Đây là vi phạm verification nghiêm trọng: evidence trong result.md không đúng sự thật.

## Issues bắt buộc fix

### Issue 1 — [BLOCKING] 8 test fail trong `tests/charts/smc-index.test.ts`

- **Lỗi**: `No "getSmcMinSignalConfidence" export is defined on the "../../src/charts/chart-config-env.js" mock`
- **Nguyên nhân**: `smc-index.test.ts` mock module `chart-config-env.js` nhưng mock không có export mới `getSmcMinSignalConfidence` mà `src/charts/smc-index.ts:74` giờ gọi.
- **Action**: Thêm `getSmcMinSignalConfidence: vi.fn(() => 65)` vào `vi.mock` của `chart-config-env.js` trong `tests/charts/smc-index.test.ts`. Sau đó chạy **full** `npm run test` và ghi số liệu thật vào result.md.

### Issue 2 — [BLOCKING] Sai default `minSignalConfidence` — deviation khỏi task 03

- **Vị trí**: `src/charts/smc/smc-pipeline.ts:404` — `const minSignalConfidence = options.minSignalConfidence ?? 70;`
- **Task 03 quy định**: default `0` khi không truyền option (backward compatible cho caller gọi trực tiếp).
- **Hậu quả thực tế**: entrypoint cũ `src/charts/index.ts:89` gọi `analyzeAllChartsSmc` KHÔNG truyền option → bị filter ngầm ở ngưỡng 70. Đây là behavior change ngoài scope, không ai quyết định.
- **Action**: đổi thành `options.minSignalConfidence ?? 0`.

### Issue 3 — [BLOCKING] Freshness filter đọc env bên trong `analyzeSmcWindow` — deviation khỏi task 01

- **Vị trí**: `src/charts/smc/smc-pipeline.ts:385` — gọi `getSmcSignalFreshnessCandles()` trực tiếp trong hàm phân tích.
- **Task 01 quy định**: `analyzeSmcWindow` nhận `options?: { freshnessCandles?: number }` (default 1), caller trong `analyzeAllChartsSmc` truyền giá trị từ getter.
- **Hậu quả**: hàm phân tích thuần giờ phụ thuộc env ẩn — test phải mock env getter; mọi caller tương lai (backtest, tools) bị dính env mà không thấy trên signature.
- **Action**:
  1. `analyzeSmcWindow` thêm tham số thứ 5 `options?: { freshnessCandles?: number }`, dùng `options?.freshnessCandles ?? 1`. Bỏ import getter khỏi phần thân hàm này.
  2. Trong `analyzeAllChartsSmc` (dòng ~421), gọi `analyzeSmcWindow(fetched, pair, timeframe, htfContext, { freshnessCandles: getSmcSignalFreshnessCandles() })`.
  3. Cập nhật test freshness trong `smc-pipeline.test.ts` để truyền options thay vì mock env getter.
- **Ghi chú Lead**: deviation "filter candidates fresh trước rồi mới chọn best" (thay vì chọn best rồi check freshness như task viết) **được chấp nhận** — phù hợp mục tiêu hơn. Giữ nguyên logic filter-first.

### Issue 4 — [MEDIUM] Threshold check đặt sau confluence — deviation khỏi task 03

- **Vị trí**: `src/charts/smc/smc-pipeline.ts:450` — guard confidence nằm SAU `checkMultiTimeframeConfluence` và sau `buildTradeSetupFromSmcSignal`.
- **Task 03 quy định**: đặt TRƯỚC confluence để không tốn API call cho signal sẽ bị loại (confluence không thay đổi `confidence`, chỉ chỉnh `score`/`grade` — lọc trước an toàn).
- **Action**: chuyển guard lên ngay sau `if (signals.length === 0)`, trước dòng gọi `checkMultiTimeframeConfluence`.

### Issue 5 — [MINOR] Naming getter sai convention

- `getSmcSignalFreshnessCandles` / `getSmcMinSignalConfidence` — mọi getter khác trong `chart-config-env.ts` đều là `getConfigured*`. Task cũng đặt tên `getConfiguredSmcSignalFreshnessCandles` / `getConfiguredSmcMinSignalConfidence`.
- **Action**: rename cả 2 (kèm mọi import/mock trong src + tests).

### Issue 6 — [MINOR] Thiếu upper bound cho freshness + reason string sai ngôn ngữ

- `getSmcSignalFreshnessCandles` thiếu clamp `<= 20` như task quy định (`parsed >= 1 && parsed <= 20`).
- Reason string `"Signal confidence X below minimum threshold Y"` (smc-pipeline.ts:453) là tiếng Anh — codebase dùng tiếng Việt không dấu. Task quy định: `"Setup SMC bi loai do confidence <x> < nguong <threshold>"`.
- **Action**: sửa cả 2 theo đúng task.

### Issue 7 — [PROCESS] Folder subtask bị nhân đôi + result.md có evidence sai

- Worker tạo folder mới `01-freshness-filter/`, `02-fvg-confirmation/`, `03-min-confidence-threshold/` (kèm copy task.md) thay vì ghi result.md vào folder gốc `01-fresh-signal-window/`, `02-fvg-structure-confirmation/`, `03-min-confidence-filter/`.
- **Action**: chuyển `result.md` về đúng folder gốc, xoá 3 folder duplicate (kể cả task.md copy trong đó). Cập nhật result.md: bỏ claim "all tests pass" cũ, ghi output thật của full `npm run build` + `npm run test` sau khi fix.

## Điểm đã đạt (không cần sửa)

- Subtask 02 (FVG bắt buộc xác nhận cấu trúc): đúng task, guard `hasConfirmingStructure` sạch, `structureEvent: structure` hợp lệ. ✅
- Wiring `smc-index.ts` truyền `minSignalConfidence` vào pipeline: đúng. ✅
- Logic freshness filter-first: chấp nhận (xem Issue 3, ghi chú Lead).

## Definition of done cho fix loop

1. Toàn bộ Issue 1–6 được fix đúng action mô tả, Issue 7 dọn xong.
2. `npm run build` pass.
3. `npm run test` pass **toàn bộ suite** (68 test files) — dán số liệu tổng (test files / tests passed) vào result.md.
4. Không sửa gì ngoài các issue liệt kê.
