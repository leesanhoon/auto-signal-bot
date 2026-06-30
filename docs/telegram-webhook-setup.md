# Telegram Webhook Setup

Tài liệu này mô tả cách dùng Supabase Edge Function `telegram-webhook` để nhận tương tác từ Telegram và trigger GitHub Actions qua `workflow_dispatch`.

## Yêu cầu

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`
- `GITHUB_PAT`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_REF` (mặc định `main`)

## UX hiện tại

- Sau khi qua whitelist `TELEGRAM_CHAT_ID`, bất kỳ tin nhắn nào gửi tới bot cũng chỉ dùng để mở menu chính.
- Bot không còn xử lý text command như `/analyze`, `/lottery_verify mien-bac`, `/start`, `/menu`, hay `/help` theo nhánh riêng.
- Mọi thao tác trigger workflow đều đi qua inline button.
- Khi bấm nút chạy workflow, bot phản hồi theo 3 bước:
  1. `answerCallbackQuery` hiện toast `⏳ Đang xử lý...`
  2. Tin nhắn menu bị `editMessageText` thành `⏳ Đang kích hoạt <tên chức năng>...`
  3. Cùng tin nhắn đó bị edit lần nữa thành kết quả cuối hoặc lỗi
- Tin nhắn kết quả cuối không kèm nút `Quay lại menu`.
- Submenu chọn miền cho `lottery_verify` vẫn giữ nút `◂ Quay lại` để quay về menu chính trước khi trigger workflow.

## Deploy

```bash
npx supabase functions deploy telegram-webhook
```

Function đã được cấu hình `verify_jwt = false` trong `supabase/config.toml`, nên Telegram có thể gọi trực tiếp.

## Đăng ký webhook Telegram

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<project-ref>.functions.supabase.co/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

## Callback data

Callback data của bot hiện dùng các giá trị ngắn sau:

- `menu:main`
- `menu:lottery_verify`
- `run:analyze`
- `run:match_odds`
- `run:lottery`
- `run:lottery_predict`
- `run:lottery_verify:mien-bac`
- `run:lottery_verify:mien-trung`
- `run:lottery_verify:mien-nam`

## Kiểm thử

1. Gửi bất kỳ tin nhắn nào trong Telegram.
2. Xác nhận bot trả về menu chính với 5 nút chức năng, không còn `Cập nhật danh sách trận` và `Backfill lịch sử`.
3. Bấm `📊 Phân tích chart` và xác nhận thấy toast `⏳ Đang xử lý...`, rồi tin nhắn đổi sang trạng thái loading, sau đó đổi tiếp thành kết quả cuối.
4. Bấm `✅ Xác minh kết quả ▸`, chọn một miền, và xác nhận tin nhắn cuối không còn nút quay lại menu.
5. Bấm `◂ Quay lại` trong submenu miền để xác nhận vẫn quay về menu chính bình thường.
6. Gửi `/analyze` hoặc bất kỳ lệnh cũ nào và xác nhận bot chỉ mở menu, không xử lý như text command nữa.
7. Gửi message từ chat khác để xác nhận vẫn bị chặn bằng `TELEGRAM_CHAT_ID`.
