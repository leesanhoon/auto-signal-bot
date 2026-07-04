# Phạm vi review

Commit `5c11f6e` — "feat: Enrich match analysis with API-Football predictions context":
- `src/betting/betting-api.ts` (hàm `fetchPredictions`)
- `src/betting/betting-types.ts` (`MatchPrediction`)
- `src/betting/betting.ts` (tích hợp vào `buildOddsPayload`)
- `src/betting/odds-text-format.ts` (`formatPredictionInput`, `formatOddsAnalysisInput`)
- `src/betting/betting-gemini.ts` (system prompt)

Đây là bản review lần 3 (sau khi đã sửa qua 2 vòng). `npx tsc --noEmit` pass, `npx vitest run` pass 360/360 test.

# Tóm tắt

**Không có vấn đề Critical/Major/Minor còn tồn đọng.** Tất cả các phát hiện ở 2 lần review trước (sai field path API, key `goals_scored` không tồn tại, `last_5` gán nhầm object, flag log lỗi bị "dính", trùng lặp type, thứ tự chọn comparison key ngẫu nhiên) đã được sửa đúng. Chỉ còn 1 chi tiết Nitpick cực nhỏ không ảnh hưởng hành vi.

# Danh sách vấn đề

### 1. Cast kiểu dư thừa `prediction as MatchPrediction`
- **Vị trí:** `src/betting/betting.ts:59` — `if (prediction) payload.prediction = prediction as MatchPrediction;`
- **Mô tả:** `fetchPredictions()` giờ đã khai báo trả về thẳng `Promise<MatchPrediction | null>` (đã fix trùng lặp type ở bản trước), nên cast `as MatchPrediction` ở đây không còn cần thiết — TypeScript đã suy luận đúng kiểu.
- **Mức độ:** Nitpick
- **Đề xuất fix:** Bỏ `as MatchPrediction`, chỉ cần `payload.prediction = prediction;`.

# Điểm tốt

- **Toàn bộ 3 vấn đề Critical/Major của lần review 1 đã fix đúng và giữ nguyên ở bản merge cuối:** field path `entry.predictions?.winner`/`percent`, `last_5.goals.for/against.average` thay cho key sai `goals_scored`, `last_5.form` thay vì gán cả object.
- **2 vấn đề Minor/Nitpick của lần review 2 cũng đã fix:**
  - Error logging giờ so sánh `errorMsg !== lastPredictionErrorMessage` — log lại khi lỗi đổi loại, không còn bị "dính" vĩnh viễn sau lần log đầu.
  - `fetchPredictions` trả thẳng `Promise<MatchPrediction | null>` bằng cách import type từ `betting-types.ts`, không còn khai lại shape ẩn danh trùng lặp.
  - `formatPredictionInput` chọn tường minh `preferredKeys = ["att", "def", "poisson_distribution", "goals"]` thay vì lấy 3 key đầu theo thứ tự ngẫu nhiên của response — tránh trùng lặp với `Form` đã hiển thị riêng, ưu tiên field liên quan trực tiếp đến tài/xỉu.
- Test suite đầy đủ (360 test) và type-check đều pass, không có regression.
- Cấu trúc graceful fallback nhất quán xuyên suốt: mọi field prediction đều optional, hệ thống vẫn hoạt động bình thường khi free-plan chặn `/predictions`.
