# Done — Subtask 04: Split position-engine.ts

**Lead reviewer:** Sonnet 5 · **Ngày:** 2026-07-10

## Verification

Một review trước (`reviews/smc-volman-full-separation/review-04-split-position-engine.md`, đã xoá) kết luận sai rằng
`position-engine-volman.ts`/`position-engine-smc.ts` vẫn import `TradeSetup` từ `./chart-types.js` gốc. Verify lại trực
tiếp bằng Grep trên code hiện tại:

```
src/charts/position-engine-volman.ts:1: import type { TradeSetup } from "./chart-types-volman.js";
src/charts/position-engine-smc.ts:1:    import type { TradeSetup } from "./chart-types-smc.js";
```

Import đã đúng, không còn trỏ vào `chart-types.js` cũ. Kết luận review trước lỗi thời/sai — có thể do đọc nhầm thời
điểm code. Không có deviation nào khác so với `task.md`:
- `SignalSystem`/`deriveSignalSystem` đã bị loại bỏ hoàn toàn.
- `buildOpenPositionInsertRow` không còn field `system`.
- Logic risk/reward giữ nguyên 100% so với bản gốc.

`npm run build` + `npm run test` (74 files, 809 tests) pass trên toàn bộ working tree hiện tại.

## Kết luận

**APPROVED.**
