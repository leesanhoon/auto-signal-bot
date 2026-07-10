# Done — Subtask 07: Split position-decision.ts + check-open/pending-orders-runner.ts

**Lead reviewer:** Sonnet 5 · **Ngày:** 2026-07-10

## Verification

Một review trước (`reviews/smc-volman-full-separation/review-07-split-position-decision-and-check-runners.md`, đã
xoá) kết luận sai rằng `PendingOrder` vẫn import từ `./chart-types.js` gốc. Verify lại trực tiếp bằng Grep trên code
hiện tại:

```
src/charts/position-decision-volman.ts:2: import type { CandleRangeStats } from "./chart-types-common.js";
src/charts/position-decision-volman.ts:3: import type { PendingOrder } from "./chart-types-common.js";
src/charts/position-decision-smc.ts:2-3:  (tương tự, đúng chart-types-common.js)
src/charts/check-pending-orders-runner-volman.ts:11: import type { PendingOrder } from "./chart-types-common.js";
src/charts/check-pending-orders-runner-volman.ts:12: import type { TradeSetup } from "./chart-types-volman.js";
src/charts/check-pending-orders-runner-smc.ts:11-12: (tương tự, đúng common/smc)
```

Import đã đúng, không còn trỏ vào `chart-types.js` cũ. Kết luận review trước lỗi thời/sai.

Việc đã đúng khác:
- `check-open-trades-runner-{volman,smc}.ts`: import đúng `positions-repository-{volman,smc}.js`,
  `position-engine-{volman,smc}.js`, `position-decision-{volman,smc}.js`; giữ `../shared/telegram.js` tạm thời (cho
  phép theo task.md, sẽ dọn ở task 09/10).
- Logic tính toán (so sánh SL/TP, breakeven, trigger) không bị đổi.

`npm run build` + `npm run test` (74 files, 809 tests) pass trên toàn bộ working tree hiện tại.

## Kết luận

**APPROVED.**
