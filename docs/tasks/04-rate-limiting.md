# Phase 04: Rate-limit chủ động

## Mục tiêu
Rate-limit chủ động cho Gemini (15 RPM free tier) và API-Football (100 RPM) thay vì chỉ dựa vào retry/backoff khi đã bị 429.

## Bối cảnh / file liên quan
- [src/shared/retry.ts](../../src/shared/retry.ts): retry helper hiện có (`DEFAULT_RETRYABLE_STATUS = {429,500,502,503,504}`, `isRetryableError()`) — xử lý phản ứng sau khi đã bị lỗi, chưa có rate-limit chủ động (phòng trước).
- Gemini được gọi ở: [src/shared/claude.ts](../../src/shared/claude.ts), [src/betting/betting-gemini.ts](../../src/betting/betting-gemini.ts), [src/charts/analyzer.ts](../../src/charts/analyzer.ts), [src/charts/position-decision.ts](../../src/charts/position-decision.ts), [src/charts/test-model-compare.ts](../../src/charts/test-model-compare.ts), [src/charts/verify-provider.ts](../../src/charts/verify-provider.ts).
- API-Football được gọi ở: [src/betting/betting-api.ts](../../src/betting/betting-api.ts), [src/betting/correct-score-api.ts](../../src/betting/correct-score-api.ts), [src/betting/fetch-matches-list-index.ts](../../src/betting/fetch-matches-list-index.ts).

## Việc cần làm
- [x] Thêm module rate-limiter dùng chung (vd token-bucket hoặc sliding-window đơn giản) trong `src/shared/rate-limit.ts`.
- [x] Cấu hình giới hạn: Gemini 15 RPM, API-Football 100 RPM (đọc từ env để dễ chỉnh khi đổi tier).
- [x] Bọc các điểm gọi Gemini (`claude.ts`, `betting-gemini.ts`) qua rate-limiter trước khi gửi request.
- [x] Bọc các điểm gọi API-Football (`betting-api.ts`, `correct-score-api.ts`) qua rate-limiter.
- [x] Đảm bảo rate-limiter hoạt động đúng trong môi trường GitHub Actions (mỗi job chạy độc lập, không share state) — cân nhắc rate-limit theo từng job/run hoặc dùng Supabase để track usage cross-run nếu cần chính xác hơn.
- [x] Kết hợp với `retry.ts` hiện có: rate-limiter để phòng trước, retry để xử lý khi vẫn bị 429.

## Acceptance criteria
- [x] Gọi liên tiếp nhiều request Gemini/API-Football trong cùng 1 run không vượt quá ngưỡng RPM cấu hình (có thể test bằng cách đếm số request trong cửa sổ 60s).
- [x] Không phá vỡ luồng hiện có (build/lint pass, các runner vẫn chạy đúng).

## Ghi chú / rủi ro
- Vì mỗi GitHub Actions job là process riêng biệt, rate-limit in-memory chỉ hiệu quả trong 1 lần chạy — nếu nhiều job chạy song song cùng lúc vẫn có thể vượt giới hạn tổng. Cân nhắc mức độ cần thiết của rate-limit cross-job trước khi đầu tư phức tạp hơn (vd dùng Supabase đếm request).
