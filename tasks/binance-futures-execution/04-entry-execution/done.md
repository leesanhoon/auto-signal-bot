# Done — 04-entry-execution

**Status:** APPROVED

`binance-execution-volman.ts` — `openBinanceFuturesPosition` đối chiếu code thật, xác nhận đủ các quy tắc fail-safe bất biến trong plan.md:
- Hedge mode check chạy đầu tiên, throw trước khi đặt bất kỳ lệnh nào.
- Mọi `stopPrice` (SL/TP1/TP2) qua `roundToTickSize`; TP quantity qua `splitTpQuantities`.
- Fail-safe: hủy hết lệnh conditional đã đặt (`placedProtectionOrders`) trước khi đóng vị thế; kiểm tra kết quả lệnh đóng khẩn cấp, phân biệt alert 🚨 (đóng thành công) vs 🚨🚨 (đóng cũng fail — cần xử lý tay ngay).
- `saveBinanceExecutionDetails` nằm trong try/catch riêng, tách khỏi logic đặt lệnh SL/TP — lỗi DB không kích hoạt đóng khẩn cấp vị thế khỏe mạnh.
- Không gửi `positionSide` — đúng one-way mode.
- Wiring vào `index.ts` đúng vị trí, không đổi logic auto-track khác.

`npm run build && npm run test` pass (74 file / 786 test).
