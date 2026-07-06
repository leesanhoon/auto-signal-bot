# Task: Thêm giờ chạy (VN) vào header + chú thích ý nghĩa % ở cuối message

## Objective
Header từng miền trong tin nhắn Telegram hiện chỉ có ngày + thứ (ví dụ `🟩 Miền Nam — Thứ Hai, 2026-07-06`), không có giờ nên người nhận không biết dự đoán được tạo/lấy cache lúc nào trong ngày. Đồng thời cuối message chỉ có 1 dòng cảnh báo chung ("Chỉ mang tính tham khảo...") mà không giải thích ý nghĩa % tin cậy / breakdown cho người mới xem.

## Instructions
1. Trong [src/lottery/lottery-predict-runner.ts](../../../src/lottery/lottery-predict-runner.ts), thêm 1 hàm helper lấy giờ hiện tại theo giờ Việt Nam dạng `HH:mm`, dùng cùng pattern timezone đã có (`Asia/Ho_Chi_Minh`) như hàm `vnDateOffset()` đang dùng — ví dụ:
   ```ts
   function vnTimeNow(): string {
     return new Date().toLocaleTimeString("vi-VN", {
       timeZone: "Asia/Ho_Chi_Minh",
       hour: "2-digit",
       minute: "2-digit",
     });
   }
   ```
2. Trong dòng build header của mỗi miền (hiện tại: `lines.push(\`${REGION_LABELS[result.region]} — ${result.weekdayLabel}, ${result.target.dateStr}\`);`), thêm giờ chạy vào cuối, ví dụ:
   ```
   🟩 Miền Nam — Thứ Hai, 2026-07-06 (dự đoán lúc 08:15)
   ```
   Lưu ý: giờ này là giờ CHẠY script (lúc gửi Telegram), không phải giờ mục tiêu — gọi `vnTimeNow()` 1 lần ở đầu `runLotteryPredict()` (giống cách `today` được tính 1 lần) để tất cả miền dùng chung 1 giờ chạy, tránh gọi nhiều lần bị lệch giây.
3. Thêm 1 dòng chú thích ngắn (dùng markdown italic `_..._` giống các dòng chú thích khác) TRƯỚC dòng cảnh báo cuối cùng (`"⚠️ _Chỉ mang tính tham khảo..._"`), nội dung ngắn gọn giải thích ý nghĩa %, ví dụ:
   ```
   _💡 % tin cậy = trung bình có trọng số giữa AI/Thống kê/Hồi quy; số có nhiều phương pháp đồng thuận hơn thường đáng tin hơn dù % hiển thị tương đương._
   ```
4. Không đổi logic tính toán confidence/breakdown, chỉ thêm text hiển thị.
5. Chạy `npm run build`.

## Acceptance Criteria
- [ ] Header mỗi miền có thêm giờ chạy (định dạng HH:mm, giờ Việt Nam), tất cả miền trong cùng 1 message dùng chung 1 giờ (không lệch giây giữa các miền).
- [ ] Cuối message có thêm 1 dòng chú thích ngắn giải thích ý nghĩa % tin cậy, đặt trước dòng cảnh báo "chỉ mang tính tham khảo" hiện có.
- [ ] Không đổi logic tính confidence/breakdown.
- [ ] `npm run build` không lỗi.
- [ ] Không sửa file nào ngoài `src/lottery/lottery-predict-runner.ts`.

## Files to Touch
- `src/lottery/lottery-predict-runner.ts` — sửa
