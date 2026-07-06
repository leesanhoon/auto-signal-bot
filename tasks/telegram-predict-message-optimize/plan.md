# Task Plan: Tối ưu tin nhắn Telegram dự đoán xổ số

## Overview
Tin nhắn Telegram do `runLotteryPredict()` gửi ([src/lottery/lottery-predict-runner.ts](../../src/lottery/lottery-predict-runner.ts)) hiện thiếu chi tiết ở 3 điểm: (1) reason của Stats/Regression quá chung chung so với AI dù dữ liệu chi tiết đã có sẵn, (2) không có chỉ báo mức đồng thuận giữa 3 phương pháp, (3) không có chú thích ý nghĩa % và giờ chạy. Task này làm rõ và chi tiết hóa nội dung gửi đi mà KHÔNG đổi công thức/flow tính confidence đã thống nhất giữa 3 miền.

## Architecture Decisions
- Không đổi trọng số ensemble (`ai 0.4 / stats 0.3 / regression 0.3`) hay flow — chỉ thay đổi cách build `reason` và cách format message.
- `EnsembleNumberPrediction.reason` sẽ được build chi tiết hơn ngay trong `predictTopNumbersEnsemble()` (giữ nguyên chỗ build reason hiện tại, chỉ nâng cấp nội dung) — không thêm field mới vào DB schema (`reason` là cột text sẵn có trong `lottery_predictions`, đủ chỗ chứa).
- Consensus flag và legend/timestamp là thay đổi thuần format ở `lottery-predict-runner.ts`, dựa trên `breakdown` đã có sẵn (đếm số key không undefined) — không cần dữ liệu mới.

## File Changes
- `src/lottery/lottery-ensemble-predict.ts` — build reason chi tiết cho stats & regression từ `hundredsDetail/tensDetail/unitsDetail`.
- `src/lottery/lottery-predict-runner.ts` — thêm dòng đồng thuận theo số phương pháp, thêm giờ VN vào header, thêm chú thích cuối message.
- `tests/lottery/lottery-ensemble-predict.test.ts` — cập nhật/thêm test cho reason chi tiết.
- `tests/lottery/lottery-predict-runner.test.ts` — cập nhật/thêm test cho format message mới.

## Testing Strategy
- Chạy `npm run build` sau mỗi subtask.
- Chạy `npm run test -- --run tests/lottery/lottery-ensemble-predict.test.ts tests/lottery/lottery-predict-runner.test.ts`.
- Không cần test thủ công Telegram thật; test bằng cách assert nội dung string message trong unit test (theo pattern đã có sẵn trong file test).

## Subtasks
| Subtask ID | Description | Owner | Files to Modify | Dependencies | Expected Output |
|------------|-------------|-------|-----------------|--------------|-----------------|
| 01-detail-method-reason | Build reason chi tiết (tỉ lệ từng hàng trăm/chục/đơn vị) cho Stats & Regression giống format AI | worker | src/lottery/lottery-ensemble-predict.ts | None | Stats/Regression reason có số liệu cụ thể thay vì nhãn chung chung |
| 02-consensus-flag | Thêm chỉ báo số phương pháp đồng thuận (X/3) trên mỗi dòng dự đoán trong Telegram message | worker | src/lottery/lottery-predict-runner.ts | 01-detail-method-reason | Mỗi số dự đoán hiển thị rõ có bao nhiêu pp đồng thuận |
| 03-legend-and-timestamp | Thêm giờ VN vào header từng miền + chú thích ý nghĩa % ở cuối message | worker | src/lottery/lottery-predict-runner.ts | 02-consensus-flag | Header có giờ chạy, cuối message có chú thích ngắn |
| 04-update-tests | Cập nhật/thêm test cho các thay đổi ở 3 subtask trên | worker | tests/lottery/lottery-ensemble-predict.test.ts, tests/lottery/lottery-predict-runner.test.ts | 01, 02, 03 | `npm run test` pass toàn bộ |
