# Task 10 — Rewire entrypoints, tách charts.config.ts, dọn dẹp file/bảng cũ

Đọc `tasks/smc-volman-full-separation/plan.md` và `tasks/smc-volman-full-separation/context.md` trước.

Phụ thuộc: TẤT CẢ subtask 01-09 phải xong (đã có `done.md` trong từng thư mục con) trước khi bắt đầu task này.

**Đây là subtask cuối cùng và rủi ro cao nhất — chỉ được thực hiện sau khi mọi subtask trước đã được Lead approve (`done.md` tồn tại ở mỗi thư mục con 01-09).** Nếu bất kỳ subtask nào chưa có `done.md`, ghi `blocked.md` và dừng lại, không tự đoán/tự làm thay.

**⚠️ Cập nhật sau Lead self-review 2026-07-10 — QUAN TRỌNG, đọc kỹ trước khi bắt đầu:** `git diff` cho thấy `src/charts/index.ts`, `src/charts/smc-index.ts`, `src/charts/positions-repository.ts` (bản GỐC, chưa xoá) đã có thay đổi dở dang — nghĩa là một phiên trước đã bắt đầu task này nhưng CHƯA XONG. Cụ thể đã thấy trong `index.ts`: đã đổi `validateTradeSetupForOpen` sang import từ `./position-engine-volman.js` và đổi `getConfiguredChartTradingSystem` sang hardcode `"bob-volman"`, NHƯNG vẫn còn `import type { AnalysisResult, TradeSetup } from "./chart-types.js";` (chưa đổi sang `chart-types-volman.js`) và `import { buildHeartbeatMessage, sendAllAnalyses, sendMessage, notifyError } from "../shared/telegram.js";` (chưa đổi sang `telegram-volman.js`/`telegram-client.js`) và `import { loadChartAnalysisCache, loadLatestChartAnalysisCache, saveChartAnalysisCache } from "./chart-cache-repository.js";` (chưa đổi sang `chart-cache-repository-volman.js`). **Bước đầu tiên của bạn PHẢI là chạy `git diff src/charts/index.ts src/charts/smc-index.ts src/charts/positions-repository.ts` để thấy chính xác phần nào đã rewire, phần nào chưa — rồi HOÀN THIỆN NỐT phần còn thiếu theo Bước 2/3 dưới đây, KHÔNG được revert phần đã làm dở và làm lại từ đầu.** Cũng đừng quên rewire `signal-assembly.ts` sang `./analyzer-volman.js` (xem task 02 Step 6b) như một phần của Bước 2.

## Files được phép sửa/tạo
- Tạo mới: `src/charts/volman-charts.config.ts`, `src/charts/smc-charts.config.ts`
- Sửa: `src/charts/index.ts` (rewire toàn bộ import sang bản `-volman`)
- Sửa: `src/charts/smc-index.ts` (rewire toàn bộ import sang bản `-smc`)
- Sửa: `package.json` nếu có script gọi trực tiếp `performance-report-runner.ts`/`chart-cache-repository.ts` (đổi sang script/entrypoint mới `-volman`/`-smc`) — kiểm tra `result.md` của task 08 để biết chi tiết.
- Sửa: `.github/workflows/analyze.yml`, `.github/workflows/analyze-smc.yml` nếu chúng gọi trực tiếp file/script bị đổi tên.
- Xoá: `src/charts/chart-types.ts`, `src/charts/position-engine.ts`, `src/charts/positions-repository.ts`, `src/charts/chart-cache-repository.ts`, `src/charts/chart-config-env.ts`, `src/charts/position-decision.ts`, `src/charts/check-open-trades-runner.ts`, `src/charts/check-pending-orders-runner.ts`, `src/charts/performance-tracking.ts`, `src/charts/performance-report-runner.ts`, `src/charts/charts.config.ts`, `src/shared/telegram.ts` — CHỈ SAU KHI xác nhận build pass với toàn bộ import đã rewire (bước cuối).
- Xoá các file test cũ tương ứng dưới `tests/charts/` và `tests/shared/` đã được thay thế bằng bản `-volman`/`-smc` ở các task trước.
- Tạo mới migration: `supabase/migrations/<timestamp>_drop_legacy_positions_tables.sql` (DROP `open_positions`, `pending_orders`, `chart_analysis_cache` — chỉ sau khi bước build/test cuối cùng pass).

## Bước 1 — Tách `charts.config.ts`

Tạo `src/charts/volman-charts.config.ts` và `src/charts/smc-charts.config.ts`, mỗi file copy y nguyên nội dung `charts.config.ts` hiện tại (danh sách `BASE_CHARTS`, `TIMEFRAME_CONFIGS`, hàm `chart`, `CHARTS`, `getChartsForTimeframeMode`, `buildChartHtml`). Đổi import type sang `./chart-types-common.js` (`ChartConfig`, `ChartTimeframe`) và `./volman-config-env.js`/`./smc-config-env.js` tương ứng cho type `ChartTimeframeMode`.

## Bước 2 — Rewire `src/charts/index.ts` (Volman entrypoint)

Đổi toàn bộ import trong `index.ts` sang bản Volman:
- `./positions-repository.js` → `./positions-repository-volman.js`
- `./check-open-trades-runner.js` → `./check-open-trades-runner-volman.js`
- `../shared/telegram.js` (`buildHeartbeatMessage`, `sendAllAnalyses`, `sendMessage`, `notifyError`) → `../shared/telegram-volman.js` cho hàm business logic (`buildHeartbeatMessage` → dùng bản volman, `sendAllAnalyses` → `sendAllAnalysesVolman`) + `../shared/telegram-client.js` cho `sendMessage`, `notifyError`.
- `./position-engine.js` → `./position-engine-volman.js`
- `./chart-config-env.js` → `./volman-config-env.js` (LƯU Ý: bỏ hẳn phần logic chọn `tradingSystem` — `index.ts` giờ LUÔN LÀ Volman, xoá toàn bộ tham số/branch `tradingSystem`/`getConfiguredChartTradingSystem`/nhánh `analyzeAllChartsSmc` khỏi file này, chỉ giữ nhánh `analyzeAllChartsDeterministic`).
- `./chart-types.js` → `./chart-types-volman.js`
- `./chart-cache.js` — giữ nguyên (không đổi, là helper kỹ thuật chung).
- `./chart-cache-repository.js` → `./chart-cache-repository-volman.js`
- `./deterministic-pipeline.js` — giữ nguyên (đã Volman-only).
- `./charts.config.js` → `./volman-charts.config.js`
- `./analyzer.js` (`buildChartAnalysisCacheKey`) — kiểm tra file này có logic riêng hệ không; nếu không, giữ nguyên import chung; nếu có, ghi rõ trong `result.md` và xử lý tương tự (tách nếu cần, KHÔNG bỏ qua).

Đơn giản hoá toàn bộ file: bỏ mọi tham số/type `tradingSystem` (không cần nữa vì file này chỉ còn 1 nhánh). Giữ nguyên toàn bộ luồng logic còn lại (cache key, close window, heartbeat, auto-track open position...).

## Bước 3 — Rewire `src/charts/smc-index.ts` (SMC entrypoint)

Tương tự bước 2 nhưng trỏ toàn bộ sang bản `-smc`: `positions-repository-smc.js`, `check-open-trades-runner-smc.js`, `telegram-smc.js` (`sendAllAnalysesSmc`) + `telegram-client.js`, `position-engine-smc.js`, `smc-config-env.js`, `chart-types-smc.js`, `chart-cache-repository-smc.js`, `smc-charts.config.js`. Giữ `./smc/smc-pipeline.js` nguyên (đã SMC-only).

## Bước 4 — Cập nhật script performance-report / workflows

Theo ghi chú ở `tasks/smc-volman-full-separation/08-split-performance-report/result.md`: tạo 2 script chạy riêng nếu cần (`performance-report-runner-volman.ts`/`-smc.ts` đã tồn tại từ task 08) và cập nhật `package.json`/workflow YAML nào đang gọi file cũ `performance-report-runner.ts` để trỏ đúng bản theo hệ tương ứng (Volman workflow gọi bản volman, SMC workflow gọi bản smc).

## Bước 5 — Build + Test TRƯỚC KHI xoá file cũ

Chạy `npm run build && npm run test`. PHẢI PASS 100% trước khi sang bước 6. Nếu fail, sửa lỗi import (không xoá file cũ) và chạy lại.

## Bước 6 — Xoá file cũ + test cũ

Sau khi bước 5 pass, xoá toàn bộ danh sách file cũ liệt kê ở "Files được phép sửa/tạo" phần Xoá, và các test file cũ tương ứng đã có bản thay thế. Chạy lại `npm run build && npm run test` để xác nhận không còn tham chiếu nào tới file đã xoá.

## Bước 7 — Migration dọn bảng cũ

Chỉ sau khi bước 6 pass, viết migration mới `DROP TABLE IF EXISTS open_positions, pending_orders, chart_analysis_cache;` — ghi rõ trong `result.md` đây là bước phá huỷ dữ liệu không thể hoàn tác, và migration này CHỈ được áp dụng vào production sau khi xác nhận thủ công dữ liệu đã migrate đầy đủ ở task 01 (đối chiếu lại số liệu).

## Ngoài phạm vi (KHÔNG làm)
- Không thêm Binance provider.
- Không đổi format tin nhắn Telegram hay logic nghiệp vụ nào ngoài việc rewire import.

## Verification
```bash
npm run build
npm run test
```
Ghi đầy đủ output, danh sách file đã xoá, danh sách file đã sửa, vào `tasks/smc-volman-full-separation/10-rewire-entrypoints-and-cleanup/result.md`. Nếu bị chặn ở bất kỳ bước nào, ghi `blocked.md` với vị trí chính xác bị kẹt, không tự ý bỏ qua bước 5/6/7.
