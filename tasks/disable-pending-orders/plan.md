# Plan — Disable "Check Pending Orders" feature (signals-only mode)

## Bối cảnh

Người dùng hiện tại chỉ muốn nhận **signal thô** qua Telegram. Không muốn hệ thống:
- tự tạo `pending_orders` row từ setup có confidence đủ ngưỡng nhưng không auto-open (`savePendingOrder`)
- tự động resolve/trigger/cancel/expire các pending order đó (`runCheckPendingOrders`)

**Không đổi database.** Schema, migrations, `positions-repository.ts` (`savePendingOrder`, `loadPendingOrders`, `updatePendingOrder`), `check-pending-orders-runner.ts`, `position-decision.ts` (`resolvePendingOrderDecision`) **giữ nguyên 100%** — chỉ comment lại các **call site** ở 2 entrypoint để có thể bật lại nhanh sau này bằng cách bỏ comment.

Feature "check open trades" (`runCheckOpenTrades`, quản lý position đã mở) **không liên quan** và **không được đụng vào**.

## Phạm vi (Scope)

### Trong scope
- `src/charts/smc-index.ts` — comment call `savePendingOrder(setup)` (dòng ~134) và `runCheckPendingOrders()` (dòng ~209), điều chỉnh điều kiện heartbeat cho khớp.
- `src/charts/index.ts` — comment call `savePendingOrder(setup)` (dòng ~211). `runCheckPendingOrders()` ở đây đã bị comment sẵn từ trước (dòng 316) — dọn lại cho sạch (xóa dòng rác `// + pendingNotifications == 0`, thêm comment rõ lý do disable có chủ đích, không phải bug).
- `tests/charts/smc-index.test.ts` — cập nhật test để không còn assert `savePendingOrder`/`runCheckPendingOrders` được gọi.
- `tests/charts/index.test.ts` — dọn các dòng test đã comment liên quan đến `savePendingOrder`/`runCheckPendingOrders` cho khớp code mới, không để lại code chết gây nhầm lẫn.

### Ngoài scope — KHÔNG được đụng
- Mọi migration trong `supabase/migrations/`.
- `src/charts/positions-repository.ts` (savePendingOrder, loadPendingOrders, updatePendingOrder, findOpenPositionIdByPair).
- `src/charts/check-pending-orders-runner.ts` (toàn bộ file).
- `src/charts/position-decision.ts` — `resolvePendingOrderDecision` (giữ nguyên; `resolveOpenPositionDecision` càng không đụng).
- `src/charts/analyzer.ts` — `buildPendingOrderCheckPrompt`/`parsePendingOrderCheckResponse` (dead code cũ, không liên quan task này).
- `src/charts/chart-config-env.ts` — `getConfiguredPendingOrderExpiryRuns()`.
- `.github/workflows/*.yml` — không cần đổi, các job vẫn chạy `npm run analyze` / `npm run analyze:smc` bình thường.
- `tests/charts/check-pending-orders-runner.test.ts`, `tests/charts/position-decision.test.ts`, `tests/charts/positions-repository.test.ts`, `tests/charts/chart-config-env.test.ts` — các file test cho logic core, không đụng.

## Cách disable

Chỉ **comment call site** (không early-return/không comment bên trong file logic), theo quyết định của user: dễ bật lại bằng cách bỏ comment 1-2 dòng, không rủi ro merge conflict lan rộng.

## ## Subtasks

| # | Subtask | File chính | Mô tả |
|---|---------|-----------|-------|
| 01 | disable-smc-entrypoint | `src/charts/smc-index.ts`, `tests/charts/smc-index.test.ts` | Comment `savePendingOrder` + `runCheckPendingOrders` call trong SMC entrypoint, sửa điều kiện heartbeat, sửa test |
| 02 | disable-volman-entrypoint | `src/charts/index.ts`, `tests/charts/index.test.ts` | Comment `savePendingOrder` call, dọn lại `runCheckPendingOrders` (đã comment sẵn) cho rõ ràng có chủ đích, sửa test |

## Verification

Sau khi cả 2 subtask xong:
```bash
npm run build
npm run test
```
Không được có test nào fail. Không được có warning `unused variable` mới do comment code (nếu import chỉ dùng cho dòng bị comment, phải comment luôn import hoặc để `// eslint-disable` — xem chi tiết trong từng task.md).
