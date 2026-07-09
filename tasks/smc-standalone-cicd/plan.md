# Plan: Tách SMC thành hệ thống độc lập hoàn toàn (entrypoint + CI), không kế thừa Bob Volman

## Bối cảnh (đã khảo sát trực tiếp code)

`analyze-smc.yml` hiện tại gọi chung `npm run analyze` → `tsx src/charts/index.ts` — **cùng 1 entrypoint với hệ Bob Volman**, chỉ khác biến env `CHART_TRADING_SYSTEM=smc`. Việc dùng chung file này khiến SMC kế thừa nhiều thứ thiết kế riêng cho Bob Volman:

| Vấn đề | Bằng chứng | Ảnh hưởng đến SMC |
|---|---|---|
| Cache key + cửa sổ cho phép chạy live bị ép cứng `"H4"` | [index.ts:268-269](../../src/charts/index.ts#L268-L269): `const analysisTimeframe = timeframeMode === "single" ? primaryTimeframe : "H4";` — không đọc `tradingSystem` | SMC thực chất phân tích M15 ([smc-pipeline.ts:36-39](../../src/charts/smc/smc-pipeline.ts#L36-L39)) nhưng bị cache theo chu kỳ 4 tiếng của H4 — chạy tay giữa chừng trả về cache cũ, không phân tích lại M15 mới |
| Comment gốc xác nhận cron được thiết kế riêng cho H4 | [chart-cache.ts:39-42](../../src/charts/chart-cache.ts#L39-L42): "Khớp lịch cron trong .github/workflows/analyze.yml: 5 0,4,8,12,16,20 * * 1-5" | Cadence 4 tiếng/lần là di sản Bob Volman, chưa từng được thiết kế cho nhu cầu M15 của SMC |
| Heartbeat message hard-code thương hiệu Bob Volman | [telegram.ts](../../src/shared/telegram.ts) hàm `buildHeartbeatMessage`: dòng title cố định `"🫀 *Bob Volman Algorithm Scanner heartbeat*"` bất kể `engineMode` truyền vào là gì | Khi SMC không có event nào (heartbeat), tin nhắn Telegram vẫn ghi "Bob Volman Algorithm Scanner heartbeat" — sai thương hiệu, gây hiểu nhầm |
| Cài Playwright Chromium dù không cần | `analyze-smc.yml` có bước "Install Playwright Chromium"/"Cache Playwright browsers" | `analyzeAllChartsSmc` luôn trả `screenshots: []` ([smc-pipeline.ts](../../src/charts/smc/smc-pipeline.ts)) — không bao giờ chụp ảnh chart, nên toàn bộ setup Playwright trong workflow SMC là **lãng phí thời gian CI hoàn toàn**, xác nhận qua đọc `findScreenshotForSetup` trong `telegram.ts` (chỉ tìm trong mảng đã có sẵn, không tự chụp mới) |
| Dual-engine branching rải khắp `index.ts` | `tradingSystem === "smc" ? ... : ...` lặp lại ở `analyzeCurrentWindow`, `loadAnalysisForRun`, `handleAnalysisResult` | SMC phụ thuộc vào nhánh rẽ chung với Bob Volman — sửa 1 bên dễ vô tình ảnh hưởng bên kia (đã từng xảy ra: dòng `runCheckPendingOrders()` bị comment nhầm trong 1 commit "style") |

**Các phần đã xác nhận là hạ tầng dùng chung hợp lý, KHÔNG phải "kế thừa Bob Volman"** (đã grep xác nhận không có logic đặc thù Bob Volman bên trong): `runCheckOpenTrades`, `runCheckPendingOrders`, `positions-repository.ts`, `position-engine.ts`, `chart-cache.ts` (các hàm `getLastClosedCandleKey`/`isWithinTimeframeCandleCloseWindow` đã nhận `timeframe` làm tham số, generic sẵn — vấn đề chỉ nằm ở `index.ts` ép cứng `"H4"`), `ohlc-provider.ts`, `smc-htf-context.ts`, toàn bộ `smc/*`. **Không cần viết lại các phần này**, chỉ cần dùng đúng cách.

## Mục tiêu

Tạo **entrypoint riêng, workflow CI riêng** cho SMC — độc lập hoàn toàn với `index.ts`/`analyze.yml` (Bob Volman), không còn nhánh rẽ `tradingSystem === "smc" ? ... : ...` nào, dùng đúng timeframe M15 cho cache/gating, không cài Playwright, cron phù hợp với M15.

## Thiết kế

1. **`src/charts/smc-index.ts`** (mới) — entrypoint `main()` chỉ dành cho SMC:
   - Không import `analyzeAllChartsDeterministic`, không đọc `getConfiguredChartTradingSystem()`, không có nhánh `if (tradingSystem === "smc")`.
   - `analysisTimeframe` tính đúng theo cách `analyzeAllChartsSmc` tự tính nội bộ: `timeframeMode === "single" ? primaryTimeframe : "M15"` (copy đúng công thức từ [smc-pipeline.ts:36-39](../../src/charts/smc/smc-pipeline.ts#L36-L39) để 2 nơi luôn khớp nhau — cache key/window phải phản ánh đúng khung mà SMC thực sự phân tích).
   - Tái dùng nguyên vẹn (import trực tiếp, KHÔNG viết lại): `getLastClosedCandleKey`, `isWithinTimeframeCandleCloseWindow` (từ `chart-cache.ts`), `loadChartAnalysisCache`/`saveChartAnalysisCache`/`loadLatestChartAnalysisCache` (từ `chart-cache-repository.ts`), `buildChartAnalysisCacheKey` (từ `analyzer.js`), `runCheckOpenTrades`, `runCheckPendingOrders` (gọi **thật sự**, không comment out — bài học từ bug đã phát hiện ở `index.ts`), `saveOpenPosition`/`savePendingOrder`, `validateTradeSetupForOpen`.
   - Gọi `runCheckPendingOrders()` bình thường (không comment) — file mới không kế thừa bug này.
   - Message heartbeat/no-event: viết hàm nhỏ riêng cho SMC (không gọi `buildHeartbeatMessage` vì hàm đó hard-code "Bob Volman" trong title) — hoặc nếu muốn tái dùng, phải sửa `buildHeartbeatMessage` để dùng đúng `engineMode` cho title thay vì hard-code (xem chi tiết trong task 01).
   - `notifyError` dùng chung được (hàm này generic, chỉ nhận `scope: string` — truyền `"SMC multi-timeframe scanner"` trực tiếp, không cần `getChartScannerErrorScope`).

2. **`package.json`**: thêm script `"analyze:smc": "tsx src/charts/smc-index.ts"`.

3. **`.github/workflows/analyze-smc.yml`**: viết lại — gọi `npm run analyze:smc`, **xoá hoàn toàn** các bước Playwright (cache + install), đổi cron sang cadence phù hợp M15, xoá biến env `CHART_TRADING_SYSTEM` (không cần nữa vì script luôn là SMC).

## Ràng buộc bắt buộc

- **Không sửa `src/charts/index.ts`** — Bob Volman giữ nguyên 100%, chạy qua `analyze.yml` như cũ, không bị ảnh hưởng bởi bất kỳ thay đổi nào ở đây.
- **Không sửa** `check-open-trades-runner.ts`, `check-pending-orders-runner.ts`, `positions-repository.ts`, `position-engine.ts`, `chart-cache.ts`, `chart-cache-repository.ts`, `smc/*` — đây là hạ tầng dùng chung hợp lệ, không phải thứ cần "tách khỏi Bob Volman".
- Nếu cần sửa `buildHeartbeatMessage` trong `telegram.ts` (để không hard-code "Bob Volman" khi dùng cho SMC) — chỉ sửa **đúng dòng title** để dùng tham số `engineMode` đã truyền sẵn, không đổi signature hàm, không ảnh hưởng cách Bob Volman gọi hàm này (Bob Volman truyền `engineMode: "bob-volman"` hoặc tương tự, vẫn ra đúng "Bob Volman..." như cũ).
- Test hiện có `tests/charts/index.test.ts` (Bob Volman) phải tiếp tục pass nguyên trạng, không đổi.
- Sau mỗi subtask: `npm run build && npm test` pass.
- Chạy tuần tự 01 → 02 → 03.

## Subtasks

| Subtask ID | Mô tả | Owner | Files chính | Dependency | Output kỳ vọng |
|---|---|---|---|---|---|
| [01-smc-standalone-entrypoint](01-smc-standalone-entrypoint/task.md) | Tạo `src/charts/smc-index.ts` — main() độc lập cho SMC, đúng cache/window theo M15, gọi `runCheckPendingOrders()` thật | worker | `src/charts/smc-index.ts` (mới), `src/shared/telegram.ts` (sửa nhỏ title heartbeat nếu cần) | none | Entrypoint SMC hoạt động độc lập, không còn nhánh rẽ Bob Volman nào |
| [02-smc-workflow-cron](02-smc-workflow-cron/task.md) | Thêm npm script, viết lại `analyze-smc.yml`: xoá Playwright, đổi cron cho M15, dùng entrypoint mới | worker | `package.json`, `.github/workflows/analyze-smc.yml` | 01 | CI SMC chạy đúng script mới, không cài Playwright, cron phù hợp M15 |
| [03-smc-entrypoint-tests](03-smc-entrypoint-tests/task.md) | Viết test cho `smc-index.ts`, theo mẫu `tests/charts/index.test.ts` | worker | `tests/charts/smc-index.test.ts` (mới) | 02 | Test cover cache key/window dùng M15, không có nhánh Bob Volman, pending order check được gọi thật |

## Rủi ro & lưu ý

- **Cadence M15 và rate limit TwelveData**: mặc định `TWELVEDATA_RATE_LIMIT_RPM=7` (free plan). Mỗi lần chạy SMC cần tối đa ~4 lệnh gọi OHLC/cặp (M15 + H4 HTF + H1/M30 confluence khi có signal) × 8 cặp ≈ tối đa 32 lệnh gọi — với rate limit 7/phút, mất khoảng 4-5 phút để hoàn thành 1 lượt (do có cơ chế `withConfiguredRateLimit` tự xếp hàng, không lỗi, chỉ chậm). Khuyến nghị cron **15 phút/lần** (đủ margin trước lượt kế tiếp), nhưng task 02 cần ghi rõ đây là điểm cần theo dõi thực tế sau khi deploy, có thể điều chỉnh lên 20-30 phút nếu thấy chạy chưa kịp.
- Sau khi cả 3 subtask xong, Lead sẽ đọc lại toàn bộ `smc-index.ts` so với `index.ts` để xác nhận không còn phụ thuộc lẫn nhau, và xác nhận workflow YAML mới không còn bước Playwright nào.
- Không tự động xoá `analyze-smc.yml` cũ trong quá trình sửa — chỉnh sửa tại chỗ (không tạo file mới `analyze-smc-v2.yml`), vì đây vẫn là cùng 1 workflow logic, chỉ đổi nội dung bên trong.
