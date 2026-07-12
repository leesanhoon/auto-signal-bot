# Task 01 — Thêm cột timeframe vào open_positions_volman

## Bối cảnh

Dự án: `H:\LeeSanHoon\auto-signal-bot`, hệ Bob Volman (crypto Binance Futures). Bảng Supabase
`public.open_positions_volman` hiện KHÔNG có cột lưu timeframe (M15/H1/H4) của setup đã mở vị thế.
Bảng `public.pending_orders_volman` ĐÃ có cột `primary_timeframe` (text, giá trị `"D1"|"H4"|"M15"`)
— dùng làm tham chiếu style đặt tên cột.

Supabase project id: `irgworcpfyfuigyvylkj` (dùng MCP tool Supabase nếu có, hoặc SQL migration file
nếu project dùng migration-based workflow — kiểm tra thư mục `supabase/migrations/` trước, nếu có thì
tạo migration mới theo đúng convention đang dùng).

## Việc cần làm

1. Thêm cột `primary_timeframe` kiểu `text` (nullable) vào bảng `public.open_positions_volman`,
   cho phép giá trị `'M15'`, `'H1'`, `'H4'`, `'D1'` (không cần CHECK constraint cứng nếu bảng khác
   trong dự án không dùng CHECK constraint cho cột tương tự — kiểm tra `pending_orders_volman`
   trước để nhất quán).
2. Backfill 2 row hiện có trong `open_positions_volman` (id=7 pair=TIA/USDT, id=8 pair=INJ/USDT)
   thành `primary_timeframe = 'M15'` (cả 2 được mở lúc test chạy với `CHART_PRIMARY_TIMEFRAME=M15`).
   KHÔNG đổi bất kỳ cột nào khác của 2 row này.
3. Cập nhật type TypeScript tương ứng trong
   [`src/charts/positions-repository-volman.ts`](../../../src/charts/positions-repository-volman.ts):
   - Tìm type `OpenPosition` (dùng trong `loadOpenPositions`) — thêm field `primaryTimeframe: "M15" | "H1" | "H4" | "D1" | null`.
   - Tìm hàm dựng row insert cho `open_positions_volman` (tên hàm có thể là
     `buildOpenPositionInsertRow` — grep để xác nhận tên chính xác, đừng đoán) — thêm
     `primary_timeframe: setup.primaryTimeframe ?? null` vào object trả về (KHÔNG mặc định `"H4"`
     như hàm `buildPendingOrderInsertRow` đang làm — với open position phải biết chính xác
     timeframe nào mở nó, không được đoán).
   - Cập nhật hàm `loadOpenPositions` để `select(...)` có thêm cột `primary_timeframe` và map
     sang `primaryTimeframe` trong object trả về.

## Việc KHÔNG được làm

- Không xoá, không sửa dữ liệu khác của 2 row id=7, id=8 ngoài cột mới thêm.
- Không đổi tên/xoá cột nào khác trong bảng.
- Không động vào bảng `pending_orders_volman`, `open_positions_smc`, `pending_orders_smc` (task này
  chỉ scope cho Volman open positions).
- Không tự ý thêm mặc định `"H4"` khi `setup.primaryTimeframe` là `null`/`undefined` — giữ `null`.

## Kiểm tra hoàn thành (Worker tự verify trước khi ghi result.md)

1. Query lại schema bảng để xác nhận cột `primary_timeframe` đã tồn tại, kiểu `text`, nullable.
2. Query 2 row id=7, id=8 xác nhận `primary_timeframe = 'M15'`, các cột khác không đổi.
3. `npx tsc --noEmit` không có lỗi.
4. `npx vitest run` — toàn bộ test hiện có phải pass (baseline trước khi làm: 898 test pass).

## Ghi kết quả

Ghi vào `result.md` cùng thư mục: câu lệnh SQL/migration đã chạy, output xác nhận schema + 2 row,
kết quả tsc + vitest (số test pass/fail), và tên chính xác các hàm/type đã sửa trong
`positions-repository-volman.ts` (kèm số dòng).
