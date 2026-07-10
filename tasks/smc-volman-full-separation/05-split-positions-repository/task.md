# Task 05 — Tách positions-repository.ts theo hệ (dùng bảng DB đã tách ở task 01)

Đọc `tasks/smc-volman-full-separation/plan.md` và `tasks/smc-volman-full-separation/context.md` trước.

Phụ thuộc: Subtask 01 (bảng), Subtask 03 (`getConfiguredPendingOrderExpiryRuns` từ `volman-config-env.js`/`smc-config-env.js`), Subtask 04 (`position-engine-volman.ts`/`position-engine-smc.ts`), và Subtask 08 (`performance-tracking-volman.ts`/`-smc.ts` — vì `buildClosedPositionSnapshot`/`ClosedPositionRecord` được import từ đó) phải xong trước.

**⚠️ Cập nhật sau self-review:** `src/charts/positions-repository-volman.ts` **đã tồn tại sẵn** trong working tree (chưa commit). Trước khi làm bất kỳ bước nào, đọc file này trước. Đã phát hiện 1 lỗi trong bản có sẵn: dòng `import type { PendingOrder, PendingOrderStatus } from "./chart-types.js";` vẫn trỏ vào file `chart-types.js` GỐC (dùng chung cũ) thay vì `./chart-types-volman.js`. Việc của bạn: sửa lại import này cho đúng (`PendingOrder`, `PendingOrderStatus` phải lấy từ `./chart-types-volman.js`), rồi đối chiếu toàn bộ phần còn lại của file với spec bên dưới — chỉ sửa phần sai/thiếu, không viết lại từ đầu nếu phần khác đã đúng. Áp dụng tương tự cho `positions-repository-smc.ts` nếu cũng có lỗi tương tự.

## Files được phép sửa/tạo
- Tạo mới: `src/charts/positions-repository-volman.ts`
- Tạo mới: `src/charts/positions-repository-smc.ts`
- Tạo mới: `tests/charts/positions-repository-volman.test.ts`
- Tạo mới: `tests/charts/positions-repository-smc.test.ts`
- KHÔNG sửa/xoá `src/charts/positions-repository.ts` gốc.

## Nội dung copy vào CẢ HAI file

Từ `src/charts/positions-repository.ts`, copy toàn bộ export: `OpenPosition`, `PendingOrderUpdate`, `saveOpenPosition`, `buildPendingOrderInsertRow` (private helper), `savePendingOrder`, `loadPendingOrders`, `updatePendingOrder`, `findOpenPositionIdByPair`, `loadOpenPositions`, `loadClosedPositions`, `updatePositionDecision`, `buildPositionManagementPatch`, `closePosition`.

## Thay đổi so với bản gốc

1. `positions-repository-volman.ts`:
   - Import từ `./position-engine-volman.js` thay vì `./position-engine.js` (bỏ `deriveSignalSystem` khỏi import list — không dùng nữa).
   - Import type `TradeSetup, PendingOrder, PendingOrderStatus` từ `./chart-types-volman.js`.
   - Import `getConfiguredPendingOrderExpiryRuns` từ `./volman-config-env.js`.
   - Mọi `.from("open_positions")` → `.from("open_positions_volman")`.
   - Mọi `.from("pending_orders")` → `.from("pending_orders_volman")`.
   - Trong `saveOpenPosition`: XOÁ dòng `.eq("system", deriveSignalSystem(setup))` khỏi query dedup (chỉ còn `.eq("status", "open").eq("pair", setup.pair)`).
   - Trong `savePendingOrder`: XOÁ dòng `.eq("system", deriveSignalSystem(setup))` tương tự.
   - Trong `buildPendingOrderInsertRow`: XOÁ dòng `system: deriveSignalSystem(setup),` khỏi object trả về.
2. `positions-repository-smc.ts`: tương tự bước 1 nhưng import từ `./position-engine-smc.js`, `./chart-types-smc.js`, `./smc-config-env.js`, và `.from(...)` trỏ vào `open_positions_smc`/`pending_orders_smc`.
3. Giữ nguyên toàn bộ logic còn lại (mapping snake_case ↔ camelCase, `buildClosedPositionSnapshot` import từ `./performance-tracking.js` — **giữ nguyên import này tạm thời tới task 08**, vì `performance-tracking.ts` gốc chưa bị xoá).

## Bước — Test

Đọc `tests/charts/positions-repository.test.ts` hiện có, copy pattern mock Supabase (`getDb`) vào 2 file test mới, đổi:
- Assertion `.from("open_positions")` → `.from("open_positions_volman")` (hoặc `_smc`)
- XOÁ các test case assert `.eq("system", ...)` được gọi (không còn áp dụng)
- Giữ nguyên các test case còn lại (dedup theo pair+status, insert row shape, mapping field...)

## Ngoài phạm vi (KHÔNG làm)
- Không sửa `positions-repository.ts` gốc.
- Không sửa `performance-tracking.ts` (task 08 sẽ tách nó và cập nhật import).
- Không sửa `check-open-trades-runner.ts`/`check-pending-orders-runner.ts` (task 07).

## Verification
```bash
npm run build
npm run test
```
Ghi kết quả vào `tasks/smc-volman-full-separation/05-split-positions-repository/result.md`. Nếu bảng DB thật chưa migrate xong (task 01 chưa chạy migration thật ở môi trường có DB), build/test TypeScript vẫn phải pass (test dùng mock Supabase client, không cần DB thật) — chỉ ghi chú rõ trong `result.md` rằng migration DB thật là điều kiện cần trước khi deploy runtime.
