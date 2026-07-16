# Task 02 — Rerun backtest & resync predictions with full data

**Điều kiện tiên quyết: Task 01 (`01-paginate-history-queries`) phải đã DONE và approved trước khi làm task này** — task này phụ thuộc vào fix pagination đã được merge/apply vào code, nếu chưa xong thì dừng lại, ghi `blocked.md` và không tự làm task 01 thay.

## Bối cảnh

Trước khi sửa bug (Task 01), `loadWeekdayHistory`/`loadRegionHistory` bị Supabase cắt ở 1000 rows/request do thiếu phân trang, khiến:
1. Dự đoán xổ số hàng tuần bị tính trên dữ liệu cũ hơn thực tế 1-2 tuần → dự đoán Thứ 5 gần đây bị trùng dự đoán Thứ 5 tuần trước.
2. Kết luận backtest trước đó (`npm run lottery-backtest`, chạy 09/07/2026, kết luận "random thắng cả 2/3 miền, không có edge") **rất có thể** đã chạy trên dữ liệu bị cắt, không phải toàn bộ 3 năm lịch sử.

Task này KHÔNG sửa thêm code — chỉ chạy lại 2 lệnh có sẵn với data đầy đủ (sau khi Task 01 fix xong) và ghi lại kết quả để Lead so sánh với kết luận cũ.

## Việc cần làm

1. Xác nhận Task 01 đã merge (đọc `tasks/lottery-history-truncation-fix/01-paginate-history-queries/result.md`, phải thấy build/test pass).
2. Chạy:
   ```bash
   npm run lottery-backtest
   ```
   Ghi lại đầy đủ output — đặc biệt hit-rate của random-baseline vs stats vs regression vs ensemble cho **cả 3 miền** (mien-bac, mien-trung, mien-nam), giống format đã có trong memory cũ (`project_lottery_prediction_decision`):
   - `mien-bac`: random-baseline hit-rate X%/Y% vs stats A%/B%, ...
   - `mien-nam`: ...
   - `mien-trung`: ...

   So sánh số kỳ (periods) dùng trong backtest lần này với số kỳ ghi trong memory cũ (mien-bac 930 periods, mien-nam 259 periods, mien-trung 342 periods) — nếu số periods KHÔNG đổi nhiều so với cũ dù đã fix pagination, ghi rõ điều này (có thể nghĩa là `lottery-backtest.ts` dùng nguồn data khác không bị ảnh hưởng bởi bug, hoặc bug chỉ ảnh hưởng 1 phần).

3. Chạy:
   ```bash
   npm run lottery-predict-resync
   ```
   Đây là script re-tính dự đoán cho các ngày CHƯA quay số (`verified_at is null`, `date >= hôm nay`) bằng data mới nhất, chỉ ghi đè nếu top-3 số thay đổi. Ghi lại output log — đặc biệt các dòng "Update {region} {date}: {old numbers} -> {new numbers}" nếu có, hoặc "No predictions needed resync" nếu không có gì đổi.

   **Lưu ý:** script này gửi Telegram message thật (`sendMessage`) nếu có prediction nào bị resync — đây là hành vi có sẵn của script, không phải bug, không cần chặn lại, nhưng ghi rõ trong result.md là đã có Telegram message được gửi (để Lead biết đã có notification thật ra ngoài).

## Verify

- Không có bước build/test riêng cho task này (không sửa code). Chỉ cần 2 lệnh trên chạy thành công (exit code 0), không throw error.
- Nếu `npm run lottery-backtest` hoặc `npm run lottery-predict-resync` lỗi (ví dụ thiếu env, timeout kết nối Supabase) → ghi `blocked.md` với error message đầy đủ, không tự sửa code để "làm cho chạy được" (ngoài scope task này).

## Ghi kết quả

Ghi vào `tasks/lottery-history-truncation-fix/02-rerun-backtest-and-resync/result.md`:
- Full output của `npm run lottery-backtest` (hit-rate từng miền, số periods).
- So sánh ngắn gọn với số liệu cũ trong memory `project_lottery_prediction_decision` (periods có tăng không, hit-rate có đổi không).
- Full output của `npm run lottery-predict-resync` (có resync gì không, ngày/miền nào).
- Kết luận: kết luận "no edge" cũ còn đứng vững với data đầy đủ hay không (chỉ nêu dữ kiện, KHÔNG tự đề xuất thêm predictor/feature mới — nếu thấy có edge, chỉ báo cáo lại cho Lead quyết định, không tự implement gì thêm, đúng theo quyết định đã ghi trong memory dự án).
