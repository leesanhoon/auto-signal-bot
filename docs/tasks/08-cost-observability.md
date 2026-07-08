# Phase 08: Chi phí & observability

## Mục tiêu
Theo dõi số token mỗi lần gọi model providers, tổng hợp theo ngày, cảnh báo khi gần đụng free-tier hoặc vượt ngân sách dự kiến.

## Bối cảnh / file liên quan
- Các điểm gọi model providers: [src/shared/claude.ts](../../src/shared/claude.ts), [src/betting/betting-gemini.ts](../../src/betting/betting-gemini.ts), [src/charts/analyzer.ts](../../src/charts/analyzer.ts), [src/charts/position-decision.ts](../../src/charts/position-decision.ts).
- Phụ thuộc [Phase 02 - structured logging](02-structured-logging.md) nếu muốn ghi usage vào cùng cơ chế logging/Supabase.

## Việc cần làm
- [x] Xác định cách lấy số token từ response API (model providers SDK thường trả usage metadata) tại từng điểm gọi.
- [x] Tạo migration bảng Supabase mới (vd `ai_usage`) lưu: timestamp, provider, model, input_tokens, output_tokens, ước tính cost, nguồn gọi (chart/betting/lottery).
- [x] Wrap các lời gọi model để tự động ghi usage vào bảng này sau mỗi request.
- [x] Viết hàm tổng hợp usage theo ngày (tổng token, ước tính cost).
- [x] Thêm cảnh báo Telegram khi usage trong ngày gần chạm ngưỡng free-tier (vd 80% giới hạn RPM/ngày) — có thể tận dụng [Phase 04 - rate limiting](04-rate-limiting.md) làm nguồn đếm.

## Ghi chú triển khai
- Bảng mới dùng `recorded_at` + `usage_date` để vừa giữ timestamp vừa query báo cáo theo ngày dễ hơn.
- Ngưỡng cảnh báo cấu hình qua env: `MODEL_USAGE_DAILY_TOKEN_LIMIT`, `MODEL_USAGE_DAILY_COST_LIMIT_USD`, `MODEL_USAGE_ALERT_THRESHOLD_RATIO`.
- Báo cáo tổng hợp có sẵn ở [src/shared/ai-usage.ts](../../src/shared/ai-usage.ts), test bằng fixture trong [tests/shared/ai-usage.test.ts](../../tests/shared/ai-usage.test.ts).

## Acceptance criteria
- [x] Mỗi lần gọi model providers đều có bản ghi usage tương ứng trong Supabase.
- [x] Có hàm/báo cáo tổng hợp usage theo ngày, test được với dữ liệu mẫu.
- [x] Cảnh báo Telegram gửi đúng khi vượt ngưỡng cấu hình.

## Ghi chú / rủi ro
- Nên gộp chung schema/migration với Phase 02 nếu cả hai cùng cần thêm bảng mới, tránh tạo nhiều migration rời rạc không cần thiết.
