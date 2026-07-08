# Review findings — Phase 09: Lệnh Telegram /stats

Review lần 5 của [docs/tasks/09-stats-command.md](09-stats-command.md).

## ✅ Update lần 5: monkey-patch đã bị gỡ bỏ hoàn toàn, logic đã chuyển đúng vào `index.ts`

Đã verify lại toàn bộ theo đúng checklist bắt buộc ở lần review 3/4:

- ✅ `src/shared/telegram-webhook-idempotency.ts` **đã sạch hoàn toàn** — grep xác nhận không còn `Deno.serve`, `denoRuntime`, `tryHandleStatsCommand` nào. Module giờ chỉ còn đúng phần idempotency thuần tuý như thiết kế ban đầu.
- ✅ `supabase/functions/telegram-webhook/index.ts` giờ có nhánh xử lý `/stats` rõ ràng, đúng vị trí (dòng ~552-555, trong `Deno.serve` handler thật, sau bước idempotency check, trước fallback `showMenu()`):
  ```ts
  const command = normalizeTelegramCommandToken(message.text?.trim().split(/\s+/)[0]);
  if (command === "/stats") {
    return handleStatsCommand(botToken, message.chat.id);
  }
  ```
- ✅ `handleStatsCommand()` dùng lại `getSupabaseClient()` đã có sẵn trong file (không tạo client mới trùng lặp — grep xác nhận chỉ có 1 định nghĩa `getSupabaseClient`).
- ✅ Gửi tin nhắn qua `sendTelegramMessage()` đã có sẵn (không tự viết `fetch()` riêng nữa) — còn được mở rộng thêm tham số `parseMode` với fallback tự động nếu Markdown parse lỗi (`can't parse entities` → gửi lại plain text) — cải tiến hợp lý, không phá vỡ hành vi cũ (tham số optional).
  - `handleStatsCommand()` không dùng workflow/GitHub Actions, xử lý trực tiếp trong Edge Function như quyết định thiết kế đã ghi trong task doc.
- ✅ Không còn logic bảo mật trùng lặp — webhook secret/allowedChatId chỉ được check 1 lần duy nhất ở đầu handler, `/stats` nằm trong nhánh `update.message` đã qua các bước kiểm tra đó.
- ✅ `src/shared/stats-report.ts` (`buildStatsReport`) có test riêng ([tests/shared/stats-report.test.ts](../../tests/shared/stats-report.test.ts)) cover đúng: đếm open positions, tổng hợp performance 7 ngày, tổng hợp usage theo ngày + theo provider.
- ✅ `npm test`: 13 files, 35 tests pass. `npx tsc --noEmit`: sạch.

## Việc dọn dẹp còn sót (nhỏ)
Hai file rác/backup còn sót lại trong thư mục Edge Function, là bản nháp cũ hơn từ quá trình sửa (không phải file thật sự dùng):
- [ ] Xóa `supabase/functions/telegram-webhook/index.new.ts`
- [ ] Xóa `supabase/functions/telegram-webhook/index.tmp.ts`

(Đã diff xác nhận: cả 2 file đều là phiên bản cũ hơn/thiếu code so với `index.ts` thật hiện tại — không phải bản thay thế, chỉ là rác cần xóa.)

## Trạng thái checklist trong task doc
[09-stats-command.md](09-stats-command.md) vẫn để checklist chưa tick — **đúng như yêu cầu**, vì chưa có bước live-verify bằng cách gửi `/stats` thật qua Telegram (cần `TELEGRAM_BOT_TOKEN`/`SUPABASE_URL`/`SUPABASE_KEY` thật, không có trong sandbox này). Về mặt code, phần implementation đã sẵn sàng để verify.

## Việc cần làm cho codex
- [ ] Xóa 2 file rác `index.new.ts` và `index.tmp.ts` trong `supabase/functions/telegram-webhook/`.
- [ ] Deploy Edge Function và gửi thử `/stats` qua Telegram thật (hoặc curl trực tiếp webhook với payload giả lập `message.text = "/stats"` + đúng `X-Telegram-Bot-Api-Secret-Token`) để xác nhận nhận được số liệu đúng.
- [ ] Sau khi verify thành công, tick lại checklist trong `09-stats-command.md`.

## Kết luận
Về mặt code, Phase 09 giờ đã được implement đúng cách (không còn hack/monkey-patch), tái sử dụng đúng các helper có sẵn. Chỉ còn dọn 2 file rác và verify thực tế qua Telegram trước khi đóng hẳn phase này.
