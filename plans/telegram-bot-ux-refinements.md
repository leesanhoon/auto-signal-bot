# Tinh chỉnh UX bot Telegram: bớt nút, thêm hiệu ứng loading, bỏ hiện lại menu

## Context

Bản nâng cấp menu nút bấm ([plans/telegram-inline-buttons-upgrade.md](telegram-inline-buttons-upgrade.md)) đã được triển khai và đang hoạt động (xác nhận qua [docs/telegram-webhook-setup.md](../docs/telegram-webhook-setup.md) đã cập nhật mục UX/Callback data). Người dùng muốn tinh chỉnh thêm 4 điểm:

1. **Bỏ 2 chức năng khỏi menu nút bấm**: "📋 Cập nhật danh sách trận" (`fetch_matches`) và "📦 Backfill lịch sử" (`lottery_backfill`, kèm submenu chọn số ngày).
2. **Thêm hiệu ứng loading** khi bấm nút, để người dùng biết bot đang xử lý chứ không phải treo.
3. **Không hiện lại menu chính** sau khi chọn 1 lệnh — chỉ hiện kết quả/xác nhận, không kèm nút "◂ Quay lại menu" như thiết kế cũ.
4. **Bỏ hoàn toàn việc gõ lệnh tay (text command)** — chỉ dùng nút bấm. Đây là thay đổi lớn so với plan trước (trước đó text command vẫn được giữ song song để tương thích ngược; giờ người dùng xác nhận sẽ chỉ thao tác qua nút, không cần giữ đường gõ lệnh nữa).

> Vì bỏ text command hoàn toàn, `fetch_matches` và `lottery_backfill` **sẽ không còn cách nào để trigger qua bot Telegram nữa** một khi đã ẩn khỏi menu (xem mục "Cân nhắc" bên dưới) — nếu vẫn cần 2 chức năng này thỉnh thoảng, phải chạy qua GitHub Actions UI (`workflow_dispatch` thủ công) hoặc CLI/cron, không qua Telegram.

## Thay đổi cụ thể

### 1. Menu chính — bỏ 2 nút

**Trước:**
```
📊 Phân tích chart
⚽ Quét kèo bóng đá
📋 Cập nhật danh sách trận     ← bỏ
🎰 Quét kết quả xổ số
🔮 Dự đoán xổ số
✅ Xác minh kết quả ▸
📦 Backfill lịch sử ▸           ← bỏ (cả submenu chọn ngày)
```

**Sau:**
```
┌─────────────────────────────┐
│ 📊 Phân tích chart           │
│ ⚽ Quét kèo bóng đá           │
├─────────────────────────────┤
│ 🎰 Quét kết quả xổ số        │
│ 🔮 Dự đoán xổ số             │
│ ✅ Xác minh kết quả ▸         │
└─────────────────────────────┘
```

`buildMainMenuKeyboard()` trong `index.ts` bỏ 2 hàng tương ứng `run:fetch_matches` và `menu:lottery_backfill`. Vì text command cũng bị bỏ (mục 4), `buildBackfillSubmenuKeyboard()`, route `run:lottery_backfill:*`, và toàn bộ entry cho `fetch_matches`/`lottery_backfill` trong bảng `COMMANDS` **có thể xoá hẳn khỏi code** thay vì chỉ ẩn — không còn đường nào gọi tới nữa.

Submenu miền (`buildRegionSubmenuKeyboard()`) giữ nguyên, không đổi.

### 1b. Bỏ hoàn toàn xử lý text command

- Xoá toàn bộ logic `parseCommand(text)` và nhánh `if (update.message)` xử lý theo từng lệnh gõ tay (`/analyze`, `/lottery_verify mien-bac`...) trong `Deno.serve`.
- **Giữ lại duy nhất** 1 nhánh xử lý `update.message`: bất kỳ tin nhắn text nào gửi tới (không quan trọng nội dung) → sau khi qua check whitelist `chat_id` → trả lời ngay bằng menu chính (`buildMainMenuKeyboard()`). Đây là cách duy nhất để mở menu (không cần phân biệt `/start`, `/menu`, `/help` nữa — gõ gì cũng ra menu).
- Toàn bộ tương tác thực sự (trigger workflow) chỉ đi qua nhánh `update.callback_query` như cũ.
- Bảng `COMMANDS` đổi từ "map lệnh text → workflow" thành "map callback action → workflow" (đổi key dùng nội bộ, không còn liên quan tới cú pháp `/xxx` của Telegram nữa, chỉ là id nội bộ).

### 2. Hiệu ứng loading khi bấm nút

Hiện tại khi bấm nút, Telegram tự hiện 1 spinner nhỏ trên chính nút đó cho tới khi server gọi `answerCallbackQuery` — nhưng nếu `dispatchWorkflow` mất 1-2 giây gọi GitHub API, người dùng không thấy phản hồi gì trong khung chat. Bổ sung 2 lớp feedback:

a) **Toast nhanh ngay khi bấm** — gọi `answerCallbackQuery` với `text` ngay khi nhận callback (trước khi gọi GitHub API), ví dụ:
```ts
await answerCallbackQuery(botToken, callbackQuery.id, "⏳ Đang xử lý...");
```
Cái này tắt spinner trên nút ngay lập tức và hiện toast nhỏ ở góc màn hình Telegram — phản hồi tức thì, không phải đợi GitHub API trả lời.

b) **Edit tin nhắn thành trạng thái loading** — ngay sau khi nhận callback, gọi `editMessageText` đổi nội dung tin nhắn (nơi chứa menu) thành:
```
⏳ Đang kích hoạt <tên chức năng>...
```
(bỏ `reply_markup` luôn ở bước này để nút biến mất ngay, tránh bấm trùng). Sau khi `dispatchWorkflow` trả về, gọi `editMessageText` lần 2 với nội dung kết quả cuối:
```
✅ Đã kích hoạt <tên chức năng> (<file>.yml)
Run: <link>
```
Nếu lỗi, edit thành thông báo lỗi tương tự nhánh catch hiện có.

→ Cần thêm helper `editMessageText(botToken, chatId, messageId, text, keyboard?)` nếu chưa có sẵn (theo plan trước đã liệt kê, kiểm tra lại trong code hiện tại đã implement chưa).

### 3. Không hiện lại menu sau khi chọn lệnh

- Bỏ nút **"◂ Quay lại menu"** khỏi tin nhắn xác nhận kết quả (bước b ở trên đã không gắn `reply_markup` cho tin nhắn final — giữ nguyên, không thêm gì).
- Người dùng muốn mở lại menu phải tự gõ `/start` hoặc `/menu` lần nữa — đây là thay đổi hành vi có chủ đích theo yêu cầu, không phải thiếu sót.
- Submenu "Xác minh kết quả" vẫn giữ nút "◂ Quay lại" **bên trong submenu đó** (để huỷ chọn miền quay về menu chính) — yêu cầu chỉ áp dụng cho **sau khi đã chọn xong và trigger lệnh**, không áp dụng cho điều hướng giữa menu/submenu.

## File cần sửa
- [supabase/functions/telegram-webhook/index.ts](../supabase/functions/telegram-webhook/index.ts):
  - Xoá `parseCommand()`, nhánh xử lý từng lệnh text trong `update.message`, và 2 entry `fetch_matches`/`lottery_backfill` khỏi `COMMANDS`
  - `buildMainMenuKeyboard()` — bỏ 2 dòng nút, chỉ còn 5 mục
  - Xoá `buildBackfillSubmenuKeyboard()` và route `run:lottery_backfill:*` (không còn dùng)
  - Nhánh `update.message` mới: bất kỳ tin nhắn nào (sau whitelist `chat_id`) → trả lời bằng menu chính
  - Hàm xử lý `run:*` trong `handleCallbackQuery` — thêm bước edit tin nhắn 2 lần (loading → kết quả), bỏ `reply_markup` ở tin nhắn kết quả
  - `answerCallbackQuery` — thêm `text: "⏳ Đang xử lý..."` khi gọi
- [docs/telegram-webhook-setup.md](../docs/telegram-webhook-setup.md) — viết lại mục "UX hiện tại" (chỉ còn dùng nút, không còn mô tả gõ lệnh tay) và "Callback data" (xoá các entry `lottery_backfill`/`fetch_matches`)
- README.md — nếu có liệt kê danh sách lệnh demo dạng `/analyze`, `/lottery_verify mien-bac`..., thay bằng mô tả luồng bấm nút (gửi bất kỳ tin nhắn nào → hiện menu → bấm chọn)

## Không cần thay đổi
- Workflow `.github/workflows/fetch-matches-list.yml` và `lottery-backfill.yml` — file workflow không đổi, chỉ là không còn cách trigger qua Telegram nữa (vẫn chạy theo cron hoặc tay qua GitHub Actions UI)
- Secrets / deploy / webhook registration — không đổi gì

## Cân nhắc trước khi xoá hẳn fetch_matches/lottery_backfill khỏi bot
- `fetch_matches.yml` đã có cron `0 0 * * *` (chạy tự động hằng ngày) → việc mất khả năng trigger qua Telegram ít ảnh hưởng vì nó tự chạy đều.
- `lottery-backfill.yml` **không có cron**, chỉ chạy `workflow_dispatch` — nếu xoá khỏi bot, cách duy nhất để chạy lại (vd cần backfill thêm dữ liệu) là vào GitHub Actions UI bấm tay hoặc dùng `gh workflow run lottery-backfill.yml -f days=90`. Xác nhận với người dùng đây có đúng là ý muốn không trước khi xoá code (đã hỏi và người dùng xác nhận chỉ dùng nút, không cần text command).

## Kiểm thử
1. Gửi bất kỳ tin nhắn nào (vd "hi", "/start", hay text bất kỳ) → bot luôn trả lời bằng menu chính, chỉ còn 5 nút (không còn "Cập nhật danh sách trận", không còn "Backfill lịch sử").
2. Bấm "📊 Phân tích chart" → thấy toast "⏳ Đang xử lý..." xuất hiện ngay, tin nhắn đổi thành "⏳ Đang kích hoạt..." rồi đổi tiếp thành "✅ Đã kích hoạt..." kèm link — **không** kèm nút bấm nào ở tin nhắn cuối.
3. Bấm "✅ Xác minh kết quả" → vào submenu 3 miền → bấm "Miền Bắc" → cùng hiệu ứng loading 2 bước như trên, kết thúc không có nút quay lại menu.
4. Trong submenu miền, bấm "◂ Quay lại" (khi CHƯA chọn miền) → vẫn quay về menu chính bình thường (không bị ảnh hưởng bởi thay đổi này).
5. Gõ tay `/analyze` hoặc bất kỳ lệnh cũ nào → **không còn được nhận diện như lệnh nữa**, chỉ ra menu chính như mọi tin nhắn khác (xác nhận text command đã bị gỡ hoàn toàn).
6. Bấm 1 nút 2 lần liên tục thật nhanh → không bị lỗi 500, không trigger workflow 2 lần (do nút đã bị gỡ khỏi tin nhắn ngay ở bước edit loading).
7. Xác nhận trên GitHub Actions: `fetch-matches-list.yml` vẫn tự chạy theo cron hằng ngày dù không còn trigger qua bot.
