# Task 05 — Chạy A/B backtest thật và báo cáo kết quả

Owner: worker
Files được phép sửa/tạo: chỉ trong
`tasks/backtest-pending-order-simulation/results/` (file mới) và
`tasks/backtest-pending-order-simulation/05-run-comparison-and-report/result.md`.
KHÔNG sửa bất kỳ file source code nào.
Phụ thuộc: 01, 02, 03, 04 đều phải đã APPROVED (có `done.md` trong từng thư mục
tương ứng dưới `tasks/backtest-pending-order-simulation/`). Nếu bất kỳ subtask
nào chưa done, ghi `blocked.md` và dừng, liệt kê subtask nào còn thiếu.

Đọc `tasks/backtest-pending-order-simulation/plan.md` phần "5. Chạy A/B thật và
báo cáo" trước khi làm.

## Mục tiêu

Chạy `npm run backtest:compare` trên dữ liệu thật (qua `fetchOhlcHistory`, cần
mạng/API khả dụng) với cấu hình mặc định của repo, lưu bằng chứng, và tóm tắt so
sánh win rate / avg R / số trade giữa 2 chế độ fill.

## Các bước thực hiện

1. Đảm bảo `.env` / biến môi trường cần thiết cho `fetchOhlcHistory` đã có sẵn
   (theo cấu hình hiện tại của repo — không tự tạo API key, dùng đúng những gì
   đã cấu hình sẵn trong máy chạy).

2. Chạy lệnh sau, dùng cấu hình mặc định (H4, 500 bars, exit=fixed,
   pendingExpiryBars=2):
   ```bash
   npm run backtest:compare > tasks/backtest-pending-order-simulation/results/h4-fixed.log 2>&1
   ```
   Nếu `npm run backtest:compare` in JSON lẫn với log ra cùng stdout, tách riêng
   khối JSON cuối cùng ra file `tasks/backtest-pending-order-simulation/results/h4-fixed.json`
   (copy phần JSON hợp lệ cuối output vào file `.json` riêng, dùng `JSON.parse`
   để verify hợp lệ trước khi lưu).

3. Chạy thêm ít nhất 1 cấu hình khác để có góc nhìn thứ hai, ví dụ M15 nếu
   `CHARTS`/`fetchOhlcHistory` hỗ trợ:
   ```bash
   BACKTEST_TIMEFRAME=M15 BACKTEST_BARS=1000 npm run backtest:compare > tasks/backtest-pending-order-simulation/results/m15-fixed.log 2>&1
   ```
   Tách JSON tương tự ra `tasks/backtest-pending-order-simulation/results/m15-fixed.json`.
   Nếu M15 hoặc bất kỳ cấu hình nào lỗi/không đủ dữ liệu, ghi rõ trong
   `result.md`, không cố gắng che giấu, không bịa số liệu.

4. Đọc lại 2 file `.json` kết quả, tổng hợp một bảng so sánh ngắn gọn (Markdown
   table) trong `result.md`:
   - Overall: trades, win rate, avg R cho immediate vs pending, và delta.
   - Theo từng setup (BB/RB/ARB/IRB) nếu có đủ dữ liệu.
   - `pendingStats`: % filled / % cancelled before fill / % expired.

5. Viết nhận xét ngắn (2-4 câu) về xu hướng quan sát được — ví dụ: pending mode
   giảm số trade bao nhiêu %, win rate/avg R thay đổi theo hướng nào — DỰA HOÀN
   TOÀN trên số liệu thực tế đã chạy, không suy diễn thêm ngoài dữ liệu.

## Ngoài phạm vi

- Không sửa code nguồn dù phát hiện gì bất thường trong lúc chạy — nếu nghi ngờ
  bug, ghi rõ trong `result.md`/`blocked.md` để Lead xử lý riêng.
- Không tối ưu/tinh chỉnh tham số (`pendingExpiryBars`, `exitMode`, v.v.) để "ra
  kết quả đẹp" — chỉ chạy với default và 1 cấu hình bổ sung như hướng dẫn.

## Acceptance criteria

- Có ít nhất 1 cặp file `.log` + `.json` hợp lệ trong
  `tasks/backtest-pending-order-simulation/results/` từ một lần chạy
  `npm run backtest:compare` thành công.
- `result.md` có bảng so sánh số liệu overall (bắt buộc) và nhận xét dựa trên số
  liệu thật.
- Nếu không thể chạy được (ví dụ không có mạng/API trong môi trường worker), ghi
  rõ trong `blocked.md`, liệt kê lệnh đã thử và lỗi gặp phải — không tạo số liệu
  giả.

## Ghi kết quả

Viết `tasks/backtest-pending-order-simulation/05-run-comparison-and-report/result.md`
với bảng so sánh, đường dẫn các file `.log`/`.json` đã tạo trong
`tasks/backtest-pending-order-simulation/results/`, và nhận xét. Nếu bị chặn, ghi
`blocked.md`.
