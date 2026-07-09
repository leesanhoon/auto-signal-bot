# Task 02: SMC Workflow + Cron riêng biệt

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 01 đã approved.**

## Mục tiêu

Thêm npm script cho entrypoint mới, viết lại `.github/workflows/analyze-smc.yml` để: gọi script mới, xoá toàn bộ bước Playwright (không cần vì SMC không bao giờ chụp ảnh chart), đổi cron sang cadence phù hợp M15.

## Việc cần làm

### 1. `package.json`

Thêm script mới (đặt cạnh `"analyze"` hiện có, không xoá `"analyze"` — Bob Volman vẫn cần):

```json
"analyze:smc": "tsx src/charts/smc-index.ts",
```

### 2. `.github/workflows/analyze-smc.yml`

Viết lại toàn bộ nội dung:

```yaml
name: SMC Chart Analysis (Standalone)

on:
  schedule:
    - cron: "*/15 * * * 1-5"
  workflow_dispatch:

jobs:
  analyze-smc:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: production

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run SMC analysis
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          TWELVEDATA_API_KEY: ${{ secrets.TWELVEDATA_API_KEY }}
          CHART_SIGNAL_CONFIDENCE_THRESHOLD: ${{ vars.CHART_SIGNAL_CONFIDENCE_THRESHOLD }}
          PENDING_ORDER_EXPIRY_RUNS: ${{ vars.PENDING_ORDER_EXPIRY_RUNS }}
          CHART_TIMEFRAME_MODE: ${{ vars.CHART_TIMEFRAME_MODE }}
          CHART_PRIMARY_TIMEFRAME: ${{ vars.CHART_PRIMARY_TIMEFRAME }}
        run: npm run analyze:smc
```

**Giải thích các thay đổi so với file cũ:**
- Xoá hoàn toàn 3 bước: "Cache Playwright browsers", "Install Playwright Chromium", "Install Playwright OS deps" — SMC không bao giờ chụp ảnh chart (`analyzeAllChartsSmc` luôn trả `screenshots: []`), nên các bước này chỉ tốn thời gian CI mà không dùng đến.
- `timeout-minutes: 20` → `10` — vì không còn bước cài Playwright (thường là phần chậm nhất), thời gian chạy thực tế sẽ ngắn hơn nhiều. Nếu sau khi deploy thấy vẫn cần nhiều thời gian hơn (do rate limit TwelveData xếp hàng), có thể tăng lại — ghi rõ trong `result.md` nếu có điều chỉnh.
- Cron `"15 0,4,8,12,16,20 * * 1-5"` (6 lần/ngày) → `"*/15 * * * 1-5"` (mỗi 15 phút, thứ 2-6) — khớp với entry timeframe M15 thực tế của SMC.
- Xoá biến env `CHART_TRADING_SYSTEM: smc` — không cần nữa vì `smc-index.ts` luôn luôn là SMC, không đọc biến này.
- Đổi tên workflow từ "SMC Chart Analysis (Parallel)" → "SMC Chart Analysis (Standalone)" để phản ánh đúng bản chất mới (không còn dùng chung entrypoint với Bob Volman).

## Việc KHÔNG được làm

- Không sửa `.github/workflows/analyze.yml` (Bob Volman) — giữ nguyên 100%, kể cả cron, kể cả Playwright.
- Không xoá script `"analyze"` trong `package.json` — Bob Volman vẫn cần.
- Không đổi tên file workflow (`analyze-smc.yml` giữ nguyên tên, chỉ đổi nội dung bên trong).

## Test cần thêm

Không có test tự động cho file YAML/npm script (không nằm trong phạm vi vitest). Verify thủ công:
1. `npm run analyze:smc` chạy được cục bộ (cần `.env` có đủ biến — nếu không có sẵn khoá thật, chỉ cần xác nhận lệnh khởi động đúng file, không cần chạy hết thành công nếu thiếu secret).
2. Đọc lại YAML mới, xác nhận cú pháp hợp lệ (không cần công cụ đặc biệt, đọc kỹ bằng mắt hoặc dùng `python -c "import yaml; yaml.safe_load(open('.github/workflows/analyze-smc.yml'))"` nếu có Python, hoặc tương đương để validate YAML hợp lệ).

## Acceptance Criteria

- `npm run build` pass (không ảnh hưởng vì chỉ đổi YAML/JSON, nhưng vẫn chạy để chắc chắn không phá gì).
- `package.json` có script `analyze:smc` trỏ đúng `src/charts/smc-index.ts`.
- `analyze-smc.yml` không còn bước Playwright nào, cron mới là `*/15 * * * 1-5`, không còn biến `CHART_TRADING_SYSTEM`.
- `analyze.yml` không bị đụng (verify bằng `git diff` không có thay đổi ở file này).

## Kết quả cần ghi vào `result.md`

- Nội dung `package.json` diff.
- Nội dung đầy đủ `analyze-smc.yml` mới.
- Xác nhận `analyze.yml` không bị đổi.
- Nếu bị chặn (ví dụ không có Python để validate YAML) → dùng cách khác để verify cú pháp, ghi rõ cách đã làm.
