# Phạm vi review

Diff chưa commit (working tree) — tính năng bổ sung `/predictions` context vào phân tích trận đấu:
- `src/betting/betting-api.ts` (hàm `fetchPredictions`)
- `src/betting/betting-types.ts` (`MatchPrediction`)
- `src/betting/betting.ts` (tích hợp vào `buildOddsPayload`)
- `src/betting/odds-text-format.ts` (`formatPredictionInput`, `formatOddsAnalysisInput`)
- `src/betting/betting-gemini.ts` (system prompt)

Đây là bản review lần 2, sau khi 5/6 vấn đề của lần review đầu (2026-07-04) đã được fix. `npx tsc --noEmit` pass, không có lỗi type.

# Tóm tắt

**Minor.** Các vấn đề Critical/Major trước đó (sai field path `entry.winner`/`entry.percent`, key `goals_scored` không tồn tại, `last_5` bị gán nhầm thành object) đã được sửa đúng theo schema thật của API-Football. Còn lại vài điểm Minor/Nitpick về code smell và độ bền của cơ chế log lỗi.

# Danh sách vấn đề

### 1. Flag `predictionsFetchErrorLogged` che mất các lỗi khác nhau sau lần đầu
- **Vị trí:** `src/betting/betting-api.ts`, biến module-level `predictionsFetchErrorLogged` trong `fetchPredictions`
- **Mô tả:** Flag này chỉ log 1 lần duy nhất cho suốt vòng đời process. Nếu lỗi đầu tiên là do free-plan chặn (permanent), việc chỉ log 1 lần là hợp lý. Nhưng nếu lỗi đầu tiên chỉ là 1 sự cố mạng thoáng qua (transient) cho 1 fixture, thì các lỗi thực sự khác xảy ra sau đó (ví dụ mất subscription giữa chừng, đổi API key sai) sẽ bị nuốt hoàn toàn không log, vì flag đã bật.
- **Mức độ:** Minor
- **Đề xuất fix:** Cân nhắc log lại khi thông điệp lỗi khác với lần log trước (so sánh message), hoặc log theo mức throttle theo thời gian (ví dụ tối đa 1 log/giờ) thay vì chỉ 1 lần duy nhất cho toàn bộ process.

### 2. Vẫn còn trùng lặp shape giữa `ApiPredictionResponse`, return type ẩn danh của `fetchPredictions`, và `MatchPrediction`
- **Vị trí:** `src/betting/betting-api.ts` (`ApiPredictionResponse` + return type ẩn danh của `fetchPredictions`) và `src/betting/betting-types.ts` (`MatchPrediction`)
- **Mô tả:** `ApiPredictionResponse` (raw API shape) tách biệt hợp lý khỏi domain model — đây là điểm tốt. Nhưng return type của `fetchPredictions` lại khai lại y hệt field của `MatchPrediction` thay vì import và dùng thẳng type đó, nên vẫn có 2 nơi định nghĩa cùng 1 domain shape, dễ lệch khi sửa sau này.
- **Mức độ:** Nitpick (code smell, không phải bug)
- **Đề xuất fix:** Đổi chữ ký hàm thành `Promise<MatchPrediction | null>`, import `MatchPrediction` từ `betting-types.ts`.

### 3. `comparisonKeys.slice(0, 3)` chọn field theo thứ tự JSON trả về, không theo mức độ liên quan
- **Vị trí:** `src/betting/odds-text-format.ts`, `formatPredictionInput`
- **Mô tả:** API trả `comparison` gồm các key như `form, att, def, poisson_distribution, h2h, goals, total`. Code lấy 3 key đầu tiên theo thứ tự bất kỳ mà API trả về — thường sẽ là `form, att, def`. `form` bị trùng lặp thông tin với `homeForm`/`awayForm` đã hiển thị riêng ở dòng trên, trong khi các field có thể hữu ích hơn cho dự đoán tài/xỉu như `poisson_distribution` hoặc `goals` lại bị bỏ qua nếu không nằm trong 3 key đầu.
- **Mức độ:** Nitpick
- **Đề xuất fix:** Chọn tường minh các key hữu ích nhất (ví dụ `att`, `def`, `poisson_distribution`, `goals`) thay vì lấy theo thứ tự ngẫu nhiên của object.

# Điểm tốt

- **3 lỗi Critical/Major của lần review trước đã được sửa đúng:**
  - `winner`/`percent` giờ đọc đúng từ `entry.predictions?.winner` / `entry.predictions?.percent` (khớp schema thật của API-Football).
  - Bỏ key sai `goals_scored`, thay bằng đọc đúng `last_5.goals.for.average` / `last_5.goals.against.average`, đặt tên field rõ ràng (`homeGoalsFor`, `homeGoalsAgainst`...) tránh hiểu nhầm là "trung bình bàn tuyệt đối" như bản trước.
  - `last_5.form` được truy cập đúng field con thay vì gán cả object.
- **Đã thêm log 1 lần khi fetch predictions lỗi** (`logger.warn` kèm message gốc) — giải quyết đúng yêu cầu ban đầu, giúp phát hiện khi free-plan chặn endpoint.
- **Đã chuyển sang gọi song song** `fetchFixtureOdds` và `fetchPredictions` bằng `Promise.all` trong `betting.ts`, giảm latency mỗi trận mà không đổi hành vi lỗi (predictions luôn tự bắt lỗi nội bộ, không làm `Promise.all` reject).
- Cấu trúc graceful fallback vẫn giữ nguyên: `prediction` optional, không phá vỡ `MatchOddsPayload` cũ hay test hiện có.
- `formatPredictionInput` xử lý tốt dữ liệu thiếu từng phần, chỉ render dòng nào có data thật.
