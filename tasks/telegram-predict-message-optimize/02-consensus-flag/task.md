# Task: Thêm chỉ báo mức đồng thuận (X/3 phương pháp) trong tin nhắn Telegram

## Objective
Trong [src/lottery/lottery-predict-runner.ts](../../../src/lottery/lottery-predict-runner.ts), hàm `runLotteryPredict()` build message hiện tại mỗi số dự đoán chỉ hiển thị % breakdown từng phương pháp (AI/Thống kê/Hồi quy) nếu có, nhưng không có chỉ báo tổng quát cho biết số đó được BAO NHIÊU phương pháp đồng thuận chọn. Một số được cả 3 pp chọn đáng tin cậy hơn nhiều so với số chỉ có 1 pp chọn (weight bị renormalize), nhưng % hiển thị ra có thể trông tương đương nhau — gây hiểu lầm.

## Instructions
1. Trong đoạn `result.predictions.forEach((p, i) => {...})` (dòng ~211-228 hiện tại), TRƯỚC khi push dòng breakdown (`parts.join(" · ")`), tính số phương pháp đã đóng góp:
   ```ts
   const methodCount = [p.breakdown.ai, p.breakdown.stats, p.breakdown.regression].filter(
     (v) => v !== undefined,
   ).length;
   ```
2. Thêm 1 tag ngắn ngay sau dòng `${RANK_MEDAL[i] ?? "▫️"} \`${p.number}\` — ...` (cùng dòng hoặc dòng riêng, tùy cho dễ đọc) theo quy tắc:
   - `methodCount === 3` → thêm `"🔥 3/3 pp đồng thuận"`.
   - `methodCount === 2` → thêm `"2/3 pp đồng thuận"`.
   - `methodCount === 1` → thêm `"⚠️ chỉ 1/3 pp"`.
3. Đặt tag này ở dòng `_   ↳ ..._` hiện có (cùng dòng với breakdown methods, nối bằng `" · "`) để không tăng số dòng message quá nhiều — ví dụ: `_   ↳ AI 65% · Thống kê 58% · Hồi quy 55% · 🔥 3/3 pp đồng thuận_`.
4. Không đổi cấu trúc `RegionPredictionResult`, không đổi thứ tự sort hay số lượng dự đoán hiển thị (vẫn top 3 theo confidence).
5. Chạy `npm run build`.

## Acceptance Criteria
- [ ] Mỗi dự đoán hiển thị rõ số phương pháp đồng thuận (1/3, 2/3, hoặc 3/3).
- [ ] Số có 3/3 pp có tag nổi bật khác với số chỉ có 1/3 pp.
- [ ] Không đổi logic sort/filter/số lượng dự đoán hiển thị.
- [ ] `npm run build` không lỗi.
- [ ] Không sửa file nào ngoài `src/lottery/lottery-predict-runner.ts`.

## Files to Touch
- `src/lottery/lottery-predict-runner.ts` — sửa
