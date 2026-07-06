# Task: Cập nhật test cho các thay đổi tối ưu tin nhắn Telegram

## Objective
Sau khi 3 subtask trước (01-detail-method-reason, 02-consensus-flag, 03-legend-and-timestamp) hoàn tất, cần cập nhật/thêm test tương ứng để đảm bảo không có regression và các format mới được cover.

## Instructions
Đọc kỹ code hiện tại của `src/lottery/lottery-ensemble-predict.ts` và `src/lottery/lottery-predict-runner.ts` SAU KHI đã áp dụng 3 subtask trước, rồi:

1. Trong `tests/lottery/lottery-ensemble-predict.test.ts`:
   - Cập nhật test `"reason string does not have trailing separator..."` (dòng ~423) nếu format reason của stats thay đổi khiến assertion `toContain("tần suất thống kê")` không còn đúng — thay bằng assertion phù hợp với format mới (ví dụ check reason chứa `"Thống kê:"` hoặc digit/% cụ thể).
   - Thêm 1 test mới verify: khi Stats đóng góp, `reason` chứa số liệu cụ thể (không chỉ nhãn chung chung) — ví dụ check regex có `%` hoặc digit trong phần Thống kê.
   - Thêm 1 test mới tương tự cho Regression.
   - Đảm bảo các test cũ khác (renormalize weight, throws khi records rỗng, sort theo confidence, v.v.) vẫn pass — sửa assertion nếu cần nhưng KHÔNG đổi ý nghĩa test.

2. Trong `tests/lottery/lottery-predict-runner.test.ts`:
   - Cập nhật các mock `predictTopNumbersAI`/breakdown trong `beforeEach` và từng test nếu cần để cover trường hợp 1/2/3 phương pháp đồng thuận.
   - Thêm assertion kiểm tra message chứa tag đồng thuận đúng (ví dụ test breakdown đủ `ai/stats/regression` → message chứa `"3/3"`; test chỉ có `ai` → message chứa `"1/3"`).
   - Thêm assertion kiểm tra header message chứa giờ chạy (định dạng `HH:mm`, có thể assert bằng regex `/\d{2}:\d{2}/` thay vì giá trị cụ thể vì giờ hệ thống thay đổi theo lúc chạy test).
   - Thêm assertion kiểm tra cuối message có dòng chú thích ý nghĩa % mới.
   - KHÔNG mock `Date`/timezone giả nếu không cần thiết — ưu tiên assert bằng regex pattern thay vì giá trị giờ cố định để test không bị flaky.

3. Chạy `npm run test -- --run tests/lottery/lottery-ensemble-predict.test.ts tests/lottery/lottery-predict-runner.test.ts` và đảm bảo toàn bộ pass.
4. Chạy `npm run build` để đảm bảo không có lỗi type.

## Acceptance Criteria
- [ ] Tất cả test trong 2 file trên pass.
- [ ] Có ít nhất 2 test mới cho reason chi tiết (stats + regression) trong `lottery-ensemble-predict.test.ts`.
- [ ] Có ít nhất 2 test mới cho consensus flag + timestamp/legend trong `lottery-predict-runner.test.ts`.
- [ ] `npm run build` không lỗi.
- [ ] `npm run test -- --run` (toàn bộ suite) không có test nào fail do thay đổi này.

## Files to Touch
- `tests/lottery/lottery-ensemble-predict.test.ts` — sửa/thêm test
- `tests/lottery/lottery-predict-runner.test.ts` — sửa/thêm test
