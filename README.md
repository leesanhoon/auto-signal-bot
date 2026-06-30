# Auto Signal Bot

Tự động chụp chart TradingView → phân tích bằng Gemini AI → gửi kết quả qua Telegram.

Chạy miễn phí trên GitHub Actions mỗi 4 giờ.

## Stack

- **Node.js + TypeScript** — runtime & language
- **Playwright** — headless browser chụp chart
- **Google Gemini** — AI phân tích chart (free tier)
- **Gemini 2.5 Pro** — xác minh chéo các setup confidence cao
- **Telegram Bot** — gửi kết quả + báo lỗi
- **GitHub Actions** — scheduler miễn phí

## Setup

### 1. Tạo API keys (miễn phí)

- **Gemini**: [Google AI Studio](https://aistudio.google.com/apikey) → Create API Key
- **Gemini Pro**: [Google AI Studio](https://aistudio.google.com/apikey) → API key dùng cho bước xác minh chéo setup confidence cao

### 2. Tạo Telegram Bot

1. Mở Telegram, tìm [@BotFather](https://t.me/BotFather)
2. Gửi `/newbot` → đặt tên → nhận **Bot Token**
3. Mở bot vừa tạo, gửi tin nhắn bất kỳ để bot có thể trả về menu điều khiển
4. Lấy Chat ID:
   ```
   curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
   Chat ID nằm trong `result[0].message.chat.id`

### 3. Deploy lên GitHub

1. Push repo này lên GitHub
2. Vào **Settings → Secrets and variables → Actions** (environment `production`)
3. Thêm các secrets:
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`

### 4. Điều khiển workflow qua Telegram với Supabase Edge Function

Bot hiện tại vẫn gửi kết quả qua Telegram như cũ. Để nhận lệnh ngược lại từ Telegram và trigger `workflow_dispatch`, bạn cần tạo một Edge Function làm webhook.

1. Cài Supabase CLI theo [hướng dẫn chính thức](https://supabase.com/docs/guides/local-development/cli/getting-started), đăng nhập và liên kết repo với project:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   ```
2. Thiết lập secrets cho function:
   ```bash
   npx supabase secrets set TELEGRAM_BOT_TOKEN=...
   npx supabase secrets set TELEGRAM_CHAT_ID=...
   npx supabase secrets set TELEGRAM_WEBHOOK_SECRET=...
   npx supabase secrets set GITHUB_PAT=...
   npx supabase secrets set GITHUB_OWNER=...
   npx supabase secrets set GITHUB_REPO=...
   npx supabase secrets set GITHUB_REF=main
   ```
3. `GITHUB_PAT` nên là fine-grained PAT và chỉ cấp quyền `Actions: write` cho đúng repo này.
4. Deploy function. Cấu hình `verify_jwt = false` trong `supabase/config.toml` cho phép Telegram gọi webhook mà không cần Supabase JWT:
   ```bash
   npx supabase functions deploy telegram-webhook
   ```
5. Đăng ký webhook với Telegram:
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<project-ref>.functions.supabase.co/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
6. Gửi bất kỳ tin nhắn nào trong Telegram để mở menu nút bấm và kiểm tra webhook đã hoạt động.

Function nằm tại [`supabase/functions/telegram-webhook/index.ts`](supabase/functions/telegram-webhook/index.ts).

### 5. Chạy thử

- Vào tab **Actions** → chọn workflow (`TradingView Chart Analysis`) → **Run workflow**
- Hoặc đợi đến giờ chạy tự động (mỗi 4h)

Sau khi deploy webhook, luồng dùng Telegram là:

- Gửi bất kỳ tin nhắn nào để bot trả về menu chính
- Bấm `📊 Phân tích chart`, `⚽ Quét kèo bóng đá`, `🎰 Quét kết quả xổ số`, hoặc `🔮 Dự đoán xổ số` để trigger ngay
- Bấm submenu `✅ Xác minh kết quả ▸` để chọn miền và trigger `lottery-verify.yml`

Webhook chỉ chấp nhận message từ `TELEGRAM_CHAT_ID` đã cấu hình và kiểm tra thêm header `X-Telegram-Bot-Api-Secret-Token`.

## Tùy chỉnh chart

Sửa file `src/charts.config.ts` để thêm/bớt chart:

```typescript
export const CHARTS: ChartConfig[] = [
  {
    name: "BTC/USDT 4H",
    symbol: "BINANCE:BTCUSDT",     // TradingView symbol
    interval: "240",                // 1, 5, 15, 60, 240, D, W
    description: "Bitcoin 4-hour",
  },
  // Thêm chart khác tại đây...
];
```

### Interval phổ biến

| Giá trị | Timeframe |
|---------|-----------|
| `1`     | 1 phút    |
| `5`     | 5 phút    |
| `15`    | 15 phút   |
| `60`    | 1 giờ     |
| `240`   | 4 giờ     |
| `D`     | 1 ngày    |
| `W`     | 1 tuần    |

## Chạy local

```bash
# Install dependencies
npm install
npx playwright install chromium

# Set environment variables
cp .env.example .env
# Sửa .env với API keys thật

# Chạy
npm run analyze
```

## Chi phí

| Service         | Free Tier                        |
|-----------------|----------------------------------|
| GitHub Actions  | 2000 mins/tháng (private repo)   |
| Gemini API      | 15 RPM, 1M tokens/ngày           |
| Telegram Bot    | Không giới hạn                   |
| **Tổng**        | **$0/tháng**                     |

Mỗi lần chạy ~2-3 phút → 6 lần/ngày × 3 phút = ~18 phút/ngày → ~540 phút/tháng ✓

## Lưu ý

- Chart sử dụng TradingView widget URL (public) — không cần tài khoản TradingView
- Indicators mặc định: MA, RSI, MACD — có thể tùy chỉnh trong `charts.config.ts`
- Gemini free tier có rate limit — nếu nhiều chart, tăng delay giữa các request
- **Phân tích chỉ mang tính tham khảo, không phải lời khuyên đầu tư**
