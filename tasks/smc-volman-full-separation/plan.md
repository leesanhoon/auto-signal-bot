# Plan — Tách hoàn toàn SMC và Bob Volman thành 2 flow độc lập

**Task ID:** `smc-volman-full-separation`
**Ngày:** 2026-07-10 · **Lead:** Sonnet 5
**Liên quan:** `reviews/2026-07-10-smc-volman-system-review/review-summary.md`, `tasks/smc-volman-review-fixes/` (đã thêm cột `system` — sẽ bị thay thế bởi tách bảng ở plan này)

**Parallelizable:** không hoàn toàn — có thứ tự bắt buộc (DB trước, entrypoint rewire cuối). Xem cột "Dependencies" trong bảng Subtasks.

---

## 1. Bản đồ hiện trạng — những gì đang dùng chung

Đã scan toàn bộ `src/charts/`, `src/shared/telegram.ts`, migrations, và `docs/volman-numeric-engine.md`. Kết quả:

| Module | Dùng chung bởi | Vai trò | Phân loại |
|---|---|---|---|
| `src/charts/ohlc-provider.ts` + `src/charts/ohlc-cache-repository.ts` | cả 2 (qua `screenshot.ts`) | Fetch/cache nến từ TwelveData | **Data provider — giữ chung (hợp lệ theo yêu cầu user)** |
| `src/charts/chart-types.ts` | cả 2 | Định nghĩa `TradeSetup`, `PairSummary`, `PendingOrder`, `ChartTimeframe`... — `TradeSetup` đã bị nhồi cả field Volman (`emaTouch`, `entryCondition`) lẫn field SMC (`grade`, `score`, `liquidityTargets`...) vào 1 type | **`TradeSetup`/`PairSummary` khác nhau giữa 2 hệ → phải tách per-system (`chart-types-volman.ts`/`chart-types-smc.ts`). `PendingOrder`/`PendingOrderStatus`/`ChartTimeframe`/`CandleRangeStats` có field giống hệt nhau ở cả 2 hệ → quyết định cuối (2026-07-10, sau khi Worker thực thi subtask 02): giữ chung trong `chart-types-common.ts` thay vì duplicate 2 bản giống hệt nhau. Đây là điều chỉnh so với dự kiến ban đầu trong plan, đã verify không có nghiệp vụ khác biệt giữa 2 hệ cho các type này.** |
| `src/charts/positions-repository.ts` | cả 2 (đã có cột `system` từ fix trước) | CRUD `open_positions`/`pending_orders`, dedup logic | **Business logic — phải tách bảng + module** |
| `src/charts/position-engine.ts` | cả 2 | Risk/reward plan, R:R validate, quản lý TP1/trailing, `deriveSignalSystem` | **Business logic — phải tách** |
| `src/charts/position-decision.ts` | cả 2 (qua check-runner) | Quyết định HOLD/CLOSE/STOP dựa trên OHLC | **Business logic — phải tách** |
| `src/charts/chart-cache-repository.ts` | cả 2 | Cache kết quả phân tích (`chart_analysis_cache`, phân biệt bằng suffix `:smc`/`:deterministic` trong `candle_key`) | **Business logic (schema-aware cache của setup) — phải tách bảng + module** |
| `src/charts/chart-config-env.ts` | cả 2 | Đọc toàn bộ ENV cấu hình (ngưỡng confidence, R:R min, TP1%, `CHART_TRADING_SYSTEM`...) trong 1 file dùng chung | **Business logic (ngưỡng nghiệp vụ khác nhau giữa 2 hệ) — phải tách** |
| `src/charts/check-open-trades-runner.ts` | cả 2 (gọi từ `index.ts` và `smc-index.ts`, **không filter theo system** — bug: SMC run sẽ check cả vị thế Volman và ngược lại) | Vòng lặp check open positions, gửi Telegram | **Business logic — phải tách** |
| `src/charts/check-pending-orders-runner.ts` | cả 2 (hiện bị comment-out ở cả 2 entrypoint — signals-only mode) | Vòng lặp check pending orders | **Business logic — phải tách (dù đang disabled, giữ song song cấu trúc)** |
| `src/charts/performance-tracking.ts` + `performance-report-runner.ts` | cả 2 (1 report gộp cả 2 hệ, không tách được win-rate) | Tính R:R thực nhận, win/loss, weekly/monthly report | **Business logic — phải tách, mỗi hệ 1 report riêng** |
| `src/shared/telegram.ts` | cả 2 | (a) `sendMessage`/`sendPhoto`/`sendDocument` (gọi Telegram Bot API thô) — **hạ tầng, hợp lệ giữ chung**; (b) `buildSmcSignalMessage`, `buildPositionDecisionMessage`, `buildPerformanceReportMessage`, `sendAllAnalyses` (format nghiệp vụ, branch theo `detectionSource`/`systemLabel`) — **business logic, phải tách** | **Hỗn hợp — phải bóc tách rõ 2 lớp** |
| `src/charts/charts.config.ts` | cả 2 (`getPairs()` gọi trong cả `index.ts` và `smc-index.ts`) | Danh sách pair/symbol để quét | **Cấu hình nghiệp vụ (mỗi hệ có thể muốn danh sách pair khác nhau trong tương lai) — tách để độc lập tiến hoá** |
| `src/charts/index.ts` (Volman entrypoint) / `src/charts/smc-index.ts` (SMC entrypoint) | không dùng chung nhau, nhưng cả 2 cùng import các module ở trên | Orchestration | Giữ 2 file riêng như hiện tại, chỉ đổi import sang bản tách |
| `src/charts/screenshot.ts` (`findChartForPair`, `fetchCandleRangeStats`) | cả 2 | Helper tra symbol theo pair + gọi `ohlc-provider` lấy stats | **Chủ yếu là data-fetch orchestration mỏng — giữ chung được vì không chứa ngưỡng/logic nghiệp vụ, chỉ wrap OHLC. Note: cần audit lại khi thực thi (xem Subtask 02)** |
| `supabase/migrations/*positions_add_system_column.sql` | — | Cột `system` dùng để dedup tạm | Sẽ bị **thay thế** bằng tách bảng thật (xem Subtask 01) |
| `docs/volman-numeric-engine.md:26` | — | Sơ đồ ghi "OHLC Provider (MetaApi, H4)" | **Chỉ là doc cũ, code thực tế không còn dùng MetaApi (đã xác nhận grep toàn repo — chỉ có trong `.env.example`, test, và doc này). Cần sửa doc, không có code MetaApi thật để xoá.** |

### Ranh giới "shared data provider" hợp lệ

Được phép dùng chung (không đổi):
- `src/charts/ohlc-provider.ts`, `src/charts/ohlc-cache-repository.ts` — nguồn giá thô (TwelveData hiện tại, Binance tương lai sẽ thêm ở đây dưới dạng provider mới cùng interface `Candle`).
- Hạ tầng nền tảng không đặc thù nghiệp vụ: `src/shared/db.ts`, `src/shared/logger.ts`, `src/shared/retry.ts`, `src/shared/rate-limit.ts`, `src/shared/fetch-diagnostics.ts`, `src/shared/env.ts`.
- Lớp gọi Telegram Bot API thô (`sendMessage`/`sendPhoto`/`sendDocument`/`notifyError` core, không chứa format nghiệp vụ) — tách thành `src/shared/telegram-client.ts`.

Phải tách đôi (không còn function/table dùng chung):
- Toàn bộ những gì có business logic ở bảng trên: `chart-types.ts` (tách theo domain), `positions-repository.ts`, `position-engine.ts`, `position-decision.ts`, `chart-cache-repository.ts`, `chart-config-env.ts`, `check-open-trades-runner.ts`, `check-pending-orders-runner.ts`, `performance-tracking.ts`, `performance-report-runner.ts`, format-message trong `telegram.ts`, `charts.config.ts`.
- DB: `open_positions`/`pending_orders`/`chart_analysis_cache` tách thành 2 cặp bảng riêng theo hệ (`_volman` / `_smc`).

---

## 2. Kiến trúc target

```
                         ┌───────────────────────────────┐
                         │   Shared Data Provider Layer   │
                         │  ohlc-provider.ts (TwelveData,  │
                         │  Binance sau này)                │
                         │  ohlc-cache-repository.ts        │
                         │  shared/db.ts, logger.ts, retry.ts│
                         │  shared/telegram-client.ts (API  │
                         │  thô: sendMessage/sendPhoto)      │
                         └───────────────┬─────────────────┘
                     ┌───────────────────┴───────────────────┐
                     ▼                                       ▼
      ┌───────────────────────────┐            ┌───────────────────────────┐
      │  FLOW: Bob Volman         │            │  FLOW: SMC                │
      │  chart-types-volman.ts    │            │  chart-types-smc.ts       │
      │  volman-charts.config.ts  │            │  smc-charts.config.ts     │
      │  volman-config-env.ts     │            │  smc-config-env.ts       │
      │  position-engine-volman   │            │  position-engine-smc     │
      │  positions-repository-    │            │  positions-repository-   │
      │    volman (DB: open_      │            │    smc (DB: open_        │
      │    positions_volman,      │            │    positions_smc,        │
      │    pending_orders_volman) │            │    pending_orders_smc)   │
      │  chart-cache-repository-  │            │  chart-cache-repository-  │
      │    volman (DB: analysis_  │            │    smc (DB: analysis_    │
      │    cache_volman)          │            │    cache_smc)            │
      │  position-decision-       │            │  position-decision-      │
      │    volman.ts              │            │    smc.ts                │
      │  check-open-trades-       │            │  check-open-trades-      │
      │    runner-volman.ts       │            │    runner-smc.ts         │
      │  check-pending-orders-    │            │  check-pending-orders-   │
      │    runner-volman.ts       │            │    runner-smc.ts         │
      │  performance-tracking-    │            │  performance-tracking-  │
      │    volman.ts +            │            │    smc.ts +              │
      │    performance-report-    │            │    performance-report-  │
      │    runner-volman.ts       │            │    runner-smc.ts         │
      │  telegram-volman.ts       │            │  telegram-smc.ts         │
      │    (buildPositionDecision │            │    (buildSmcSignal      │
      │    Message, sendAll      │            │    Message, sendAll     │
      │    AnalysesVolman...)     │            │    AnalysesSmc...)      │
      │  deterministic-pipeline.ts│            │  smc/smc-pipeline.ts     │
      │  setups/*.ts              │            │  smc/*.ts                │
      │  index.ts (entrypoint)    │            │  smc-index.ts (entrypoint)│
      └───────────────────────────┘            └───────────────────────────┘
```

### Quyết định kiến trúc chính

1. **DB: tách bảng thật, không dùng cột `system` nữa.** Tạo `open_positions_volman`, `pending_orders_volman`, `analysis_cache_volman`, `open_positions_smc`, `pending_orders_smc`, `analysis_cache_smc`. Migrate dữ liệu từ bảng cũ theo giá trị cột `system` hiện có (đã default `'volman'` từ fix trước). **KHÔNG drop bảng cũ ở migration này** — chỉ drop ở migration dọn dẹp riêng, sau khi task 10 rewire xong và deploy (xem R2). *(Cập nhật sau self-review: migration này đã được tạo sẵn ở `supabase/migrations/20260710180000_split_positions_and_cache_tables.sql`, đã đúng hướng này — task 01 giờ là verify, không phải tạo mới.)*
2. **`chart-types.ts` tách theo domain**, giữ 1 file `chart-types-common.ts` chỉ chứa type/field không mang nghiệp vụ đặc thù (`ChartTimeframe`, `ChartConfig`, `ChartOrderType`, `CandleRangeStats`, `ScreenshotResult`) — vì đây là hợp đồng giao tiếp với data-provider layer, không phải nghiệp vụ. `TradeSetup`/`PairSummary`/`PendingOrder`/`AnalysisResult` tách thành 2 bản riêng biệt (`chart-types-volman.ts`, `chart-types-smc.ts`), mỗi bản chỉ có field hệ đó cần.
3. **`telegram.ts` tách 2 lớp**: `shared/telegram-client.ts` (API thô: HTTP call Telegram Bot API, không có business logic format) + `shared/telegram-volman.ts` + `shared/telegram-smc.ts` (toàn bộ hàm `build*Message`, `sendAllAnalyses*`).
4. **`charts.config.ts` tách thành 2 file** `volman-charts.config.ts` / `smc-charts.config.ts` — cho phép mỗi hệ tự chọn danh sách pair mà không sợ đổi 1 bên ảnh hưởng bên kia. Nội dung ban đầu giống hệt nhau (copy), không đổi hành vi hiện tại.
5. **`chart-config-env.ts` tách theo hệ**: bỏ hẳn `getConfiguredChartTradingSystem()`/`ChartTradingSystem` vì không còn cần chọn hệ tại runtime — `index.ts` luôn là Volman, `smc-index.ts` luôn là SMC. Mỗi file env-config đọc đúng biến môi trường của hệ đó (SMC giữ `SMC_MIN_SIGNAL_CONFIDENCE`, `SMC_SIGNAL_FRESHNESS_CANDLES`; Volman giữ `POSITION_MIN_RISK_REWARD_RATIO*`, `CHART_SIGNAL_CONFIDENCE_THRESHOLD` bản riêng).
6. **OHLC provider giữ nguyên 100% dùng chung** — đúng ranh giới user cho phép. Không đổi `ohlc-provider.ts`/`ohlc-cache-repository.ts`. Việc thêm Binance là việc tương lai, plan này chỉ đảm bảo ranh giới đúng, không implement Binance.
7. **MetaApi**: không có code MetaApi thật nào trong repo (chỉ referenced ở `.env.example`, 1 test, và 1 dòng doc cũ). Task chỉ cần sửa `docs/volman-numeric-engine.md` cho đúng thực tế (TwelveData), không cần xoá code.
8. **Test mirror**: mọi file mới phải có test tương ứng dưới `tests/charts/` theo đúng tên file mới; xoá/migrate test cũ đang test chung cả 2 hệ trong cùng 1 file.

### Rủi ro & migration

- **R1 — Mất dữ liệu khi tách bảng:** migration phải là `INSERT INTO ... SELECT ... WHERE system = 'volman'/'smc'` rồi mới `DROP TABLE` bảng cũ, thực hiện trong 1 transaction hoặc 2 bước tách rời có thể rollback (chi tiết ở task 01). Không được xoá bảng cũ trước khi xác nhận count khớp.
- **R2 — Downtime giữa lúc deploy migration và deploy code mới:** vì entrypoint cũ (`index.ts`/`smc-index.ts` hiện tại) còn trỏ vào bảng cũ cho tới khi task 09 (rewire entrypoint) merge xong. Task 01 phải giữ bảng cũ tồn tại song song (không drop ngay) cho tới khi task 09 hoàn tất và được deploy, tránh runtime hiện tại (đang chạy production cron) ghi vào bảng đã xoá. Task 09 cần một bước dọn dẹp riêng (drop bảng cũ) làm subtask cuối cùng, tách khỏi migration ban đầu.
- **R3 — `analysisStats`/report tổng hợp cả 2 hệ**: sau khi tách, không còn 1 lệnh xem tổng cả 2 hệ cùng lúc (chấp nhận được — đúng yêu cầu tách biệt hoàn toàn của user; nếu cần dashboard tổng, đó là việc khác ngoài scope).
- **R4 — Test hiện tại (`tests/charts/positions-repository.test.ts`, `position-engine.test.ts`, v.v.) đang test cột `system`/dedup chung** — cần viết lại theo bảng mới, không patch chồng lên logic cũ.
- **R5 — Effort lớn, dễ lỗi import path**: vì hầu hết mọi file trong `src/charts/` đều bị đổi tên/tách, cần build (`npm run build`) sau mỗi subtask để bắt lỗi import sớm, không dồn tới cuối.

---

## Subtasks

| ID | Mô tả | Files chính | Dependencies (đã sửa sau self-review) | Output |
|---|---|---|---|---|
| `01-db-split-tables` | Verify migration đã tồn tại (`20260710180000_split_positions_and_cache_tables.sql`), vá lỗi nếu có, chạy thật nếu có quyền DB. KHÔNG drop bảng cũ | `supabase/migrations/20260710180000_*.sql` | không | `01-db-split-tables/result.md` |
| `02-shared-data-layer-and-types` | Xác nhận + giữ nguyên `ohlc-provider.ts`/`ohlc-cache-repository.ts`; tách `chart-types.ts` → `chart-types-common.ts` + `chart-types-volman.ts` + `chart-types-smc.ts`; tách phần `TradeSetup`-dependent của `analyzer.ts` (`applyPriceSanityChecks`, `formatPrice`,...) sang `analyzer-volman.ts`, giữ phần thuần string (`buildChartAnalysisCacheKey`,...) ở `analyzer-common.ts`; sửa `docs/volman-numeric-engine.md` bỏ MetaApi | `src/charts/chart-types*.ts`, `src/charts/analyzer-common.ts`, `src/charts/analyzer-volman.ts`, `docs/volman-numeric-engine.md` | không | `02-shared-data-layer-and-types/result.md` |
| `03-split-config-env` | Tách `chart-config-env.ts` → `volman-config-env.ts` + `smc-config-env.ts`, bỏ `ChartTradingSystem`/`getConfiguredChartTradingSystem` | `src/charts/volman-config-env.ts`, `src/charts/smc-config-env.ts` | 02 | `03-split-config-env/result.md` |
| `04-split-position-engine` | Tách `position-engine.ts` → `position-engine-volman.ts` + `position-engine-smc.ts`, bỏ `deriveSignalSystem`/`SignalSystem` | 02 (KHÔNG cần 03 — `position-engine.ts` gốc không import `chart-config-env.ts`, tự đọc `process.env` trực tiếp) | `04-split-position-engine/result.md` |
| `05-split-positions-repository` | Tách `positions-repository.ts` → `positions-repository-volman.ts` (bảng `_volman`) + `positions-repository-smc.ts` (bảng `_smc`), bỏ filter `system` | 01, 03 (cần `getConfiguredPendingOrderExpiryRuns`), 04 | `05-split-positions-repository/result.md` |
| `06-split-chart-cache-repository` | Tách `chart-cache-repository.ts` → `chart-cache-repository-volman.ts` (bảng `analysis_cache_volman`) + `chart-cache-repository-smc.ts` (bảng `analysis_cache_smc`) | 01, 02, 03 (cần type `ChartEngineMode`/`ChartTimeframeMode` từ config-env) | `06-split-chart-cache-repository/result.md` |
| `07-split-position-decision-and-check-runners` | Tách `position-decision.ts` + `check-open-trades-runner.ts` + `check-pending-orders-runner.ts` mỗi thứ thành 2 bản | 04, 05 | `07-split-position-decision-and-check-runners/result.md` |
| `08-split-performance-report` | Tách `performance-tracking.ts` + `performance-report-runner.ts` thành 2 bản (đọc từ bảng `_volman`/`_smc` riêng) | 04 (type `PositionDecisionAction`), 05 (`loadClosedPositions`) | `08-split-performance-report/result.md` |
| `09-split-telegram-messaging` | Tách `shared/telegram.ts` → `shared/telegram-client.ts` (API thô) + `shared/telegram-volman.ts` + `shared/telegram-smc.ts` | 02 (chart-types), 03 (ngưỡng confidence), 08 (type `PerformanceReport` dùng trong `buildPerformanceReportMessage`) | `09-split-telegram-messaging/result.md` |
| `10-rewire-entrypoints-and-cleanup` | Tách `charts.config.ts` → `volman-charts.config.ts`/`smc-charts.config.ts`; hoàn thiện rewire `index.ts`/`smc-index.ts` (ĐANG DỞ DANG — xem ghi chú self-review phía trên) dùng toàn bộ module đã tách; cập nhật/di chuyển test mirror; sau khi build+test pass, thêm migration dọn dẹp DROP bảng cũ (`open_positions`, `pending_orders`, `chart_analysis_cache`) trong file migration riêng | tất cả (01-09) | `10-rewire-entrypoints-and-cleanup/result.md` |

Thứ tự bắt buộc: 01 → 02 → 03 → 04 → (05 và 06 có thể song song, cả 2 chỉ cần 01/02/03 + 04 cho 05) → 07 → 08 → 09 → 10.

Mỗi subtask PHẢI kết thúc bằng:
```bash
npm run build
npm run test
```
và ghi số liệu pass/fail thật vào `result.md`.
