# Review findings — Phase 10: Mở rộng tính năng

Review của các thay đổi liên quan tới [docs/tasks/10-feature-expansion.md](10-feature-expansion.md).

## Đã verify OK
- **Đa khung thời gian**: [charts.config.ts](../../src/charts/charts.config.ts) sinh 3 timeframe (D1/H4/M15) × 9 cặp = 27 chart config, mỗi combo có `interval` TradingView đúng (`D`, `240`, `15`). `hide_volume` đổi từ `true` → `false` để model đọc được volume trên chart — đúng cách tiếp cận hợp lý cho vision-based analyzer (không cần tính chỉ báo volume riêng).
- **Confluence logic**: `analyzer.ts` gửi cả 3 timeframe của mỗi cặp trong **1 lần gọi model duy nhất** (không tăng số request/RPM), label rõ `[PAIR=...; TIMEFRAME=...]` cho từng ảnh. Sau khi nhận response, lọc `setups` chỉ giữ những cặp có đủ **cả 3 timeframe** trong `availableTimeframes` map — đúng yêu cầu "chỉ phát tín hiệu khi nhiều khung thời gian đồng thuận".
- **`findChartForPair`**: mở rộng đúng cách để nhận `preferredTimeframe` (mặc định H4), có fallback hợp lý (ưu tiên preferred → H4 → timeframe nào có sẵn theo thứ tự D1 > H4 > M15). Dùng đúng ở `check-open-trades-runner.ts` (`"H4"`) và `confirmHighConfidenceSetups` (`"H4"`) — vị trí đánh giá vẫn dựa trên H4 như trước, hợp lý vì đây là bước xác nhận setup đã chọn, không cần re-run đa khung thời gian.
- **Notifier interface**: [src/shared/notifier.ts](../../src/shared/notifier.ts) định nghĩa interface tối giản (`sendMessage`, `sendPhoto`), `telegram.ts` export `telegramNotifier` implement interface này và `sendAllAnalyses()` nhận `notifier` optional (mặc định Telegram) — đúng yêu cầu "thiết kế interface chung", không cần implement thêm channel khác theo task doc.
- `npm test` (13 files, 35 tests pass), `npx tsc --noEmit` sạch.

## Bug cần fix

### 1. BOM tái xuất hiện ở `check-open-trades-runner.ts`
**Mức độ: thấp, nhưng đã từng xảy ra nhiều lần ở Phase 02 và phải fix lặp lại.**

File [src/charts/check-open-trades-runner.ts](../../src/charts/check-open-trades-runner.ts) bị thêm BOM (`EF BB BF`) ở đầu file (`﻿import { captureVerificationChartScreenshot...`). Không gây lỗi chức năng ngay nhưng là diff noise không mong muốn, tái diễn đúng vấn đề đã fix ở Phase 02.
- [x] Strip 3 byte BOM ở đầu file.

### 2. Hai bộ định nghĩa type trùng tên, khác cấu trúc (`src/shared/types.ts` vs `src/charts/chart-types.ts`)
**Mức độ: trung bình — rủi ro drift, không phải lỗi hiện tại.**

Phase 10 tạo file mới [src/charts/chart-types.ts](../../src/charts/chart-types.ts) với `ChartConfig` có thêm field `timeframe`, và cập nhật `analyzer.ts`/`screenshot.ts`/`charts.config.ts`/`telegram.ts` import từ file mới này. Nhưng [src/shared/types.ts](../../src/shared/types.ts) (bản cũ, **không có** field `timeframe`) vẫn còn nguyên và vẫn được `position-decision.ts`, `position-engine.ts`, `positions-repository.ts` import.

Hiện tại **chưa gây lỗi type** vì TypeScript structural typing cho phép gán object có thêm field `timeframe` (từ `chart-types.ts`) vào biến khai kiểu thiếu field đó (từ `types.ts`) theo chiều gán biến — nhưng đây là 2 nguồn sự thật (source of truth) trùng tên `ChartConfig`/`ScreenshotResult`/`TradeSetup`/`PairSummary`/`AnalysisResult`, dễ gây nhầm lẫn và drift nếu sau này sửa 1 file quên sửa file kia.

**Cách fix:**
- [x] Xóa `src/shared/types.ts`, chuyển `position-decision.ts`, `position-engine.ts`, `positions-repository.ts` sang import từ `src/charts/chart-types.ts` — chỉ giữ 1 nguồn định nghĩa type duy nhất.
- [x] Chạy lại `npm test` và `npx tsc --noEmit` sau khi gộp, xác nhận pass. **(Verify lại: 13 files/35 tests pass, tsc sạch, grep xác nhận không còn nơi nào tham chiếu `shared/types` trong repo.)**

## Ghi chú (không phải bug, chỉ để ý)
- Số lượng chart cần chụp tăng từ 9 (chỉ H4) lên 27 (D1+H4+M15 × 9 cặp) — tăng gấp 3 thời gian chạy Playwright capture mỗi lần scan, và tăng token input gửi Gemini (27 ảnh/lần thay vì 9). Đây là hệ quả tất yếu của tính năng, không phải lỗi, nhưng nên theo dõi chi phí/thời gian chạy thực tế qua [Phase 08 - cost observability](08-cost-observability.md) sau khi deploy.
- File `check-open-trades-runner.ts` mất newline cuối file (`\ No newline at end of file`) — tiểu tiết style, không đáng sửa riêng.

## Việc cần làm cho codex
- [x] Strip BOM khỏi `check-open-trades-runner.ts`.
- [x] Gộp `src/shared/types.ts` vào `src/charts/chart-types.ts`, xóa file cũ, sửa lại import ở 3 file còn dùng file cũ.
- [x] Chạy `npm test` và `npx tsc --noEmit`, xác nhận pass.

## Kết luận
Cả 2 bug đã được fix đúng, gọn — chỉ đổi import path, không có side-effect nào khác. **Phase 10 hoàn tất, không còn việc gì cần giao lại cho codex.**
