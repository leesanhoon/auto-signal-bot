# Done — Subtask 05: Split positions-repository.ts

**Lead reviewer:** Sonnet 5 · **Ngày:** 2026-07-10

## Verification

Một review trước (`reviews/smc-volman-full-separation/review-05-split-positions-repository.md`, đã xoá) kết luận sai
rằng `PendingOrder`/`PendingOrderStatus` vẫn import từ `./chart-types.js` gốc. Verify lại trực tiếp bằng Grep trên
code hiện tại:

```
src/charts/positions-repository-volman.ts:3: import type { PendingOrder, PendingOrderStatus } from "./chart-types-common.js";
src/charts/positions-repository-volman.ts:4: import type { TradeSetup } from "./chart-types-volman.js";
src/charts/positions-repository-smc.ts:3:    import type { PendingOrder, PendingOrderStatus } from "./chart-types-common.js";
src/charts/positions-repository-smc.ts:4:    import type { TradeSetup } from "./chart-types-smc.js";
```

Import đã đúng — `PendingOrder`/`PendingOrderStatus` trỏ về `chart-types-common.ts` (quyết định kiến trúc: giữ chung
vì 2 hệ có field giống hệt nhau, xem quyết định đã ghi trong `plan.md` §Kiến trúc target), `TradeSetup` trỏ đúng file
per-system. Không còn import nào trỏ vào `chart-types.js` cũ. Kết luận review trước lỗi thời/sai.

Việc đã đúng khác (không đổi so với lần review trước):
- Bảng DB đã đổi đúng: `.from("open_positions_volman")`/`"_smc"`, `.from("pending_orders_volman")`/`"_smc"`.
- Dedup query đã bỏ `.eq("system", ...)`, chỉ còn `.eq("pair", ...)`.
- `buildPendingOrderInsertRow` không còn field `system`.
- Test file mới (`positions-repository-volman.test.ts`/`-smc.test.ts`) assertion khớp bảng mới.

`npm run build` + `npm run test` (74 files, 809 tests) pass trên toàn bộ working tree hiện tại.

## Kết luận

**APPROVED.**
