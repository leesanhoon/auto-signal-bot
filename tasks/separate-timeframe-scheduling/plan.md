# Plan: Tách biệt hoạt động theo timeframe (M15 / H1 / H4) cho hệ Volman

## Mục tiêu

Cho phép chạy 3 scheduled task độc lập trên server (Windows Task Scheduler), mỗi task:
1. Chỉ quét tín hiệu Volman cho **đúng 1 timeframe** của nó (M15, hoặc H1, hoặc H4).
2. Khi kiểm tra vị thế đang mở (check open trades) và lệnh chờ (pending orders), **chỉ đụng vào các bản ghi thuộc đúng timeframe đó** — không kiểm tra/quản lý nhầm vị thế của timeframe khác.

## Hiện trạng (đã scan codebase)

- `CHART_PRIMARY_TIMEFRAME` (env, single-value) quyết định timeframe cho **toàn bộ** 1 lần chạy `npm run analyze` — đã hỗ trợ chạy riêng lẻ từng timeframe (M15/H4) qua override env, không cần sửa gì để "chạy 1 khung".
- **Gap chính**: bảng `open_positions_volman` (Supabase) **không có cột lưu timeframe**. `pending_orders_volman` thì ĐÃ có cột `primary_timeframe` (dùng khi tạo lệnh chờ), nhưng khi lệnh chờ khớp và chuyển thành vị thế mở (`open_positions_volman`), thông tin timeframe bị mất — không lưu.
- `loadOpenPositions()` ([positions-repository-volman.ts:226](../../src/charts/positions-repository-volman.ts:226)) load **tất cả** vị thế đang mở, không lọc theo timeframe.
- `runCheckOpenTrades()` ([check-open-trades-runner-volman.ts:77](../../src/charts/check-open-trades-runner-volman.ts:77)) không nhận tham số timeframe — gọi `loadOpenPositions()` không filter.
- `saveOpenPosition()` ([positions-repository-volman.ts:73](../../src/charts/positions-repository-volman.ts:73)) chặn trùng lặp chỉ theo `pair` (không theo timeframe) — tức hiện tại **1 pair chỉ được có 1 vị thế mở tại 1 thời điểm, bất kể timeframe nào phát tín hiệu**.
- **Ràng buộc thực tế từ sàn Binance**: tài khoản Futures One-way mode chỉ giữ được **1 net position duy nhất cho mỗi symbol**. Vì vậy dù có tách DB theo timeframe, **2 timeframe không thể nào cùng lúc có vị thế THẬT trên cùng 1 symbol trên Binance** — đây không phải giới hạn của code mà là giới hạn vật lý của sàn. Guard hiện tại (`existingPositionAmt !== 0` trong `binance-execution-shared.ts`) đã xử lý đúng việc này (bỏ qua entry nếu symbol đã có vị thế mở do hệ khác/timeframe khác), nhưng thông báo Telegram hiện tại ghi chung chung "có thể do hệ khác" — cần làm rõ hơn khi nguyên nhân là do khác timeframe.
- `ChartTimeframe` type ([chart-types-common.ts:7](../../src/charts/chart-types-common.ts:7)) đã có sẵn `"H1"`, nhưng `volman-charts.config.ts` (`TIMEFRAME_CONFIGS`) mới chỉ map interval cho D1/H4/M15 — **H1 chưa có mapping interval** để fetch OHLC (Binance `"1h"`, TradingView `"60"`).

## Quyết định đã chốt với user (2026-07-12)

- **Bob Volman là phương pháp single-timeframe** (không multi-timeframe confirmation) — 3 job
  M15/H1/H4 chạy như 3 hệ thống độc lập song song, đúng tinh thần gốc, không phải deviation.
- **Khi 2 khung cùng phát tín hiệu trên cùng 1 symbol**: giữ nguyên **One-way mode** hiện tại,
  KHÔNG chuyển Hedge Mode. Khung nào vào lệnh Binance trước thì giữ vị thế; khung đến sau bị guard
  chặn (đã có sẵn logic `existingPositionAmt !== 0` trong `binance-execution-shared.ts`) — chỉ
  cần cải thiện message Telegram cho rõ nguyên nhân (task 04). Không tách được 2 vị thế thật độc
  lập trên cùng symbol — đây là giới hạn cố ý chấp nhận, không phải bug.
- Việc tách theo timeframe trong `open_positions_volman` (task 01-02) vẫn cần thiết — không phải
  để cho phép 2 vị thế thật đồng thời, mà để **mỗi job chỉ check/quản lý đúng vị thế nó tạo ra**
  (M15 job không được đụng vào vị thế do H1/H4 tạo, kể cả khi khác symbol).
- Task 05 (deploy) sẽ dùng **hạ tầng Windows Task Scheduler đã có sẵn** tại
  `deploy/windows/` (`register-tasks.ps1` + `run-job.ps1`), KHÔNG tạo file `.bat` riêng như bản
  nháp đầu — xem lại task 05 đã cập nhật.

## Quyết định thiết kế

- Không đổi cách chạy hiện tại (`npm run analyze` + env `CHART_PRIMARY_TIMEFRAME`) — chỉ cần thêm timeframe vào luồng check-open-trades/pending-orders để mỗi lần chạy chỉ động vào đúng phạm vi của nó.
- Thêm cột `primary_timeframe` vào `open_positions_volman`, backfill dữ liệu cũ (2 vị thế hiện có) bằng giá trị suy ra từ context (cả 2 đều mở khi test M15 → set `M15`).
- `loadOpenPositions(timeframe)` và `runCheckOpenTrades(timeframe)` nhận tham số timeframe bắt buộc, lấy từ `CHART_PRIMARY_TIMEFRAME` hiện tại của lần chạy — **không tự ý mặc định "H4" nếu thiếu**, để tránh 1 task vô tình quét nhầm vị thế của khung khác.
- Giữ nguyên guard "1 symbol 1 vị thế thật trên Binance" (không thể thay đổi vì giới hạn sàn) — chỉ cải thiện message Telegram để phân biệt rõ "đã có vị thế mở bởi timeframe khác" khi phát hiện được.
- Thêm H1 vào toàn bộ danh sách timeframe hỗ trợ (config chart, backtest, ohlc-provider).

## Subtasks

| # | Subtask | File chính cần sửa | Phụ thuộc |
|---|---|---|---|
| 01 | Thêm cột `primary_timeframe` vào `open_positions_volman` (migration) + backfill 2 row hiện có | Supabase migration, `positions-repository-volman.ts` (types) | Không |
| 02 | Lọc `loadOpenPositions`/`runCheckOpenTrades`/`pollPendingEntryOrders` theo timeframe | `positions-repository-volman.ts`, `check-open-trades-runner-volman.ts`, `binance-execution-volman.ts` | 01 |
| 03 | Thêm hỗ trợ đầy đủ timeframe H1 (interval mapping, validate list) | `volman-charts.config.ts`, `ohlc-provider.ts`, `chart-types-common.ts` (nếu cần) | Không |
| 04 | Wiring `index.ts`: truyền timeframe hiện tại xuống check-open-trades + pending-orders; làm rõ message Telegram khi bị chặn do timeframe khác | `index.ts`, `binance-execution-shared.ts` | 02, 03 |
| 05 | Thêm 3 job Volman (M15/H1/H4) vào hạ tầng Task Scheduler có sẵn tại `deploy/windows/` | `deploy/windows/run-job.ps1`, `register-tasks.ps1`, `README.md` | 04 |
| 06 | Pre-position STOP order lên Binance TRƯỚC khi breakout (chỉ setup BB — RB/ARB/IRB cần OCO, ngoài scope) | `src/charts/setups/bb.ts` | Không |
| 07 | Swing trailing SL thật cho live sau khi TP1 khớp (thay vì khoá cứng breakeven) | `src/charts/binance-execution-shared.ts` | 01-02 (tránh conflict schema) |

## Bổ sung sau khi research thêm (2026-07-12, phần Entry/SL/TP)

- **Phát hiện quan trọng**: hạ tầng đặt lệnh STOP thật lên Binance và tự chờ khớp (không phải
  MARKET đuổi giá) **đã tồn tại sẵn** — cột `binance_entry_order_status` trong `open_positions_volman`
  + hàm `pollPendingEntryOrders` trong `binance-execution-shared.ts` đã chạy mỗi lần `npm run
  analyze` (log "Polling pending entry orders"). Vấn đề gốc chỉ là THỜI ĐIỂM phát tín hiệu trong
  detector (quá trễ, sau khi giá đã breakout) — không cần xây hệ thống mới, xem chi tiết Task 06.
- Có 1 hệ thống "pending order" KHÁC, cũ hơn (`pending_orders_volman` bảng + `savePendingOrder()` +
  `check-pending-orders-runner-volman.ts`, dùng `fetchCandleRangeStats` từ `screenshot.ts`) —
  **đây là tàn dư của pipeline AI-vision cũ, hiện KHÔNG được gọi ở đâu trong `index.ts` /
  `deterministic-pipeline.ts`** (dead code với hệ deterministic hiện tại). KHÔNG dùng hệ này cho
  Task 06/07 — dùng đúng hệ `binance_entry_order_status`/`pollPendingEntryOrders` đang thật sự
  chạy.
- BB pre-position được dễ vì hướng lệnh (LONG/SHORT) xác định từ trend, không phụ thuộc breakout.
  RB/ARB/IRB thì hướng lệnh chỉ biết được KHI breakout xảy ra (range có thể phá lên hoặc xuống) —
  muốn pre-position thật cho nhóm này cần đặt đồng thời 2 lệnh 2 hướng (OCO) rồi huỷ lệnh thua —
  đây là scope lớn hơn, CHƯA đưa vào Task 06, cần bàn riêng nếu user muốn mở rộng.

## Rủi ro / lưu ý cho Worker

- **Không được xoá/động vào 2 vị thế đang mở thật hiện tại** (TIA/USDT id=7, INJ/USDT id=8) khi migrate — chỉ backfill cột mới, không đổi trạng thái.
- Đây là hệ thống đang chạy live (dù trên testnet) — mọi thay đổi phải giữ nguyên hành vi hiện tại khi timeframe param không được truyền (tránh regression cho pipeline SMC dùng chung `binance-execution-shared.ts`).
- Chạy đầy đủ `npx tsc --noEmit` + `npx vitest run` sau mỗi subtask, không được để test đỏ.
- Không tự ý bật/tắt bất kỳ cờ live-trading nào (`BINANCE_LIVE_TRADING_ENABLED*`, `BINANCE_HONOR_ORDER_TYPE_VOLMAN`) — đây là quyết định của user, giữ nguyên trạng thái hiện tại trong `.env`.
