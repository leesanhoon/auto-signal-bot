# Review findings — Phase 08: Chi phí & observability

Review của các thay đổi liên quan tới [docs/tasks/08-cost-observability.md](08-cost-observability.md). **Không phát hiện bug chức năng.**

## Đã verify OK
- [src/shared/ai-usage.ts](../../src/shared/ai-usage.ts): module đầy đủ — extract usage từ response model providers, ước tính cost theo bảng rate cấu hình sẵn (`DEFAULT_RATES`), fallback rate hợp lý khi model không khớp key nào, tổng hợp theo ngày/provider/source/model, build alert message, ghi + đọc từ Supabase.
- Migration [supabase/migrations/20260701160000_ai_usage_observability.sql](../../supabase/migrations/20260701160000_ai_usage_observability.sql): bảng `ai_usage` có check constraint cho `provider`/`source`, index đầy đủ theo usage_date/recorded_at/provider/source, RLS + grant đúng cho `service_role`.
- Wiring đúng ở cả 3 điểm gọi model thực tế: [analyzer.ts](../../src/charts/analyzer.ts), [position-decision.ts](../../src/charts/position-decision.ts), [betting-gemini.ts](../../src/betting/betting-gemini.ts) — `recordUsage` được gọi **ngay sau khi nhận response thô** (trước bước parse JSON), nên usage vẫn được ghi nhận kể cả khi parse JSON thất bại sau đó.
- `recordUsage`/`maybeSendAiUsageAlert` tự bắt lỗi nội bộ (try/catch + `logger.warn`) nên `void recordGeminiUsage(...)` (fire-and-forget) không tạo unhandled promise rejection.
- Bỏ qua an toàn khi thiếu `SUPABASE_URL`/`SUPABASE_KEY` (`recordUsage`/`loadAiUsageRecords` return sớm) — không throw, không chặn luồng chính.
- Test ([tests/shared/ai-usage.test.ts](../../tests/shared/ai-usage.test.ts)) cover extract usage, aggregate theo ngày, build alert message, estimate cost — đủ cho phần logic thuần.
- `npm test` (11 files, 33 tests pass), `npx tsc --noEmit` sạch.

## Ghi chú (không phải bug, chỉ để ý)
- **Dedupe alert theo ngày**: `alertedKeys` (Set in-memory) dùng key `date:tokenLimit:costLimit:ratio` — nghĩa là trong 1 process, khi đã gửi cảnh báo cho 1 ngày thì sẽ không gửi lại nữa dù usage tiếp tục tăng vượt xa ngưỡng (vd từ 80% lên 150%). Đây có vẻ là lựa chọn tránh spam Telegram, hợp lý — nhưng vì mỗi GitHub Actions job là process riêng biệt (giống hạn chế đã ghi nhận ở Phase 04 rate-limit), dedupe này chỉ có tác dụng trong phạm vi 1 lần chạy, không nhớ giữa các lần chạy khác nhau trong ngày — nên trên thực tế vẫn có thể nhận cảnh báo lặp lại nhiều lần/ngày nếu chạy nhiều job. Không phải lỗi, chỉ là giới hạn kiến trúc tương tự đã biết.
- **N+1 query nhẹ**: mỗi lần `recordUsage()` được gọi (tức mỗi lần gọi request thành công) sẽ trigger thêm 1 lượt `loadAiUsageDailySummary()` (load lại toàn bộ usage rows trong ngày để check ngưỡng cảnh báo). Với tần suất gọi model hiện tại của bot (vài chục lần/run) thì không đáng ngại, nhưng nếu tần suất tăng cao sau này có thể cân nhắc tối ưu (vd chỉ check ngưỡng định kỳ thay vì mỗi lần ghi).

## Kết luận
Phase 08 hoàn tất, không có việc gì cần giao lại cho codex.
