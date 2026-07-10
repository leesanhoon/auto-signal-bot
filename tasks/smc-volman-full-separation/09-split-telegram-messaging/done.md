# Done — Subtask 09: Split shared/telegram.ts

**Lead reviewer:** Sonnet 5 · **Ngày:** 2026-07-10

## Evidence đã verify
- `src/shared/telegram-client.ts`, `telegram-volman.ts`, `telegram-smc.ts` tồn tại.
- `telegram-volman.ts` export đầy đủ `buildHeartbeatMessage`, `buildPositionDecisionMessage`, `buildPerformanceReportMessage`, `sendAllAnalysesVolman` (grep xác nhận dòng 373); import `PerformanceReport` từ `../charts/performance-tracking-volman.js` và `getConfiguredChartSignalConfidenceThreshold` từ `../charts/volman-config-env.js` (đúng theo dependency đã sửa 02/03/08).
- `telegram-smc.ts` export `sendAllAnalysesSmc` (dòng 359) tương ứng bản SMC.
- `npm run build` + `npm run test` (chạy chung, xem review-summary.md) pass.

## Kết luận
APPROVED — đạt yêu cầu task.md + plan.md, dependency thật khớp với dependency đã sửa ở lần review plan trước, không deviation.
