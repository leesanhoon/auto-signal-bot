# Done — binance-futures-execution

**Status:** APPROVED — toàn bộ 6/6 subtask đạt

Review đối chiếu trực tiếp `plan.md` + từng `task.md` với code thật (không chỉ dựa `result.md`) cho cả 6 subtask. Xác nhận toàn bộ các quy tắc fail-safe bất biến bổ sung lúc review plan đều được Worker implement đúng:

1. Hedge mode check trước khi đặt lệnh (task 04).
2. `roundToTickSize` áp dụng cho mọi `stopPrice` gửi lên Binance, kể cả SL breakeven (task 03/04/05).
3. `splitTpQuantities` chia qty TP1/TP2 khớp stepSize (task 03/04).
4. Fail-safe hủy hết lệnh conditional treo + kiểm tra kết quả lệnh đóng khẩn cấp, không báo sai "đã đóng" (task 04).
5. Tách `saveBinanceExecutionDetails` khỏi try/catch đặt lệnh SL/TP — lỗi DB không kích hoạt đóng khẩn cấp vị thế khỏe mạnh (task 04).
6. Đặt SL breakeven mới trước, hủy SL cũ sau (task 05).
7. Xử lý `binanceExecutionStatus === "failed"` → đóng bản ghi DB, tránh treo HOLD mãi mãi (task 05).

## Verification
- `npm run build` — pass.
- `npm run test` — pass (74 test file / 786 test).
- Không có `positionSide` trong bất kỳ order call nào — one-way mode đúng thiết kế.
- Không tự apply migration lên Supabase production (đúng ràng buộc).

## Trước khi bật `BINANCE_LIVE_TRADING_ENABLED=true` (việc của user, không phải Worker)
- Áp dụng Preconditions trong `plan.md`: tài khoản Binance Futures ở One-way mode, đồng hồ mini PC sync NTP, API key chỉ quyền Futures + restrict IP.
- Khuyến nghị chạy thử trên testnet (`BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com`) trước khi trỏ production.
- Tự chạy migration `supabase/migrations/20260711000000_add_binance_execution_columns.sql` lên Supabase.
- Tự tạo `BINANCE_API_KEY`/`BINANCE_API_SECRET` và set các biến env còn lại.
