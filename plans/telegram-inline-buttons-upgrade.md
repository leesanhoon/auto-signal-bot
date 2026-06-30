# Nâng cấp Telegram bot: dùng nút bấm (inline keyboard) thay vì gõ lệnh

## Context

Hiện tại bot (`supabase/functions/telegram-webhook/index.ts`) chỉ nhận **text command** dạng gõ tay: `/analyze`, `/lottery_verify mien-bac`, `/lottery_backfill 30`... Người dùng phải nhớ cú pháp và tự gõ tham số (vd phải nhớ đúng chính tả `mien-bac`).

Người dùng muốn:
1. Khi vào chat với bot (gửi `/start` hoặc tin nhắn đầu tiên) → **hiện ngay menu nút bấm** cho tất cả chức năng, không cần gõ `/help`.
2. Với chức năng cần chọn tham số (vd **kiểm tra kết quả xổ số theo miền**) → bấm nút chọn miền (mien-bac/mien-trung/mien-nam) → workflow chạy ngay, không cần gõ lệnh kèm tham số.
3. Áp dụng cách này cho **toàn bộ chức năng khác** (không chỉ riêng lottery-verify).

## Thiết kế UX mới

### Menu chính (hiện khi gửi `/start`, `/menu`, `/help`, hoặc bất kỳ tin nhắn nào không khớp lệnh nào)

```
┌─────────────────────────────┐
│ 📊 Phân tích chart           │
│ ⚽ Quét kèo bóng đá           │
│ 📋 Cập nhật danh sách trận   │
├─────────────────────────────┤
│ 🎰 Quét kết quả xổ số        │
│ 🔮 Dự đoán xổ số             │
│ ✅ Xác minh kết quả ▸         │
│ 📦 Backfill lịch sử ▸         │
└─────────────────────────────┘
```
(`▸` = có submenu, các nút còn lại bấm là chạy ngay)

### Submenu "Xác minh kết quả" (khi bấm nút "✅ Xác minh kết quả")

```
┌─────────────────────────────┐
│ Miền Bắc                     │
│ Miền Trung                   │
│ Miền Nam                     │
├─────────────────────────────┤
│ ◂ Quay lại                   │
└─────────────────────────────┘
```
Bấm 1 miền → trigger ngay `lottery-verify.yml` với `region` tương ứng, không cần gõ gì thêm.

### Submenu "Backfill lịch sử" (khi bấm nút "📦 Backfill lịch sử")

```
┌─────────────────────────────┐
│ 30 ngày                      │
│ 90 ngày                      │
│ 365 ngày                     │
│ 1095 ngày (mặc định)         │
├─────────────────────────────┤
│ ◂ Quay lại                   │
└─────────────────────────────┘
```
Bấm 1 lựa chọn → trigger ngay `lottery-backfill.yml` với `days` tương ứng.

### Sau khi trigger thành công
Bot edit lại tin nhắn (hoặc gửi tin mới) xác nhận: `✅ Đã kích hoạt <tên chức năng>` + link run GitHub Actions, kèm nút **"◂ Quay lại menu"** để bấm tiếp lệnh khác mà không cần gõ `/start` lại.

### Lệnh gõ tay (`/analyze`, `/lottery_verify mien-bac`...)
**Vẫn giữ nguyên hoạt động** như cũ (không phá vỡ tính năng đang có) — chỉ là không bắt buộc dùng nữa, người dùng có thể chọn gõ lệnh HOẶC bấm nút.

## Thiết kế kỹ thuật

### 1. Telegram Bot API cần dùng thêm
- `reply_markup.inline_keyboard` khi gọi `sendMessage` — để gắn nút bấm vào tin nhắn
- Xử lý update type mới: **`callback_query`** (khi user bấm nút) — hiện code chỉ xử lý `update.message`
- `answerCallbackQuery` — bắt buộc gọi sau khi xử lý callback, nếu không nút sẽ hiện loading icon mãi trên Telegram client
- `editMessageReplyMarkup` / `editMessageText` (tuỳ chọn) — để thay nội dung tin nhắn thay vì gửi tin mới liên tục, giữ chat gọn

### 2. Callback data scheme
Telegram giới hạn `callback_data` ≤ 64 bytes, cần encode ngắn gọn:
```
menu:main                        → hiện menu chính
menu:lottery_verify              → hiện submenu chọn miền
menu:lottery_backfill            → hiện submenu chọn số ngày
run:analyze                      → trigger analyze.yml ngay
run:match_odds                   → trigger match-odds.yml ngay
run:fetch_matches                → trigger fetch-matches-list.yml ngay
run:lottery                      → trigger lottery.yml ngay
run:lottery_predict              → trigger lottery-predict.yml ngay
run:lottery_verify:mien-bac      → trigger lottery-verify.yml, region=mien-bac
run:lottery_verify:mien-trung    → trigger lottery-verify.yml, region=mien-trung
run:lottery_verify:mien-nam      → trigger lottery-verify.yml, region=mien-nam
run:lottery_backfill:30          → trigger lottery-backfill.yml, days=30
run:lottery_backfill:90          → trigger lottery-backfill.yml, days=90
run:lottery_backfill:365         → trigger lottery-backfill.yml, days=365
run:lottery_backfill:1095        → trigger lottery-backfill.yml, days=1095
```

### 3. Thay đổi trong `supabase/functions/telegram-webhook/index.ts`

- **Tách `COMMANDS` map hiện có** thành nguồn dữ liệu dùng chung cho cả 2 luồng (text command parsing cũ + callback_data mới), tránh trùng lặp logic gọi `dispatchWorkflow`.
- **Thêm hàm `buildMainMenuKeyboard()`** trả về `inline_keyboard` array cho menu chính.
- **Thêm hàm `buildRegionSubmenuKeyboard()`** và **`buildBackfillSubmenuKeyboard()`**.
- **Sửa entrypoint `Deno.serve`:**
  - Nếu `update.message` tồn tại → giữ logic cũ (parse text command), nhưng:
    - `/start` hoặc `/menu` → gửi menu chính kèm `reply_markup`
    - Lệnh không khớp (`unknown-command`) → thay vì chỉ in lỗi, **gửi kèm menu chính** luôn để người dùng bấm thay vì gõ lại
  - Nếu `update.callback_query` tồn tại → xử lý route mới:
    1. Parse `callback_query.data` theo scheme ở trên
    2. Nếu `menu:*` → gọi `editMessageReplyMarkup` (hoặc `sendMessage` mới) với submenu tương ứng
    3. Nếu `run:*` → gọi `dispatchWorkflow` y hệt logic cũ, rồi `editMessageText` xác nhận kết quả + nút "◂ Quay lại menu"
    4. Luôn gọi `answerCallbackQuery(callback_query.id)` ở cuối (kể cả khi lỗi) để tắt loading spinner
  - Vẫn giữ check whitelist `chat_id` áp dụng cho cả `message.chat.id` và `callback_query.message.chat.id`

### 4. Cấu trúc code đề xuất (không viết code thật ở bước plan này)
```
type CallbackAction =
  | { type: "menu"; menu: "main" | "lottery_verify" | "lottery_backfill" }
  | { type: "run"; command: string; args: string[] };

function parseCallbackData(data: string): CallbackAction { ... }
function buildMainMenuKeyboard(): InlineKeyboardMarkup { ... }
function buildRegionSubmenuKeyboard(): InlineKeyboardMarkup { ... }
function buildBackfillSubmenuKeyboard(): InlineKeyboardMarkup { ... }
async function answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string): Promise<void> { ... }
async function editMessageText(botToken: string, chatId: number, messageId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<void> { ... }
async function handleCallbackQuery(query: TelegramCallbackQuery, env): Promise<Response> { ... }
```

### 5. Cập nhật `/help` và `buildHelpMessage()`
Giữ lại `/help` dạng text cho người dùng quen gõ lệnh, nhưng bổ sung 1 dòng: *"Hoặc gửi /start để dùng menu nút bấm."*

## File cần sửa
- [supabase/functions/telegram-webhook/index.ts](../supabase/functions/telegram-webhook/index.ts) — toàn bộ logic trên
- [docs/telegram-webhook-setup.md](../docs/telegram-webhook-setup.md) — cập nhật phần "Danh sách lệnh hỗ trợ" thêm mục dùng menu nút bấm, không cần đổi setup/deploy (cùng 1 function, không thêm secret mới)
- [README.md](../README.md) — cập nhật ví dụ sử dụng, thêm `/start` vào danh sách lệnh demo

## Không cần thay đổi
- Các workflow `.github/workflows/*.yml` — input scheme (`region`, `days`) giữ nguyên
- Supabase secrets — không cần thêm secret mới
- Cách deploy/đăng ký webhook — giữ nguyên hoàn toàn, chỉ deploy lại code mới (`npx supabase functions deploy telegram-webhook`)

## Rủi ro / lưu ý khi implement
- **`callback_data` giới hạn 64 byte** — scheme đề xuất ở trên đều ngắn, an toàn.
- **Phải luôn gọi `answerCallbackQuery`** kể cả khi có lỗi (trong catch block), nếu không nút bấm trên Telegram sẽ bị "treo" loading.
- **Race condition khi double-click nút nhanh** — không bắt buộc xử lý ở bản đầu, nhưng nên cân nhắc disable nút sau khi bấm (Telegram không hỗ trợ disable trực tiếp, chỉ có thể xoá `reply_markup` sau khi xử lý xong bằng `editMessageReplyMarkup` với `inline_keyboard: []`).
- **Giữ tương thích ngược**: người dùng cũ quen gõ `/analyze` vẫn phải hoạt động y hệt, không breaking change.

## Kiểm thử
1. Gửi `/start` → bot hiện menu nút bấm chính, không cần gõ `/help`.
2. Bấm "📊 Phân tích chart" → bot trigger `analyze.yml` ngay, xác nhận có run mới trên GitHub Actions.
3. Bấm "✅ Xác minh kết quả" → hiện submenu 3 miền → bấm "Miền Bắc" → trigger `lottery-verify.yml` với `region=mien-bac`, kiểm tra Actions.
4. Bấm "📦 Backfill lịch sử" → hiện submenu số ngày → bấm "90 ngày" → trigger `lottery-backfill.yml` với `days=90`.
5. Bấm "◂ Quay lại" ở submenu → quay về menu chính, không trigger gì.
6. Gửi lệnh gõ tay cũ `/analyze` → vẫn hoạt động như trước (không breaking).
7. Test từ chat_id lạ bấm nút → bị chặn, không trigger gì (whitelist vẫn áp dụng cho callback_query).
8. Bấm nút nhiều lần liên tục → không bị lỗi 500, mỗi lần đều `answerCallbackQuery` đúng.
