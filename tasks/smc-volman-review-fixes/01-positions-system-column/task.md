# Task 01 — Thêm cột `system` cho open_positions / pending_orders

**Mục tiêu:** Hai hệ thống (Volman và SMC) hiện ghi chung 2 bảng và dedup chỉ theo `pair`, khiến tín hiệu hệ này chặn tín hiệu hệ kia. Thêm cột `system` và dedup theo `(pair, system)`.

**KHÔNG làm:** không sửa check-open-trades-runner, check-pending-orders-runner, performance report, telegram. Không refactor gì ngoài các thay đổi liệt kê dưới.

## Bước 1 — Migration

Tạo file mới `supabase/migrations/20260710120000_positions_add_system_column.sql` (đặt timestamp lớn hơn migration mới nhất hiện tại là `20260710000001_ohlc_candle_cache.sql`):

```sql
alter table open_positions
  add column if not exists system text not null default 'volman';

alter table pending_orders
  add column if not exists system text not null default 'volman';

create index if not exists idx_open_positions_pair_system_status
  on open_positions (pair, system, status);

create index if not exists idx_pending_orders_pair_system_status
  on pending_orders (pair, system, status);
```

## Bước 2 — Helper derive system

Trong `src/charts/position-engine.ts`, thêm export mới (đặt gần `buildOpenPositionInsertRow`, hiện ở dòng ~254):

```ts
export type SignalSystem = "volman" | "smc";

export function deriveSignalSystem(
  setup: Pick<TradeSetup, "detectionSource">,
): SignalSystem {
  return setup.detectionSource === "smc" ? "smc" : "volman";
}
```

Lưu ý: `TradeSetup.detectionSource` đã tồn tại trong `src/charts/chart-types.ts:47` với type `"deterministic" | "ai" | "smc"`.

## Bước 3 — Insert row có `system`

Trong `src/charts/position-engine.ts`:

- `buildOpenPositionInsertRow` (dòng ~254): mở rộng `Pick<...>` thêm `"detectionSource"`, và thêm `system: deriveSignalSystem(setup)` vào object trả về.

Trong `src/charts/positions-repository.ts`:

- `buildPendingOrderInsertRow` (dòng ~79): thêm `system: deriveSignalSystem(setup)` vào object trả về (import `deriveSignalSystem` từ `./position-engine.js`).

## Bước 4 — Dedup theo (pair, system)

Trong `src/charts/positions-repository.ts`:

- `saveOpenPosition` (dòng ~58-77): query dedup hiện tại là

  ```ts
  .select("id")
  .eq("status", "open")
  .eq("pair", setup.pair)
  ```

  thêm `.eq("system", deriveSignalSystem(setup))`.

- `savePendingOrder` (dòng ~110-124): tương tự, thêm `.eq("system", deriveSignalSystem(setup))` vào query dedup (hiện filter `status = "PENDING"` + `pair`).

## Bước 5 — Tests

- Cập nhật tests hiện có nếu fail (tests liên quan: `tests/charts/positions-repository.test.ts`, `tests/charts/position-engine.test.ts` — mock Supabase có thể assert query chain).
- Thêm test mới:
  - `deriveSignalSystem`: `detectionSource: "smc"` → `"smc"`; `"deterministic"` → `"volman"`; `undefined` → `"volman"`.
  - `buildOpenPositionInsertRow` trả row có `system: "smc"` khi setup có `detectionSource: "smc"`.
  - `saveOpenPosition` KHÔNG bị chặn duplicate khi đã có position cùng `pair` nhưng khác `system` (mock query trả rỗng khi filter system khác — assert `.eq` được gọi với `("system", ...)`).

## Verification

```bash
npm run build
npm run test
```

Ghi kết quả (kèm output 2 lệnh, số test pass) vào `tasks/smc-volman-review-fixes/01-positions-system-column/result.md`. Nếu blocked → ghi `blocked.md`, không đoán.
