# Phase 09: Lệnh Telegram /stats

## Mục tiêu

Dashboard đơn giản dưới dạng 1 lệnh Telegram `/stats` hiển thị: số lệnh đang mở, win-rate gần đây, usage hôm nay.

## Bối cảnh / file liên quan

- [supabase/functions/telegram-webhook/index.ts](../../supabase/functions/telegram-webhook/index.ts): router trung tâm, nơi đăng ký command mới vào `COMMANDS` map.
- [src/scripts/setup-telegram-menu-v2.ts](../../src/scripts/setup-telegram-menu-v2.ts): cấu hình menu lệnh hiển thị trong Telegram UI — đã có `/stats`.
- [src/shared/telegram.ts](../../src/shared/telegram.ts): helper gửi message Telegram.
- Phụ thuộc [Phase 05](05-position-decision-engine.md) (số lệnh mở), [Phase 06](06-performance-tracking.md) (win-rate), [Phase 08](08-cost-observability.md) (usage) — nên làm sau các phase đó hoặc dùng dữ liệu hiện có tạm thời nếu chưa hoàn thiện.

## Việc cần làm

- [x] Đăng ký command `/stats` trong `COMMANDS` map của `telegram-webhook/index.ts`.
- [x] Quyết định: `/stats` xử lý trực tiếp trong Edge Function để truy vấn nhanh, không cần workflow.
- [x] Viết hàm tổng hợp số liệu: đếm `open_positions` đang mở, win-rate gần đây (tái sử dụng logic Phase 06 nếu có), tổng usage hôm nay (tái sử dụng Phase 08 nếu có).
- [x] Format response gửi về Telegram (ngắn gọn, dễ đọc trên mobile).
- [x] Thêm `/stats` vào menu qua `setup-telegram-menu-v2.ts`.

## Acceptance criteria

- [x] Gõ `/stats` trong Telegram trả về đúng số liệu hiện tại trong vòng vài giây.
- [x] Lệnh hiển thị trong menu Telegram (autocomplete).

## Ghi chú / rủi ro

- Nếu Phase 06/08 chưa làm, `/stats` có thể tạm thời chỉ hiển thị số lệnh đang mở (từ `open_positions`) và bổ sung dần các phần còn lại sau.
