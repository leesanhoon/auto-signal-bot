# Task 02 — Lọc open positions / pending orders theo timeframe

## Bối cảnh

Phụ thuộc: Task 01 đã xong (cột `primary_timeframe` đã có trong `open_positions_volman`, type
`OpenPosition.primaryTimeframe` đã có trong
[`positions-repository-volman.ts`](../../../src/charts/positions-repository-volman.ts)).

Mục tiêu chung: mỗi lần chạy `npm run analyze` với 1 `CHART_PRIMARY_TIMEFRAME` cụ thể (M15/H1/H4)
thì bước "check open trades" và "poll pending orders" CHỈ được động vào các bản ghi thuộc đúng
timeframe đó, không đụng vào bản ghi của timeframe khác.

## Việc cần làm

1. Trong [`src/charts/positions-repository-volman.ts`](../../../src/charts/positions-repository-volman.ts):
   - Sửa `loadOpenPositions()` thành `loadOpenPositions(timeframe: "M15" | "H1" | "H4" | "D1")`
     — thêm `.eq("primary_timeframe", timeframe)` vào query Supabase hiện có (giữ nguyên các
     điều kiện filter khác đã có, ví dụ `.eq("status", "open")` nếu có).
   - Đọc kỹ code hiện tại của `loadOpenPositions` trước khi sửa — không đoán structure query.

2. Trong [`src/charts/check-open-trades-runner-volman.ts`](../../../src/charts/check-open-trades-runner-volman.ts):
   - Sửa `runCheckOpenTrades()` thành `runCheckOpenTrades(timeframe: "M15" | "H1" | "H4" | "D1")`,
     truyền `timeframe` xuống `loadOpenPositions(timeframe)`.
   - Log dòng `"Check open trades starting"` nên kèm `{ timeframe }` trong args để dễ debug log
     sau này (không bắt buộc nhưng nên làm).

3. Trong [`src/charts/binance-execution-volman.ts`](../../../src/charts/binance-execution-volman.ts):
   - Tìm hàm `pollPendingEntryOrders` — kiểm tra nó có load `pending_orders_volman` qua
     `loadPendingOrders()` (không filter theo timeframe hiện tại, vì bảng này vốn multi-timeframe
     dùng chung giữa các lần chạy). Quyết định: **filter theo timeframe TẠI ĐÂY**, tức sau khi
     `loadPendingOrders()` trả về toàn bộ, filter lại mảng kết quả theo
     `order.primaryTimeframe === timeframe` trước khi xử lý tiếp. KHÔNG sửa
     `loadPendingOrders()` trong `positions-repository-volman.ts` (hàm đó dùng chung, có thể có
     caller khác không muốn filter).
   - Thêm tham số `timeframe: "M15" | "H1" | "H4" | "D1"` vào chữ ký hàm `pollPendingEntryOrders`.

4. KHÔNG sửa `binance-execution-shared.ts` trong task này (đó là task 04).

## Việc KHÔNG được làm

- Không sửa file nào thuộc hệ SMC (`*-smc.ts`).
- Không tự ý đổi behavior khi timeframe là giá trị không hợp lệ — nếu cần validate, ném lỗi rõ ràng
  thay vì fallback âm thầm.
- Không đổi cách `loadPendingOrders()` hoạt động cho các caller khác (chỉ filter ở nơi gọi trong
  `binance-execution-volman.ts`).

## Kiểm tra hoàn thành

1. `npx tsc --noEmit` không lỗi — đặc biệt chú ý các nơi gọi `loadOpenPositions()` và
   `runCheckOpenTrades()` khác trong codebase (grep toàn bộ 2 tên hàm này trước khi sửa chữ ký,
   để biết hết các call site cần cập nhật theo chữ ký mới — KHÔNG được để sót call site nào gây
   lỗi biên dịch).
2. `npx vitest run` — pass toàn bộ (test file liên quan:
   `tests/charts/check-open-trades-runner-volman.test.ts` nếu tồn tại — nếu test hiện có mock
   `loadOpenPositions()`/`runCheckOpenTrades()` không truyền timeframe, phải cập nhật mock/call
   cho khớp chữ ký mới).

## Ghi kết quả

Ghi vào `result.md`: danh sách toàn bộ call site đã cập nhật (file + số dòng), diff logic filter,
kết quả tsc + vitest.
