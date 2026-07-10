# Task 07 — Tách position-decision.ts + check-open-trades-runner.ts + check-pending-orders-runner.ts theo hệ

Đọc `tasks/smc-volman-full-separation/plan.md` và `tasks/smc-volman-full-separation/context.md` trước.

Phụ thuộc: Subtask 04, 05 phải xong trước.

## Files được phép sửa/tạo
- Tạo mới: `src/charts/position-decision-volman.ts`, `src/charts/position-decision-smc.ts`
- Tạo mới: `src/charts/check-open-trades-runner-volman.ts`, `src/charts/check-open-trades-runner-smc.ts`
- Tạo mới: `src/charts/check-pending-orders-runner-volman.ts`, `src/charts/check-pending-orders-runner-smc.ts`
- Tạo mới test tương ứng dưới `tests/charts/` cho cả 6 file trên.
- KHÔNG sửa/xoá `position-decision.ts`, `check-open-trades-runner.ts`, `check-pending-orders-runner.ts` gốc.
- KHÔNG sửa `src/charts/screenshot.ts` (giữ chung — `findChartForPair`, `fetchCandleRangeStats`).
- KHÔNG sửa `src/shared/telegram.ts` (task 09 sẽ tách; ở task này 2 runner mới vẫn import tạm `buildPositionDecisionMessage`/`sendMessage` từ `../shared/telegram.js` gốc — sẽ đổi lại ở task 09 nếu cần, nhưng KHÔNG bắt buộc sửa lại ở task 09 nếu quá phức tạp, miễn build pass).

## Bước 1 — `position-decision-volman.ts` / `position-decision-smc.ts`

Copy toàn bộ nội dung `src/charts/position-decision.ts` (đã đọc đầy đủ — các hàm `resolveOpenPositionDecision`, `resolvePendingOrderDecision` và helper private) vào cả 2 file y nguyên logic. Đổi import:
- `position-decision-volman.ts`: `import type { OpenPosition } from "./positions-repository-volman.js";` và `import type { CandleRangeStats } from "./chart-types-common.js"; import type { PendingOrder } from "./chart-types-volman.js";` và `import type { PositionDecisionOutcome } from "./position-engine-volman.js";`
- `position-decision-smc.ts`: tương tự nhưng trỏ vào `-smc` versions.

Logic tính toán (so sánh giá, breakeven, trigger...) giữ nguyên 100%, không đổi.

## Bước 2 — `check-open-trades-runner-volman.ts` / `-smc.ts`

Copy toàn bộ `src/charts/check-open-trades-runner.ts` vào cả 2 file. Đổi import:
- Volman: `loadOpenPositions` từ `./positions-repository-volman.js`; `buildPositionManagementPatch`, `closePosition`, `updatePositionDecision` cũng từ đó; `PositionDecisionOutcome` từ `./position-engine-volman.js`; `resolveOpenPositionDecision` từ `./position-decision-volman.js`.
- SMC: tương tự trỏ vào các bản `-smc`.
- Cả 2 vẫn giữ `import { fetchCandleRangeStats, findChartForPair } from "./screenshot.js";` (không đổi — file này giữ chung) và `import { buildPositionDecisionMessage, sendMessage } from "../shared/telegram.js";` (giữ nguyên tạm thời, chưa tách ở task này).
- Đổi tên logger: `createLogger("charts:check-open-trades-volman")` / `createLogger("charts:check-open-trades-smc")`.
- Đổi tên export function nếu cần tránh trùng khi cả 2 file được import cùng lúc ở entrypoint sau này: giữ tên `runCheckOpenTrades` và `processPosition` giống nhau ở cả 2 file (không sao vì chúng ở module path khác nhau, import riêng biệt theo tên module).

## Bước 3 — `check-pending-orders-runner-volman.ts` / `-smc.ts`

Copy toàn bộ `src/charts/check-pending-orders-runner.ts` vào cả 2 file, đổi import tương tự bước 2 (`positions-repository-{volman,smc}.js`, `position-engine-{volman,smc}.js`, `chart-types-{volman,smc}.js`, `position-decision-{volman,smc}.js`), giữ `screenshot.js` và `../shared/telegram.js` dùng chung tạm thời. Lưu ý: runner này hiện đang bị comment-out ở cả 2 entrypoint (signals-only mode) — vẫn phải tách đúng cấu trúc dù chưa được gọi.

## Bước 4 — Test

Copy pattern test hiện có (`tests/charts/position-decision.test.ts`, `tests/charts/check-open-trades-runner.test.ts`, `tests/charts/check-pending-orders-runner.test.ts` — đọc các file này trước nếu tồn tại) vào các file test mới tương ứng, đổi import path. Giữ nguyên toàn bộ test case logic, chỉ đổi tên module import.

## Ngoài phạm vi (KHÔNG làm)
- Không sửa `screenshot.ts`, `shared/telegram.ts`.
- Không sửa `index.ts`/`smc-index.ts` (task 10 sẽ trỏ 2 entrypoint sang các runner mới này).
- Không bật lại `check-pending-orders-runner` (vẫn giữ signals-only mode, chỉ tách file).

## Verification
```bash
npm run build
npm run test
```
Ghi kết quả vào `tasks/smc-volman-full-separation/07-split-position-decision-and-check-runners/result.md`.
