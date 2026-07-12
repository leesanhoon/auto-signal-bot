# Context: Separate Timeframe Scheduling

## Tóm tắt mục tiêu
Tách biệt hoạt động Volman theo timeframe (M15/H1/H4) để 3 scheduled task chạy độc lập mỗi task chỉ quản lý vị thế + pending orders của timeframe nó.

## Quyết định thiết kế quan trọng
- **Không thay đổi cách chạy hiện tại** (`npm run analyze` + env `CHART_PRIMARY_TIMEFRAME`).
- **Giữ nguyên One-way mode** trên Binance (không chuyển Hedge Mode) — 1 symbol chỉ có 1 vị thế thật.
- **Schema change**: thêm cột `primary_timeframe` vào `open_positions_volman`, backfill 2 vị thế hiện có bằng "M15".
- **Timeframe param bắt buộc** trong `loadOpenPositions()`, `runCheckOpenTrades()`, `pollPendingEntryOrders()`.
- **H1 support đầy đủ** (interval mapping, config, validate list).

## Database & Schema
- `open_positions_volman` hiện tại: có columns id, pair, entry_price, entry_qty, entry_time, entry_type, status, system_type, v.v. — **KHÔNG có primary_timeframe**.
- `pending_orders_volman`: **ĐÃ có** `primary_timeframe` (được lưu khi tạo lệnh chờ).
- **2 vị thế live hiện tại**: TIA/USDT (id=7), INJ/USDT (id=8) — cả 2 đều mở khi test M15, nên backfill với M15.

## Timeframe Support hiện tại
- `ChartTimeframe` type: có "D1", "H4", "M15", "H1" (H1 có sẵn type).
- `TIMEFRAME_CONFIGS` trong `volman-charts.config.ts`: map M15, H4, D1 → interval Binance/TV — **H1 chưa có mapping**.
- `ohlc-provider.ts`: fetch OHLC dựa TIMEFRAME_CONFIGS — nếu timeframe không có mapping thì fail.

## Key Files to Modify
- `src/charts/positions-repository-volman.ts`: `loadOpenPositions()`, `saveOpenPosition()`, types
- `src/charts/check-open-trades-runner-volman.ts`: `runCheckOpenTrades()`
- `src/charts/binance-execution-volman.ts`: `pollPendingEntryOrders()`
- `src/charts/binance-execution-shared.ts`: entry guard + Telegram message
- `src/charts/index.ts`: wire timeframe param từ env vào các hàm
- `src/charts/volman-charts.config.ts`: H1 interval mapping
- `src/charts/ohlc-provider.ts`: H1 fallback
- `src/charts/setups/bb.ts`: pre-position STOP (task 06)
- `deploy/windows/`: Task Scheduler setup

## Tests & Validation
- Run `npx tsc --noEmit` để check TypeScript errors (strict mode).
- Run `npx vitest run` để chạy test suite.
- **Không để test đỏ sau mỗi subtask** — fix ngay nếu break.
- **Regression check**: pipeline SMC dùng chung `binance-execution-shared.ts`, đảm bảo không break khi timeframe param không được truyền.

## Important Caveats
- **KHÔNG xoá/thay đổi 2 vị thế live** (TIA id=7, INJ id=8) khi migrate — chỉ backfill cột mới, không động trạng thái.
- **KHÔNG thay đổi bất kỳ flag live-trading** (`.env`) — giữ nguyên trạng thái hiện tại.
- **KHÔNG tự ý default timeframe nếu param bị thiếu** — phải fail/error để tránh task vô tình quét nhầm timeframe khác.
- **Schema conflict**: Task 07 (trailing SL) phụ thuộc 01-02 schema changes, nên task 07 được schedule trước để không conflict khi check câu query + column existence cùng lúc.

## Commit Strategy
- Mỗi subtask nên là 1 commit — rõ ràng, có message tóm tắt action.
- Nếu subtask có migration + code change, commit riêng từng phần (migration trước, code sau) để dễ rollback nếu cần.
- Không auto-push — user sẽ quyết định merge + deploy.
