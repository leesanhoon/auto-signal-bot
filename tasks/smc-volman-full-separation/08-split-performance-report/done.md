# Done — Subtask 08: Split performance-tracking + performance-report-runner

**Lead reviewer:** Sonnet 5 · **Ngày:** 2026-07-10

## Evidence đã verify
- `src/charts/performance-tracking-volman.ts`/`-smc.ts` và `performance-report-runner-volman.ts`/`-smc.ts` tồn tại.
- `performance-tracking-volman.ts` import `PositionDecisionAction` từ `./position-engine-volman.js` (đúng theo task.md).
- `performance-report-runner-volman.ts` import `loadClosedPositions` từ `./positions-repository-volman.js`, `summarizeClosedPositionsPerformance` từ `./performance-tracking-volman.js` (đúng).
- Vẫn import `sendMessage, buildPerformanceReportMessage` từ `../shared/telegram.js` gốc — ĐÚNG NHƯ TASK.MD CHO PHÉP (task 08 nói rõ "giữ nguyên import này tạm thời", việc rewire sang `telegram-volman.js` là việc của task 10).
- `npm run build` + `npm run test` (chạy chung, xem review-summary.md) pass.

## Kết luận
APPROVED — đạt yêu cầu task.md + plan.md, không deviation ngoài phạm vi cho phép.
