# R²-gated linear regression cho lottery hundreds-digit predictor

## Bối cảnh

`src/lottery/lottery-regression-predict.ts` dự đoán tỉ lệ xuất hiện mỗi digit (0-9)
tại 3 vị trí (hundreds/tens/units) bằng linear regression (OLS) trên chuỗi tỉ lệ
theo period-index, rồi extrapolate ra period tiếp theo.

Vấn đề: `computeRegressionDigitDetails` luôn tin `slope` để extrapolate, không kiểm
định xem regression đó có ý nghĩa thống kê hay không. Với dữ liệu xổ số gần-uniform
(tỉ lệ mỗi digit dao động quanh 0.1), phần lớn slope chỉ là nhiễu ngẫu nhiên — dùng
nó để ngoại suy là áp dụng sai công cụ thống kê.

Lưu ý: [[project_lottery_prediction_decision]] đã ghi nhận backtest trước đó (2026-07-09)
không tìm thấy edge nào so với random baseline. Thay đổi này làm đúng chuẩn kỹ thuật
thống kê (R² gate) theo yêu cầu người dùng, không nhằm chứng minh lại edge — không cần
backtest để duyệt.

## Thay đổi

1. Dùng `rSquared` từ `simple-statistics` (dependency đã có sẵn trong `node_modules`,
   không thêm mới) để tính R² cho regression của mỗi digit, ở cả 3 vị trí
   (hundreds/tens/units — áp dụng nhất quán, không đặc cách riêng hàng trăm).

2. Ngưỡng gate: R² ≥ 0.5.
   - Đạt ngưỡng: giữ `predictedRatio` từ extrapolation (`slope * nextPeriodIndex + intercept`,
     clamp [0,1]) như hiện tại.
   - Không đạt: `predictedRatio` fallback về tỉ lệ trung bình lịch sử của digit đó
     (tái dùng logic đã có ở `getFallbackDetails`, áp dụng per-digit thay vì toàn vị trí).

3. Thêm field `rSquared: number` vào `RegressionDigitDetail` để minh bạch — cho phép
   log/debug biết digit nào đang chạy trên xu hướng thật (R² ≥ 0.5) vs trung bình lịch sử.

4. Không đổi:
   - `predictTopNumbersRegression`, `computeRegressionDigitPositionProbabilities`,
     `predictTopNumbersEnsemble` — vẫn tiêu thụ `predictedRatio` như cũ, chỉ nguồn gốc
     giá trị chính xác hơn.
   - `lottery-stats-predict.ts` — trọng số `weightedFreq*0.6 + overdue*0.4` giữ nguyên.
   - Trọng số blend cuối `hScore*0.25 + tScore*0.35 + uScore*0.4` giữ nguyên.
   - Weekday filtering ở tầng data-loading (`loadWeekdayHistory`) — đã đúng, không đụng.

## Case đặc biệt

- `totalPeriods < 3`: đã có fallback toàn bộ (`getFallbackDetails`) — giữ nguyên, R² không
  áp dụng được với < 3 điểm dữ liệu.
- Chuỗi hằng số (mọi period cùng ratio, ví dụ digit chưa từng xuất hiện → ratio luôn 0):
  `rSquared` của `simple-statistics` có thể trả `NaN`/`0`/undefined tùy input suy biến —
  cần xử lý: coi `NaN` là "không đạt ngưỡng" → fallback về trung bình lịch sử.

## Test

Thêm test cho `computeRegressionDigitDetails`:
- Digit có xu hướng tuyến tính rõ (R² cao) → giữ predictedRatio từ slope.
- Digit dao động ngẫu nhiên quanh trung bình (R² thấp) → predictedRatio ≈ trung bình lịch sử.
- Chuỗi hằng số toàn 0 → không throw, fallback về 0.
