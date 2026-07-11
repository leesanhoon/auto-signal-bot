# Task 01: Migration DB + repository functions cho Binance execution (SMC)

## Bối cảnh

`open_positions_smc` hiện không có chỗ lưu thông tin lệnh thật đã đặt trên Binance (order id, symbol, qty, leverage) — y hệt tình trạng cũ của `open_positions_volman` trước khi được xử lý trong `tasks/binance-futures-execution/02-db-migration-repository/`. Task này làm đúng việc tương tự cho bảng SMC. Tham khảo migration đã áp dụng thành công cho Volman: `supabase/migrations/20260711000000_add_binance_execution_columns.sql`.

## Việc cần làm

### File 1: `supabase/migrations/20260712000000_add_binance_execution_columns_smc.sql` (tạo mới)

Copy chính xác:

```sql
alter table open_positions_smc
  add column if not exists binance_symbol text,
  add column if not exists binance_leverage integer,
  add column if not exists binance_quantity numeric,
  add column if not exists binance_entry_order_id bigint,
  add column if not exists binance_sl_order_id bigint,
  add column if not exists binance_tp1_order_id bigint,
  add column if not exists binance_tp2_order_id bigint,
  add column if not exists binance_execution_status text;
```

### File 2: `src/charts/positions-repository-smc.ts` (sửa)

1. Mở rộng type `OpenPosition` (đầu file, dòng ~16-49): thêm các field sau vào cuối object type (giữ nguyên toàn bộ field cũ, không xoá gì):

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

2. Trong `loadOpenPositions()` (dòng ~212-290): thêm các cột vào chuỗi `.select(...)` (nối thêm vào cuối chuỗi hiện có, cách nhau dấu phẩy):
```
, binance_symbol, binance_leverage, binance_quantity, binance_entry_order_id, binance_sl_order_id, binance_tp1_order_id, binance_tp2_order_id, binance_execution_status
```
Thêm field tương ứng vào type inline `Array<{...}>` bên trong hàm (kiểu giống các field khác đã có), và thêm vào object `.map((row) => ({...}))` trả về:
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

3. Thêm 2 hàm mới ở cuối file (đặt sau `closePosition`):

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
  const { error } = await (getDb().from("open_positions_smc") as any)
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
  const { error } = await (getDb().from("open_positions_smc") as any)
    .update({
      binance_sl_order_id: newSlOrderId,
      stop_loss: newStopLoss,
    })
    .eq("id", positionId);

  if (error) throw new Error(`updateBinanceSlOrder failed: ${error.message}`);
}
```

## Ràng buộc

- KHÔNG đổi tên bảng, KHÔNG thêm index/RLS/trigger ngoài liệt kê ở trên.
- KHÔNG tự chạy migration lên Supabase production (không gọi `apply_migration`). Chỉ tạo file.
- KHÔNG sửa `supabase/migrations/20260711000000_add_binance_execution_columns.sql` (của Volman) hay bất kỳ migration nào khác đã có.
- KHÔNG sửa hàm nào khác trong `positions-repository-smc.ts` ngoài `loadOpenPositions()` (mở rộng select/map) và 2 hàm mới thêm vào cuối. Giữ nguyên toàn bộ field cũ trong `OpenPosition`, không xoá/đổi tên field nào đã có.
- KHÔNG đụng `positions-repository-volman.ts` hay bất kỳ file `*-volman.ts` nào.

## Cách verify

```bash
npm run build
npm run test
```
Chạy test hiện có `tests/charts/positions-repository-smc.test.ts` (nếu có) — không được fail do thay đổi type/select.

## Output

Ghi vào `tasks/binance-futures-execution-smc/01-db-migration-repository-smc/result.md`:
- Nội dung file migration đã tạo
- Diff/đoạn code đã thêm vào `positions-repository-smc.ts`
- Kết quả `npm run build && npm run test`

Nếu bị chặn (ví dụ cấu trúc `OpenPosition`/`loadOpenPositions()` trong file thực tế khác mô tả) → đọc lại file thực tế, áp dụng đúng logic mô tả ở vị trí tương đương. Nếu vẫn không xác định được → ghi `blocked.md`, không tự đoán.
