# Auto Signal Bot

Tự động quét tín hiệu và gửi thông báo qua Telegram. Gồm 2 chức năng độc lập:

- **Chart Analyzer**: chụp chart TradingView → phân tích bằng Gemini AI → gửi kết quả qua Telegram. Chạy miễn phí trên GitHub Actions mỗi 4 giờ.
- **Match Odds Scanner**: quét lịch đấu đội tuyển quốc gia, lấy kèo (odds) các trận sắp đá trong vài giờ tới, gửi file JSON qua Telegram. Chạy miễn phí trên GitHub Actions mỗi giờ.

## Stack

- **Node.js + TypeScript** — runtime & language
- **Playwright** — headless browser chụp chart (Chart Analyzer)
- **Google Gemini** — AI phân tích chart (free tier)
- **Claude Sonnet 4.6** — xác minh chéo các setup confidence cao
- **1xlite API** — dữ liệu trận đấu & kèo cược (Match Odds Scanner)
- **Telegram Bot** — gửi kết quả + báo lỗi
- **GitHub Actions** — scheduler miễn phí

## Setup

### 1. Tạo API keys (miễn phí)

- **Gemini**: [Google AI Studio](https://aistudio.google.com/apikey) → Create API Key
- **Anthropic (Claude)**: [console.anthropic.com](https://console.anthropic.com/) → tạo API key (dùng để xác minh chéo setup confidence cao)

### 2. Tạo Telegram Bot

1. Mở Telegram, tìm [@BotFather](https://t.me/BotFather)
2. Gửi `/newbot` → đặt tên → nhận **Bot Token**
3. Mở bot vừa tạo, gửi tin nhắn bất kỳ (ví dụ: `/start`)
4. Lấy Chat ID:
   ```
   curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
   Chat ID nằm trong `result[0].message.chat.id`

### 3. (Chỉ cho Match Odds Scanner) Lấy token `x-hd`

1. Mở trang 1xlite trên browser, vào DevTools → tab Network
2. Tìm 1 request bất kỳ tới `service-api/LineFeed/...`, copy header `x-hd`
3. Token này **sẽ hết hạn** theo thời gian — khi bot báo lỗi xác thực qua Telegram, lặp lại bước này để lấy token mới

### 4. Deploy lên GitHub

1. Push repo này lên GitHub
2. Vào **Settings → Secrets and variables → Actions** (environment `production`)
3. Thêm các secrets:
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — dùng chung cho cả 2 workflow
   - `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` — cho Chart Analyzer
   - `BETTING_X_HD`, `BETTING_BASE_URL`, `BETTING_CHAMP_ID` — cho Match Odds Scanner

### 5. Chạy thử

- Vào tab **Actions** → chọn workflow (`TradingView Chart Analysis` hoặc `Match Odds Scanner`) → **Run workflow**
- Hoặc đợi đến giờ chạy tự động (Chart Analyzer: mỗi 4h, Match Odds Scanner: mỗi giờ)

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

# Chạy Chart Analyzer
npm run analyze

# Chạy Match Odds Scanner
npm run match-odds
```

## Chi phí

| Service         | Free Tier                        |
|-----------------|----------------------------------|
| GitHub Actions  | 2000 mins/tháng (private repo)   |
| Gemini API      | 15 RPM, 1M tokens/ngày           |
| Telegram Bot    | Không giới hạn                   |
| **Tổng**        | **$0/tháng**                     |

Chart Analyzer: ~2-3 phút/lần × 6 lần/ngày → ~540 phút/tháng. Match Odds Scanner: ~10-20s/lần × 24 lần/ngày → ~10 phút/tháng. Cả 2 cộng lại vẫn nằm trong free tier GitHub Actions ✓

## Lưu ý

- Chart sử dụng TradingView widget URL (public) — không cần tài khoản TradingView
- Indicators mặc định: MA, RSI, MACD — có thể tùy chỉnh trong `charts.config.ts`
- Gemini free tier có rate limit — nếu nhiều chart, tăng delay giữa các request
- Match Odds Scanner phụ thuộc token `x-hd` (không công khai, không có cách lấy lại tự động) — khi hết hạn, bot sẽ báo lỗi qua Telegram, cần cập nhật token mới trong secrets
- **Phân tích/kèo chỉ mang tính tham khảo, không phải lời khuyên đầu tư hoặc cá cược**
