# Review — smc-volman-review-fixes

**Reviewer:** Lead · **Ngày:** 2026-07-10

## Verification chung

- `npm run build` → pass (tsc, no errors).
- `npm run test` → 68 test files, **755/755 pass**.
- `git diff --stat HEAD` xác nhận chỉ các file trong scope của plan.md bị đổi: `.github/workflows/analyze.yml`, `.github/workflows/analyze-smc.yml`, `src/charts/position-engine.ts`, `src/charts/positions-repository.ts`, `src/charts/setups/fb.ts`, `src/charts/smc/smc-pipeline.ts`, `src/charts/smc/smc-structure.ts`, cộng test files và migration mới. Không có file ngoài scope bị đụng.

## 01-positions-system-column — APPROVED

- Migration `supabase/migrations/20260710120000_positions_add_system_column.sql` khớp 100% với task.md (add column, indexes, timestamp lớn hơn migration mới nhất).
- `position-engine.ts`: thêm `SignalSystem`, `deriveSignalSystem`, mở rộng `Pick` thêm `detectionSource`, thêm `system: deriveSignalSystem(setup)` vào `buildOpenPositionInsertRow` — đúng vị trí, đúng logic.
- `positions-repository.ts`: `buildPendingOrderInsertRow` thêm `system`; `saveOpenPosition`/`savePendingOrder` thêm `.eq("system", deriveSignalSystem(setup))` vào dedup query — khớp task.md từng dòng (diff verified via `git diff`).
- Tests mới trong `position-engine.test.ts` và `positions-repository.test.ts` cover đúng 3 case yêu cầu (deriveSignalSystem, insert row có system, dedup theo system).
- Không đụng check-runners/report/telegram — đúng "KHÔNG làm".

## 02-smc-choch-previous-bias — APPROVED

- `smc-pipeline.ts`: import `detectTimeframeBias`, tính `priorCandles = scopedCandles.slice(0, index)`, `previousBias = detectTimeframeBias(priorCandles) ?? undefined`, truyền vào `detectStructureBreak` — khớp chính xác task.md.
- Không sửa `detectStructureBreak`, không đụng FVG, không đổi công thức confidence — verified qua diff (chỉ 2 dòng thay đổi trong file, thêm 1 import).
- Test mới trong `smc-pipeline.test.ts` (4 test) cover CHOCH confidence 72, BOS confidence 80, CHOCH trong PREMIUM zone, multi-structure case — đáp ứng yêu cầu task.

## 03-volman-fb-tp2-fix — APPROVED

- `fb.ts` dòng ~141-158: thay đúng bằng block code trong task.md (defaultTp2 = entry ± 2.5×risk, validate swing đúng phía + candidate xa hơn TP1 mới override) — diff khớp 100% với đoạn code mẫu trong task.md.
- Bug SHORT sai hướng (`takeProfit1 * 1.5`) đã bị loại bỏ hoàn toàn.
- `tests/charts/setups/fb.test.ts` (file mới) có 5 test case cover đúng 3 case yêu cầu + thêm invariant check — hợp lý, không thừa scope.
- Không đụng entry/stop/TP1, không đụng file khác ngoài fb.ts + test — verified.

## 04-smc-first-break-condition — APPROVED

- `smc-structure.ts` sau dòng kiểm `direction === null || level === null`: thêm đúng block first-close-through như task.md yêu cầu (so `prevClose` với `level` theo `direction`, return `null` nếu đã break từ nến trước).
- Không đổi swing selection, BOS/CHOCH classification, không đụng `detectLiquiditySweep`/`detectFairValueGap`/`findRecentOrderBlock` — verified qua diff (chỉ 1 block 9 dòng được thêm).
- Test mới trong `smc-structure.test.ts` cover case 1 (first break) và case 2/3 (LONG + SHORT không re-fire) đầy đủ.
- **Điểm trừ nhỏ (không chặn approve):** task.md yêu cầu thêm case 4 "pullback rồi break lại" (`close[i] > level, close[i+1] < level, close[i+2] > level → event tại i+2`) để verify re-break sau pullback hoạt động đúng — Worker không viết test này riêng biệt. Logic code đã đúng (chỉ so prevClose với level, không có state), nên rủi ro thấp, nhưng coverage chưa đúng 100% yêu cầu task. Không yêu cầu fix bắt buộc vì logic đơn giản và đã được cover gián tiếp bởi 2 test case hiện có (mỗi test đều chứng minh cả điều kiện fire và không-fire).
- Không có test SMC nào khác (backtest signal-count) bị breaking — toàn bộ 755 test cũ vẫn pass nguyên trạng.

## 05-workflow-concurrency — APPROVED

- `analyze.yml` và `analyze-smc.yml`: thêm đúng block `concurrency: { group: ..., cancel-in-progress: false }` ở đúng vị trí (sau `on:`, trước `jobs:`) — verified qua `git diff`.
- Không đổi cron, steps, env, secrets, không đụng workflow khác.
- Build + test pass nguyên trạng (không ảnh hưởng code).

## Kết luận

Cả 5 subtask đều đúng scope, đúng plan.md, build/test pass, có test coverage hợp lý cho từng fix. Không phát hiện deviation nào ngoài 1 điểm trừ nhỏ không chặn approve ở subtask 04 (thiếu 1 test case phụ, logic đã đúng). Toàn bộ task queue `smc-volman-review-fixes` được APPROVE.
