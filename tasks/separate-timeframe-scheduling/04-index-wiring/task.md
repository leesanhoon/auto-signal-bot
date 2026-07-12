# Task 04 — Nối timeframe hiện tại xuống check-open-trades + pending-orders trong index.ts

## Bối cảnh

Phụ thuộc: Task 02 đã xong (`runCheckOpenTrades(timeframe)`,
`pollPendingEntryOrders(timeframe)` đã nhận tham số timeframe). Task 03 đã xong (H1 hỗ trợ đầy đủ).

File chính: [`src/charts/index.ts`](../../../src/charts/index.ts) — đây là entrypoint của
`npm run analyze`, đọc `CHART_PRIMARY_TIMEFRAME` qua `getConfiguredChartPrimaryTimeframe()`
(import từ `volman-config-env.js`).

## Việc cần làm

1. Trong `main()` của `index.ts`, tìm biến đã đọc timeframe hiện tại của lần chạy (khả năng cao
   là biến tên `primaryTimeframe` — grep để xác nhận tên chính xác thay vì đoán).

2. Tìm 2 chỗ gọi:
   - `runCheckOpenTrades()` (dòng ~325-330 theo log runtime, xác nhận số dòng thật bằng grep)
   - `pollPendingEntryOrders()` (tương tự)

   Sửa thành `runCheckOpenTrades(primaryTimeframe)` và `pollPendingEntryOrders(primaryTimeframe)`
   — dùng ĐÚNG biến timeframe của lần chạy hiện tại (không hard-code, không mặc định "H4").

3. Trong [`src/charts/binance-execution-shared.ts`](../../../src/charts/binance-execution-shared.ts),
   tìm đoạn guard cross-system hiện tại (log message
   `"Bo qua entry Binance — symbol da co vi the mo (co the do he khac)"`, quanh dòng ~207-215
   theo lần đọc trước — xác nhận lại số dòng thật). Cập nhật message Telegram gửi kèm (tìm
   `sendMessage(...)` ngay sau log warn đó) để câu chữ rõ ràng hơn, ví dụ thêm gợi ý: "có thể do
   một timeframe khác (M15/H1/H4) của cùng hệ Volman, hoặc hệ SMC, đã mở vị thế trên symbol này
   trước". KHÔNG đổi logic guard, chỉ đổi câu chữ thông báo để dễ hiểu hơn khi vận hành 3
   schedule song song.

## Việc KHÔNG được làm

- Không đổi default `CHART_PRIMARY_TIMEFRAME` trong `.env`/`.env.example` (vẫn là H4).
- Không đổi logic guard "1 symbol 1 vị thế" — đây là giới hạn thật của sàn Binance, không phải
  bug, không được "sửa" để cho phép bypass.
- Không động vào phần quét signal mới (phần phía trên trong `main()`) — task này chỉ scope phần
  check-open-trades + pending-orders.

## Kiểm tra hoàn thành

1. `npx tsc --noEmit` không lỗi.
2. `npx vitest run` — pass toàn bộ.
3. Chạy thử thật (đọc kỹ trước khi chạy — hệ đang live trading thật trên testnet, có thể vào lệnh
   thật):
   ```
   CHART_PRIMARY_TIMEFRAME=M15 npm run analyze
   ```
   Xác nhận trong log: dòng "Checking open positions" / "Check open trades starting" chỉ load và
   xử lý các vị thế có `primary_timeframe = 'M15'` (hiện tại đó là 2 vị thế TIA/USDT #7,
   INJ/USDT #8) — dùng Supabase MCP (nếu có) hoặc log để verify, KHÔNG được thấy vị thế của
   timeframe khác bị động vào (hiện chưa có vị thế H1/H4 nào để test chéo — nếu muốn test đầy đủ,
   ghi rõ trong `result.md` là "chưa test được trường hợp có vị thế H1/H4 song song, cần test khi
   có dữ liệu thật").

## Ghi kết quả

Ghi vào `result.md`: số dòng đã sửa trong `index.ts` và `binance-execution-shared.ts`, log thật
của lần chạy thử, kết quả tsc + vitest.
