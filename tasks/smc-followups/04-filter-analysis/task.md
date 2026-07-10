# Task 04: Phân tích và đề xuất filter (grade/setup/pair)

Prerequisite: Task 01, 02, 03 đã xong.
KHÔNG sửa file src nào. Chỉ chạy lệnh và viết `result.md`. KHÔNG commit.

## Việc cần làm

Chạy backtest với window cố định (dùng `BACKTEST_END_TIME` từ task 02, chọn 1 ngày cụ thể — dùng `2026-07-08T00:00:00Z`), cả M15 và H4, bars=1000:

```powershell
$env:BACKTEST_TIMEFRAME="M15"; $env:BACKTEST_BARS="1000"; $env:BACKTEST_END_TIME="2026-07-08T00:00:00Z"; npm run backtest:smc > tasks/smc-followups/04-filter-analysis/m15-pinned.json
$env:BACKTEST_TIMEFRAME="H4";  $env:BACKTEST_BARS="1000"; $env:BACKTEST_END_TIME="2026-07-08T00:00:00Z"; npm run backtest:smc > tasks/smc-followups/04-filter-analysis/h4-pinned.json
```

Lưu ý: output console của runner gồm cả log dòng (pino) lẫn JSON cuối cùng — khi redirect `>` vào file, cả log lẫn JSON sẽ vào chung file. Mở file, tìm khối JSON cuối (bắt đầu từ dòng có `"timeframe":`) để đọc `summary`, `bySetup`, `byGrade`.

## Phân tích (viết vào `tasks/smc-followups/04-filter-analysis/result.md`)

1. **Bảng bySetup** (M15 và H4 riêng): setup nào có `avgRiskReward > 0` và số trades đủ lớn (>= 15) để tin được — đây là ứng viên giữ lại; setup nào âm rõ rệt — ứng viên loại.
2. **Bảng byGrade**: so sánh grade A/B/C — grade nào net dương, chênh lệch bao nhiêu so với grade thấp hơn.
3. **Top 10 pairs tệ nhất và tốt nhất** theo `avgRiskReward` (lấy từ mảng `pairs` trong JSON, field `byPairStats` nếu cần chi tiết hơn — không có thì dùng field pair-level đã in sẵn).
4. **Đề xuất filter cụ thể**: ví dụ "chỉ giữ setup X, Y; chỉ nhận grade A; loại pair Z vì N trades toàn âm". Đề xuất phải có số liệu đi kèm (không được nói chung chung).
5. **Giới hạn của phân tích**: nêu rõ đây là 1 snapshot tại `2026-07-08T00:00:00Z`, mẫu còn nhỏ nếu closedTrades theo setup/grade < 30, cần chạy thêm nhiều window pinned khác (đề xuất Lead mở task) trước khi áp dụng filter vào production.

## Verification

```bash
npm run build
npm run test
```
(Không cần thay đổi code nên build/test phải pass y hệt trạng thái sau task 03 — chỉ chạy để xác nhận không có gì bị hỏng ngoài ý muốn.)

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục, không đoán — đặc biệt nếu `BACKTEST_END_TIME=2026-07-08T00:00:00Z` không có đủ dữ liệu lịch sử (ví dụ symbol mới list sau ngày đó trên Binance), ghi rõ symbol nào lỗi và tiếp tục với các symbol còn lại, không tự đổi ngày pin.
