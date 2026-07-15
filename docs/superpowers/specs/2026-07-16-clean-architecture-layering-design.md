# Tái cấu trúc theo Clean Architecture layer — Design Spec

Ngày: 2026-07-16

## Mục tiêu

Chuẩn hóa toàn bộ codebase (`betting/`, `charts/`, `lottery/`, `shared/`) theo cùng 1 bộ layer
5 tầng để dễ maintain. Hiện tại `betting/` và `shared/` đã tách layer nhưng còn giữ shim
re-export dư thừa ở root; `charts/` (41 file + 9 setups) và `lottery/` (24 file) hoàn toàn phẳng,
chưa tách gì.

## Layer taxonomy (áp dụng cho mọi module)

| Layer | Vai trò | Không được chứa |
|---|---|---|
| `model/` | Types, interfaces, config schema thuần | Logic, I/O |
| `client/` | Wrapper gọi hệ thống ngoài (API, browser, scraper) | Business logic, DB access |
| `repository/` | Truy cập Supabase/DB | Business logic |
| `service/` | Business logic thuần (tính toán, quyết định, backtest) | I/O trực tiếp (đi qua client/repository) |
| `controller/` | Entry point / orchestration (`index.ts`, `*-runner.ts`) | Business logic chi tiết |

Import đi thẳng vào file trong layer đích — **không tạo shim re-export**. Đây là điểm khác biệt
so với `betting/`/`shared/` hiện tại (đang có 2 lớp: file thật trong layer + shim ở root).

## Phạm vi: 4 module

### 1. Dọn `betting/` — xóa shim

Xóa 14 file root re-export (`betting.ts`, `betting-analysis-repository.ts`, `betting-api.ts`,
`betting-backtest.ts`, `betting-backtest-runner.ts`, `betting-gemini.ts`, `betting-index.ts`,
`betting-types.ts`, `correct-score-api.ts`, `fetch-matches-list-index.ts`, `match-repository.ts`,
`odds-compact.ts`, `odds-runner.ts`, `odds-text-format.ts`). Layer thật (`application/`, `client/`,
`controller/`, `model/`, `repository/`, `service/`) giữ nguyên.

Note: `application/odds-application.ts` là controller thực chất (orchestration) — đổi sang
`controller/odds-application.ts` để nhất quán 5-layer taxonomy, xóa thư mục `application/`.

Sửa mọi import trỏ vào shim → trỏ thẳng layer thật. `tests/betting/service/betting-backtest-service.test.ts`
đang import qua shim `betting-backtest.ts` → sửa sang `service/betting-backtest-service.js`.

### 2. Dọn `shared/` — xóa shim

Xóa shim root: `db.ts`, `env.ts`, `logger.ts`, `fetch-diagnostics.ts`, `rate-limit.ts`,
`telegram-client.ts`. Giữ file thật ở `infra/` (db, env, fetch-diagnostics, logger, rate-limit,
retry) và `notification/` (telegram-client). File không có shim (`ai-env.ts`, `ai-model-fallback.ts`,
`ai-usage.ts`, `notifier.ts`, `openrouter.ts`, `stats.ts`, `vn-time.ts`, ...) giữ nguyên vị trí —
đây là các util/service chung, không thuộc 1 trong 5 layer theo module cụ thể.

Sửa mọi import trong toàn repo trỏ `shared/db.js` → `shared/infra/db.js` (và tương tự).

### 3. Tách layer cho `charts/`

**model/**: `chart-types-common.ts`, `chart-types-volman.ts`, `setup-types.ts`,
`volman-config-env.ts`, `binance-futures-config-env.ts`

**client/**: `binance-futures-client.ts`, `ohlc-provider.ts`, `setup-chart-renderer.ts`

**repository/**: `chart-cache-repository-volman.ts`, `chart-symbols-repository-volman.ts`,
`ohlc-cache-repository.ts`, `positions-repository-volman.ts`,
`positions-repository-binance-entry-order-shared.ts`, `scanner-health-repository-volman.ts`

**service/**: `analyzer-common.ts`, `analyzer-volman.ts`, `binance-execution-shared.ts`,
`binance-execution-volman.ts`, `binance-position-sizing.ts`, `candle-range-stats.ts`,
`chart-cache.ts`, `deterministic-pipeline.ts`, `forex-backtest.ts`, `indicators.ts`,
`performance-tracking-volman.ts`, `position-decision-volman.ts`, `position-ema-exit.ts`,
`position-engine-volman.ts`, `setup-backtest.ts`, `setup-resolver.ts`, `signal-assembly.ts`,
`signal-freshness.ts`, `volman-charts.config.ts`

**service/setups/**: toàn bộ `setups/` hiện tại (`arb.ts`, `bb.ts`, `compression-params.ts`,
`ddb.ts`, `fb.ts`, `irb.ts`, `rb.ts`, `sb.ts`, `shared.ts`) di chuyển nguyên vào
`service/setups/`.

**controller/**: `index.ts`, `check-open-trades-runner-volman.ts`,
`check-pending-orders-runner-volman.ts`, `forex-backtest-runner.ts`,
`performance-report-runner-volman.ts`, `setup-backtest-runner.ts`,
`setup-backtest-compare-runner.ts`, `setup-sb-runner.ts`

### 4. Tách layer cho `lottery/`

**model/**: `lottery-types.ts`

**client/**: `lottery-scraper.ts`

**repository/**: `lottery-draw-status-repository.ts`, `lottery-predictions-repository.ts`,
`lottery-repository.ts`

**service/**: `lottery-ai-predict.ts`, `lottery-backtest.ts`, `lottery-ensemble-predict.ts`,
`lottery-format.ts`, `lottery-hit-rate-report.ts`, `lottery-regression-predict.ts`,
`lottery-schedule.ts`, `lottery-stats-predict.ts`

**controller/**: `lottery-backfill-index.ts`, `lottery-backfill-runner.ts`,
`lottery-backtest-index.ts`, `lottery-hit-rate-report-index.ts`, `lottery-index.ts`,
`lottery-predict-index.ts`, `lottery-predict-resync-index.ts`, `lottery-predict-runner.ts`,
`lottery-runner.ts`, `lottery-verify-index.ts`, `lottery-verify-runner.ts`

### Tests

Giữ nguyên vị trí file test hiện tại (`tests/betting/*`, `tests/charts/*`, `tests/lottery/*`,
`tests/shared/*`) — không move theo layer. Nhiều test file không match 1:1 tên với src file sau
khi tách layer (v.d. `tests/charts/position-decision.test.ts` test cho
`src/charts/service/position-decision-volman.ts`), nên move thêm sẽ tốn công phân loại thủ công
mà không đổi hành vi. Chỉ sửa `vi.mock(...)` path và import path trỏ tới vị trí mới của file
nguồn trong `src/`.

### `src/scripts/`

Giữ nguyên vị trí — đây là các script tiện ích cross-module (seed data, verify testnet, setup
Telegram menu), không thuộc riêng 1 module để tách layer. Chỉ sửa import path nếu chúng trỏ vào
file đã bị move.

## Không đổi

- `package.json` script paths — đã trỏ đúng `controller/` (`match-odds`), các script còn lại
  (`lottery`, `lottery-backfill`, ...) trỏ vào file `*-index.ts` sẽ move sang `controller/` — cần
  cập nhật path trong `package.json` cho các script lottery.
- `.github/workflows/*.yml` — cần rà lại nếu có hardcode path tsx script (lottery/betting).
- Logic nghiệp vụ không đổi — đây thuần túy move + sửa import, không refactor logic.
- Không có `tsconfig` path alias cần cập nhật (xác nhận: chỉ dùng relative import).

## Thứ tự thực hiện & verify

Move theo từng module riêng biệt, build + test sau mỗi module (không move hết 1 lần):

1. Dọn shim `betting/` + `shared/`
2. Tách layer `charts/` (khối lớn nhất, rủi ro cao nhất)
3. Tách layer `lottery/`
4. Rà lại `package.json` + `.github/workflows/*.yml` path
5. Full `npm run build && npm run test` cuối cùng

## Rủi ro

- Sai sót import khi move hàng loạt (100+ file) — giảm bằng build/test sau từng module.
- Workflow CI (`.github/workflows/*.yml`) hardcode path script — cần rà thủ công, không có test
  tự động cho path này.
