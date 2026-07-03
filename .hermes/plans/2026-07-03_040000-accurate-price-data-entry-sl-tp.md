# Task list: Chính xác hoá entry/SL/TP/giá hiện tại (không còn dựa 100% vào AI đoán ảnh)

## Context — nguyên nhân gốc

Đã kiểm tra toàn bộ pipeline: **entry, stopLoss, takeProfit1, takeProfit2, và "giá hiện tại" (`currentPriceContext`) hiện tại 100% là AI model đọc ảnh chart bằng mắt (vision) và đoán vị trí pixel của các nhãn giá** — không có bất kỳ nguồn dữ liệu giá số (OHLC/price feed) nào được đưa vào hệ thống.

Bằng chứng cụ thể:
- `src/charts/analyzer.ts` (`analyzeWithOpenRouter`) chỉ gửi ảnh base64 + text label `[PAIR=...; TIMEFRAME=...]` cho model — không có số liệu giá thật kèm theo.
- `chart-types.ts`: `entry`, `stopLoss`, `takeProfit1`, `takeProfit2`, `currentPriceContext` đều là `string` tự do do AI sinh ra, không được validate với bất kỳ nguồn số liệu nào.
- `package.json`: không có dependency nào liên quan price feed (`ccxt`, `alpha-vantage`, OANDA API...). `.env.example` cũng không có API key cho price provider.
- `check-pending-orders-runner.ts` và `check-open-trades-runner.ts` (kiểm tra lệnh chờ đã khớp/vị thế nên đóng) cũng dùng lại đúng cơ chế: chụp ảnh mới → AI đọc ảnh → quyết định. Không có gì đối chiếu với giá thật.
- `src/charts/screenshot.ts`: chart được chụp qua Playwright render widget TradingView (`https://s3.tradingview.com/tv.js`), chỉ chờ `iframe` + `canvas` xuất hiện rồi **delay cứng 4 giây** (`CHART_RENDER_DELAY`) trước khi chụp — không có xác nhận chart đã render xong dữ liệu/label giá.

→ Sai số đến từ 2 nguồn: (1) AI đọc nhầm pixel/label giá trên ảnh tĩnh, (2) ảnh có thể được chụp khi chart chưa render xong (đặc biệt khi chạy song song 8 tab — `PARALLEL_TABS = 8`).

## Hướng khắc phục (theo thứ tự phụ thuộc)

### 1. Điều tra khả năng lấy giá thật từ DOM của TradingView widget

Widget nhúng trong `src/charts/charts.config.ts:51-79` là `TradingView.widget` chuẩn (bật `hide_top_toolbar`, `hide_side_toolbar` → có legend hiển thị OHLC + giá hiện tại dạng text). Cần xác minh bằng Playwright: legend/price-scale label này có phải DOM text thật (đọc được qua `contentFrame.locator(...)` hoặc `innerText()`) hay chỉ vẽ trên canvas (không đọc được).

- Nếu đọc được → đây là cách chính xác nhất để lấy giá hiện tại **thật**, không cần đoán qua AI vision, không cần API trả phí.
- Nếu không đọc được (canvas-only) → fallback dùng API giá miễn phí (Frankfurter, TwelveData free tier, exchangerate-api...) theo đúng symbol OANDA đang dùng trong `charts.config.ts`.

### 2. Gắn giá thật vào từng screenshot, đưa vào prompt AI làm "ground truth"

Sau khi có cách lấy giá thật (mục 1), sửa `src/charts/screenshot.ts` để attach giá hiện tại thật vào `ScreenshotResult` (thêm field `lastPrice` vào `chart-types.ts`). Truyền giá này vào `analyzer.ts` cùng ảnh, ví dụ `[PAIR=...; TIMEFRAME=...; LAST_PRICE=1.10234]`, và sửa prompt để AI bắt buộc phải cho ra entry/SL/TP **nhất quán với giá thật này** thay vì tự đoán hoàn toàn từ ảnh.

### 3. Sanity-check kết quả AI so với giá thật (chặn lỗi AI đọc sai)

Sau khi có giá thật đính kèm mỗi setup, thêm bước kiểm tra logic (không cần AI) trong `parseAnalysisResponse` (analyzer.ts):
- Với `orderType=MARKET_NOW`: nếu `entry` lệch quá xa (vd >0.5% hoặc N pips tuỳ theo pair) so với giá thật → loại setup / hạ confidence mạnh / ghi rõ lý do — vì nhiều khả năng AI đọc nhầm nhãn giá.
- Kiểm tra thứ tự hợp lý: hướng LONG mà giá thật đã nằm dưới stopLoss (hoặc ngược lại với SHORT) → loại ngay, không hợp lệ.
- Áp dụng lại đúng logic này trong `check-pending-orders-runner.ts` (quyết định TRIGGERED/CANCELLED) và `check-open-trades-runner.ts` (quyết định HOLD/CLOSE/STOP) — hiện 2 nơi này cũng đang tin hoàn toàn vào AI đọc ảnh mới mỗi lần chạy.

### 4. Thay delay cứng 4s bằng chờ tới khi chart ổn định

`src/charts/screenshot.ts` hiện dùng `page.waitForTimeout(CHART_RENDER_DELAY)` (4s, hoặc 5s cho verification screenshot) — là con số đoán, không đảm bảo TradingView đã render xong, nhất là khi chạy song song 8 tab cùng lúc. Thay bằng vòng lặp: đọc lại text nhãn giá (dùng đúng cơ chế ở mục 1) mỗi ~500ms, chỉ chụp khi giá trị đọc được ổn định 2 lần liên tiếp (hoặc chạm timeout tối đa ~8s thì vẫn chụp để tránh treo).

## Verification

1. Task 1: chạy thử Playwright locator/`innerText()` trên chart thật, xác nhận đọc được đúng giá hiện tại khớp với mắt nhìn trên TradingView.
2. Task 2-3: so sánh entry/SL/TP AI trả về trước/sau khi có `LAST_PRICE` trong prompt — kiểm tra AI có bám sát giá thật hơn không (test bằng vài chart mẫu đã biết trước giá đúng).
3. Task 3: viết unit test cho hàm sanity-check mới trong `tests/charts/analyzer.test.ts` — case entry lệch xa giá thật phải bị loại/hạ confidence, case hướng ngược SL phải bị loại.
4. Task 4: đo thời gian chụp trung bình trước/sau khi đổi từ delay cứng sang polling — đảm bảo không làm workflow chạy chậm quá mức timeout hiện tại (20 phút, `analyze.yml`).
5. Chạy `workflow_dispatch` thủ công, đối chiếu tay vài setup AI trả về với giá thật trên TradingView xem entry/SL/TP có khớp hợp lý hơn trước không.
