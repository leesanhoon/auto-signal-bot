# Auto Signal Bot

Bot tự động quét tín hiệu từ nhiều nguồn, ưu tiên cho luồng trading chart:

- Chụp chart TradingView đa khung thời gian
- Phân tích bằng deterministic numeric engine
- Xác minh setup confidence cao
- Tự động lưu vị thế mở, theo dõi vị thế đang chạy
- Gửi kết quả, thống kê và cảnh báo qua Telegram

Ngoài luồng chart, repo còn có các runner cho betting, lottery, backtesting, performance tracking và observability.

## Tính Năng Đã Triển Khai

### 1. Phân Tích Chart Đa Khung Thời Gian

- Chụp cùng lúc 3 timeframe cho mỗi cặp: `D1`, `H4`, `M15`
- Phân tích multi-timeframe confluence thay vì chỉ nhìn một khung
- Bật volume trên chart để model đọc được tương quan giá và khối lượng
- Gắn nhãn rõ từng ảnh theo `PAIR` và `TIMEFRAME`
- Có bước xác minh setup confidence cao bằng bộ kiểm tra độc lập trước khi auto-save vị thế

### 2. Quản Lý Vị Thế

- Tự động lưu các setup được xác nhận thành `open_positions`
- Có decision engine để đọc chart và ra quyết định `HOLD`, `CLOSE`, hoặc `STOP`
- Hỗ trợ theo dõi mở lệnh, TP1 partial close, trailing stop, đóng lệnh
- Có runner kiểm tra lại các vị thế đang mở trên chart H4

### 3. Stats Và Performance

- Lệnh Telegram `/stats` hiển thị:
  - số vị thế đang mở
  - win-rate gần đây
  - usage trong ngày
- Có báo cáo hiệu suất định kỳ:
  - win-rate
  - R:R thực tế
  - drawdown
  - tổng hợp theo cặp
- Có lưu và tổng hợp dữ liệu đóng lệnh để phục vụ phân tích sau này

### 4. Observability Và An Toàn Vận Hành

- Structured logging
- Telegram webhook idempotency để tránh xử lý trùng update
- Rate limiting chủ động cho các request ngoài
- Theo dõi token/cost cho các request ngoài
- Cảnh báo khi usage gần chạm ngưỡng cấu hình

### 5. Telegram Workflow

- Có Telegram menu để trigger workflow GitHub Actions
- Webhook Supabase nhận lệnh và dispatch workflow
- Cấu hình xác thực bằng `X-Telegram-Bot-Api-Secret-Token`
- Chỉ cho phép chat ID đã khai báo

### 6. Betting Và Lottery

- Có runner riêng cho quét kèo bóng đá
- Có pipeline cho lottery scan, predict, verify, backfill và backtest

## Kiến Trúc Tổng Quan

- **Node.js + TypeScript**: runtime chính
- **Playwright**: chụp chart TradingView
- **Deterministic engine**: phân tích chart và xác minh setup
- **Telegram Bot**: nhận lệnh, gửi kết quả, gửi cảnh báo
- **Supabase**: lưu logs, idempotency, usage, performance tracking
- **GitHub Actions**: chạy định kỳ và dispatch workflow từ Telegram

## Cấu Trúc Chính

- `src/charts`: luồng phân tích chart, quyết định vị thế, backtest, performance report
- `src/betting`: luồng quét và backtest kèo bóng đá
- `src/lottery`: luồng quét, dự đoán, verify và backtest xổ số
- `src/shared`: helper chung cho Telegram, logging, DB, stats, usage, rate limit
- `supabase/functions/telegram-webhook`: webhook nhận Telegram update và kích hoạt workflow

## Yêu Cầu

- Node.js 20+ khuyến nghị
- npm
- Playwright Chromium
- Telegram bot token
- Supabase project cho webhook, logs và metrics
- GitHub PAT có quyền `Actions: write`

## Cài Đặt Nhanh

### 1. Cài dependency

```bash
npm install
npx playwright install chromium
```

### 2. Tạo file `.env`

Sao chép từ `.env.example` rồi điền giá trị thật.

Các biến chính:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_PAT`
- `GITHUB_REF`
- `API_FOOTBALL_KEY`
- `API_FOOTBALL_BOOKMAKER`
- `API_FOOTBALL_LEAGUE`

### 3. Cấu hình Telegram bot

1. Tạo bot với [@BotFather](https://t.me/BotFather)
2. Lấy `TELEGRAM_BOT_TOKEN`
3. Gửi một tin nhắn bất kỳ vào bot để lấy `chat_id`
4. Chạy menu setup:

```bash
npm run setup:telegram-menu
```

### 4. Cấu hình Supabase webhook

Project có Edge Function tại [`supabase/functions/telegram-webhook/index.ts`](supabase/functions/telegram-webhook/index.ts).

Trong [`supabase/config.toml`](supabase/config.toml), webhook được set `verify_jwt = false` để Telegram có thể gọi trực tiếp.

Thiết lập secret cho function:

```bash
npx supabase secrets set TELEGRAM_BOT_TOKEN=...
npx supabase secrets set TELEGRAM_CHAT_ID=...
npx supabase secrets set TELEGRAM_WEBHOOK_SECRET=...
npx supabase secrets set GITHUB_PAT=...
npx supabase secrets set GITHUB_OWNER=...
npx supabase secrets set GITHUB_REPO=...
npx supabase secrets set GITHUB_REF=main
```

Deploy function:

```bash
npx supabase functions deploy telegram-webhook
```

Đăng ký webhook với Telegram:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<project-ref>.functions.supabase.co/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

## Chạy Hệ Thống

### Phân tích chart

```bash
npm run analyze
```

Luồng này sẽ:

1. Chụp chart theo cấu hình
2. Gửi toàn bộ ảnh vào engine deterministic để phân tích
3. Xác minh các setup confidence cao
4. Lưu vị thế đủ điều kiện
5. Gửi kết quả qua Telegram
6. Kiểm tra lại các vị thế đang mở

### Báo cáo hiệu suất

```bash
npm run performance-report
```

### Backtest

```bash
npm run forex-backtest
npm run betting-backtest
npm run lottery-backtest
```

### Test / debug

```bash
npm test
npm run test-analyze
npm run test-model-compare
```

## Telegram Commands

- `/help` - mở menu
- `/stats` - xem thống kê hiện tại

Menu nút bấm hiện có:

- Phân tích chart
- Quét kèo bóng đá
- Quét kết quả xổ số
- Dự đoán xổ số
- Xác minh kết quả theo miền

## Lưu Ý Khi Vận Hành

- Provider phân tích ngoài có thể trả `503 UNAVAILABLE` khi quá tải, code đã có retry tự động
- Phân tích đa khung thời gian làm tăng chi phí và thời gian chụp chart, nhưng đổi lại giảm false positive
- Kết quả phân tích chỉ nên xem như hỗ trợ ra quyết định, không phải lời khuyên đầu tư
- Với Supabase webhook, nên dùng service role key ở server-side, không dùng anon key

## Free Tier / Chi Phí

Mục tiêu của project là vận hành gần như miễn phí với free tier, nhưng chi phí thực tế còn phụ thuộc:

- Số lần chạy mỗi ngày
- Số chart cần chụp
- Số lượt retry phân tích
- Số token tiêu thụ khi xác minh setup và thống kê

## Tài Liệu Liên Quan

- [Roadmap tổng quan](docs/tasks/00-overview.md)
- [Phase 09 - /stats](docs/tasks/09-stats-command.md)
- [Phase 10 - mở rộng tính năng](docs/tasks/10-feature-expansion.md)
