# Task 02: Migration DB + repository functions cho Binance execution

## Bối cảnh

`open_positions_volman` hiện không có chỗ lưu thông tin lệnh thật đã đặt trên Binance (order id, symbol, qty, leverage). Task này thêm cột mới (nullable, không phá dữ liệu cũ) + các hàm repository để đọc/ghi chúng. Convention migration trong repo: file SQL đặt tên `supabase/migrations/<timestamp>_<mo_ta>.sql`, `alter table ... add column if not exists`, tên bảng không có schema prefix (xem `supabase/migrations/20260710120000_positions_add_system_column.sql` để tham khảo style).

## Việc cần làm

### File 1: `supabase/migrations/20260711000000_add_binance_execution_columns.sql` (tạo mới)

Copy chính xác:

```sql
alter table open_positions_volman
  add column if not exists binance_symbol text,
  add column if not exists binance_leverage integer,
  add column if not exists binance_quantity numeric,
  add column if not exists binance_entry_order_id bigint,
  add column if not exists binance_sl_order_id bigint,
  add column if not exists binance_tp1_order_id bigint,
  add column if not exists binance_tp2_order_id bigint,
  add column if not exists binance_execution_status text;
```

### File 2: `src/charts/positions-repository-volman.ts` (sửa)

1. Mở rộng type `OpenPosition` (đang ở đầu file, khoảng dòng 16-49): thêm các field sau vào cuối object type (giữ nguyên toàn bộ field cũ, không xoá gì):

```ts
  binanceSymbol: string | null;
  binanceLeverage: number | null;
  binanceQuantity: number | null;
  binanceEntryOrderId: number | null;
  binanceSlOrderId: number | null;
  binanceTp1OrderId: number | null;
  binanceTp2OrderId: number | null;
  binanceExecutionStatus: "pending" | "placed" | "failed" | null;
```

2. Trong `loadOpenPositions()` (khoảng dòng 212-290): thêm các cột vào chuỗi `.select(...)` (nối thêm vào cuối chuỗi hiện có, cách nhau dấu phẩy):
```
, binance_symbol, binance_leverage, binance_quantity, binance_entry_order_id, binance_sl_order_id, binance_tp1_order_id, binance_tp2_order_id, binance_execution_status
```
Thêm các field tương ứng vào type inline `Array<{...}>` bên trong hàm (giống các field khác đã có, kiểu `string | null`/`number | null`), và thêm vào object `.map((row) => ({...}))` trả về:
```ts
    binanceSymbol: row.binance_symbol ?? null,
    binanceLeverage: row.binance_leverage ?? null,
    binanceQuantity: row.binance_quantity ?? null,
    binanceEntryOrderId: row.binance_entry_order_id ?? null,
    binanceSlOrderId: row.binance_sl_order_id ?? null,
    binanceTp1OrderId: row.binance_tp1_order_id ?? null,
    binanceTp2OrderId: row.binance_tp2_order_id ?? null,
    binanceExecutionStatus: row.binance_execution_status ?? null,
```

3. Thêm 2 hàm mới ở cuối file (trước hoặc sau `closePosition`, không quan trọng vị trí):

```ts
export type BinanceExecutionDetails = {
  binanceSymbol: string;
  binanceLeverage: number;
  binanceQuantity: number;
  binanceEntryOrderId: number;
  binanceSlOrderId: number | null;
  binanceTp1OrderId: number | null;
  binanceTp2OrderId: number | null;
  binanceExecutionStatus: "pending" | "placed" | "failed";
};

export async function saveBinanceExecutionDetails(
  positionId: number,
  details: BinanceExecutionDetails,
): Promise<void> {
  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({
      binance_symbol: details.binanceSymbol,
      binance_leverage: details.binanceLeverage,
      binance_quantity: details.binanceQuantity,
      binance_entry_order_id: details.binanceEntryOrderId,
      binance_sl_order_id: details.binanceSlOrderId,
      binance_tp1_order_id: details.binanceTp1OrderId,
      binance_tp2_order_id: details.binanceTp2OrderId,
      binance_execution_status: details.binanceExecutionStatus,
    })
    .eq("id", positionId);

  if (error) throw new Error(`saveBinanceExecutionDetails failed: ${error.message}`);
}

export async function updateBinanceSlOrder(
  positionId: number,
  newSlOrderId: number,
  newStopLoss: string,
): Promise<void> {
  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({
      binance_sl_order_id: newSlOrderId,
      stop_loss: newStopLoss,
    })
    .eq("id", positionId);

  if (error) throw new Error(`updateBinanceSlOrder failed: ${error.message}`);
}
```

## Ràng buộc

- KHÔNG đổi tên bảng, KHÔNG thêm index/RLS/trigger ngoài những gì liệt kê ở trên.
- KHÔNG sửa bất kỳ hàm nào khác trong `positions-repository-volman.ts` ngoài `loadOpenPositions()` (mở rộng select/map) và 2 hàm mới thêm vào cuối.
- KHÔNG tự chạy migration lên Supabase production (không gọi `apply_migration`). Chỉ tạo file.
- Giữ nguyên toàn bộ field cũ trong `OpenPosition`, không xoá/đổi tên field nào đã có.

## Cách verify

```bash
npm run build
npm run test
```
Chạy test hiện có `tests/charts/positions-repository-volman.test.ts` (nếu có) — không được fail do thay đổi type/select.

## Output

Ghi vào `tasks/binance-futures-execution/02-db-migration-repository/result.md`:
- Nội dung file migration đã tạo
- Diff/đoạn code đã thêm vào `positions-repository-volman.ts`
- Kết quả `npm run build && npm run test`

Nếu bị chặn (ví dụ không chắc timestamp migration nào là "mới nhất" hiện tại, hoặc test hiện có fail vì lý do khác không liên quan) → ghi `blocked.md`, không tự đoán, không tự sửa các phần ngoài scope.
