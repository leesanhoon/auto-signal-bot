# Task: Chi tiết hóa reason của Stats & Regression trong ensemble

## Objective
Hiện tại trong [src/lottery/lottery-ensemble-predict.ts](../../../src/lottery/lottery-ensemble-predict.ts), phần build `reason` cho mỗi dự đoán:
- Nếu có AI: dùng đúng `reason` chi tiết của AI (đã có tỉ lệ từng hàng, ví dụ "Hàng trăm=1 (8.3%), hàng chục=8 (7.5%)...").
- Nếu có Stats: chỉ ghi thêm chuỗi cố định `"tần suất thống kê"` — KHÔNG có số liệu cụ thể.
- Nếu có Regression: chỉ ghi thêm chuỗi cố định `"xu hướng hồi quy tuyến tính"` — KHÔNG có số liệu cụ thể.

Trong khi đó `StatNumberPrediction` (từ [lottery-stats-predict.ts](../../../src/lottery/lottery-stats-predict.ts)) và `RegressionNumberPrediction` (từ [lottery-regression-predict.ts](../../../src/lottery/lottery-regression-predict.ts)) đều đã có sẵn `hundredsDetail`, `tensDetail`, `unitsDetail` (mỗi cái có `digit` + tỉ lệ liên quan) nhưng bị bỏ phí — không truyền vào reason.

Nhiệm vụ: sửa `predictTopNumbersEnsemble()` để khi Stats/Regression đóng góp vào 1 số, reason list thêm 1 câu NGẮN có số liệu cụ thể, tương tự văn phong AI, thay vì nhãn chung chung.

## Instructions
1. Trong `predictTopNumbersEnsemble()`, khi populate `candidateMap` từ `statsResults`, lưu thêm chi tiết digit (`hundredsDetail`, `tensDetail`, `unitsDetail`) vào object trong map (thêm field mới, ví dụ `statsDetail`) thay vì chỉ lưu `breakdown.stats`.
2. Tương tự cho `regressionResults`, lưu thêm `regressionDetail`.
3. Viết 2 hàm helper nhỏ (arrow function), đặt ngay trong file `lottery-ensemble-predict.ts`:
   - `formatStatsReason(detail: { hundredsDetail: StatDigitDetail; tensDetail: StatDigitDetail; unitsDetail: StatDigitDetail }): string` — trả về chuỗi dạng: `"Thống kê: hàng trăm=<digit> (tần suất <weightedFreq*100>%), hàng chục=<digit> (<weightedFreq*100>%), hàng đơn vị=<digit> (<weightedFreq*100>%)"`. Làm tròn % tới 1 chữ số thập phân bằng `.toFixed(1)`.
   - `formatRegressionReason(detail: { hundredsDetail: RegressionDigitDetail; tensDetail: RegressionDigitDetail; unitsDetail: RegressionDigitDetail }): string` — trả về chuỗi dạng: `"Hồi quy: hàng trăm=<digit> (dự báo <predictedRatio*100>%), hàng chục=<digit> (<predictedRatio*100>%), hàng đơn vị=<digit> (<predictedRatio*100>%)"`. Làm tròn % tới 1 chữ số thập phân.
4. Trong đoạn build `reasonParts` (hiện đang push `"tần suất thống kê"` và `"xu hướng hồi quy tuyến tính"`), thay bằng gọi 2 helper trên khi có detail tương ứng.
5. Giữ nguyên toàn bộ logic tính `finalScore`/`activeWeights`/`totalWeight` — KHÔNG đổi công thức confidence, chỉ đổi nội dung text của `reason`.
6. Giữ nguyên field `breakdown` (chỉ chứa 3 số ai/stats/regression) — không đổi type `MethodBreakdown` hay `EnsembleNumberPrediction` public shape ngoài phần nội dung string của `reason`.
7. Đảm bảo khi chỉ có 1-2 phương pháp đóng góp, các câu reason nối bằng `"; "` giống pattern cũ (không có dấu `;` thừa ở cuối — xem test `"reason string does not have trailing separator..."` trong `tests/lottery/lottery-ensemble-predict.test.ts` để hiểu invariant cần giữ).
8. Chạy `npm run build` để verify không lỗi type.

## Acceptance Criteria
- [ ] Khi Stats đóng góp vào 1 số, `reason` chứa số liệu cụ thể (ví dụ digit + %) thay vì chỉ chuỗi `"tần suất thống kê"`.
- [ ] Khi Regression đóng góp vào 1 số, `reason` chứa số liệu cụ thể thay vì chỉ chuỗi `"xu hướng hồi quy tuyến tính"`.
- [ ] Không đổi công thức tính `confidence`/`finalScore`/`activeWeights`.
- [ ] `npm run build` không lỗi.
- [ ] Không sửa file nào ngoài `src/lottery/lottery-ensemble-predict.ts`.

## Files to Touch
- `src/lottery/lottery-ensemble-predict.ts` — sửa
