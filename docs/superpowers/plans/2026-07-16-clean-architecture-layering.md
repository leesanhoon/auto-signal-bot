# Clean Architecture Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách `charts/` và `lottery/` thành 5 layer (`model/client/repository/service/controller`) giống `betting/`, và xóa shim re-export dư thừa ở `betting/` + `shared/`, không đổi logic nghiệp vụ.

**Architecture:** Move file bằng `git mv` theo từng layer/module (không đổi nội dung file), sau đó chạy `npx tsc --noEmit` để compiler tự chỉ ra import path nào gãy, sửa từng import gãy bằng cách tính lại relative path đúng, lặp lại tới khi `tsc` sạch, rồi `npm run test`. Test files **giữ nguyên vị trí** — chỉ sửa import/`vi.mock` path.

**Tech Stack:** TypeScript (ESM, relative imports, `moduleResolution: bundler`), Vitest, tsx runner.

## Global Constraints

- Không đổi logic nghiệp vụ — chỉ move file + sửa import path.
- Import luôn trỏ thẳng vào file thật trong layer đích — không tạo shim re-export mới.
- Test files giữ nguyên vị trí (không move theo layer) — chỉ sửa `vi.mock(...)` path và import path.
- Sau mỗi task: `npx tsc --noEmit` phải sạch (0 lỗi) và `npm run test` phải pass trước khi commit.
- `.github/workflows/*.yml` chỉ gọi `npm run <script>` — không hardcode file path, không cần sửa.
- Không có `tsconfig.json` path alias — mọi import là relative, `rootDir: src`.
- **Baseline test count (trước khi bắt đầu plan):** `72 test files, 793 tests passed`. Sau mỗi
  task, `npm run test` phải giữ đúng `72 passed / 793 passed` — số lệch (tăng hoặc giảm) nghĩa
  là có sai sót cần điều tra trước khi commit.

---

## Cách sửa relative import sau khi move (áp dụng cho mọi task)

1. Chạy `git mv <old> <new>` cho toàn bộ file trong task.
2. Chạy `npx tsc --noEmit 2>&1 | head -100` — mỗi dòng lỗi dạng `src/foo/bar.ts(3,25): error TS2307: Cannot find module './baz.js'` cho biết chính xác file + dòng + import cũ bị gãy.
3. Với mỗi lỗi: mở file, tính relative path đúng từ vị trí file MỚI tới vị trí file đích MỚI (dùng Node path logic: `path.relative(dirname(fromFile), toFile)`, luôn giữ prefix `./` hoặc thêm nếu thiếu, giữ đuôi `.js`).
4. Sửa xong hết lỗi trong nhóm file vừa move, chạy lại `npx tsc --noEmit` tới khi output rỗng.
5. Chạy `npm run test` — sửa `vi.mock("...")` path trong file test bị fail theo cùng công thức relative path (từ vị trí test file tới vị trí src file mới).
6. Commit.

---

### Task 1: Xóa shim `betting/` — trỏ import thẳng vào layer thật

**Files:**
- Delete: `src/betting/betting.ts`, `src/betting/betting-analysis-repository.ts`, `src/betting/betting-api.ts`, `src/betting/betting-backtest.ts`, `src/betting/betting-backtest-runner.ts`, `src/betting/betting-gemini.ts`, `src/betting/betting-index.ts`, `src/betting/betting-types.ts`, `src/betting/correct-score-api.ts`, `src/betting/fetch-matches-list-index.ts`, `src/betting/match-repository.ts`, `src/betting/odds-compact.ts`, `src/betting/odds-runner.ts`, `src/betting/odds-text-format.ts`
- Move: `src/betting/application/odds-application.ts` → `src/betting/controller/odds-application.ts`
- Modify: `tests/betting/service/betting-backtest-service.test.ts` (import path), `tests/betting/application/odds-application.test.ts` → giữ vị trí, chỉ sửa import
- Test: chạy toàn bộ `tests/betting/*` hiện có, không tạo test mới

**Interfaces:**
- Không đổi export signature nào — chỉ đổi đường dẫn file vật lý.

- [ ] **Step 1: Xóa 14 file shim ở root `src/betting/`**

```bash
git rm src/betting/betting.ts src/betting/betting-analysis-repository.ts \
  src/betting/betting-api.ts src/betting/betting-backtest.ts \
  src/betting/betting-backtest-runner.ts src/betting/betting-gemini.ts \
  src/betting/betting-index.ts src/betting/betting-types.ts \
  src/betting/correct-score-api.ts src/betting/fetch-matches-list-index.ts \
  src/betting/match-repository.ts src/betting/odds-compact.ts \
  src/betting/odds-runner.ts src/betting/odds-text-format.ts
```

- [ ] **Step 2: Move `application/` → `controller/`**

```bash
git mv src/betting/application/odds-application.ts src/betting/controller/odds-application.ts
rmdir src/betting/application 2>/dev/null || true
```

- [ ] **Step 3: Tìm và sửa mọi import còn trỏ vào shim hoặc `application/`**

```bash
grep -rn "betting/betting\.js\|betting/betting-analysis-repository\.js\|betting/betting-api\.js\|betting/betting-backtest\.js\|betting/betting-backtest-runner\.js\|betting/betting-gemini\.js\|betting/betting-index\.js\|betting/betting-types\.js\|betting/correct-score-api\.js\|betting/fetch-matches-list-index\.js\|betting/match-repository\.js\|betting/odds-compact\.js\|betting/odds-runner\.js\|betting/odds-text-format\.js\|betting/application/" src tests --include=*.ts
```

Với mỗi match, sửa import trỏ thẳng vào file thật tương ứng, ví dụ:
- `"../betting-types.js"` → `"../model/betting-types.js"`
- `"../betting-api.js"` → `"../client/betting-api-client.js"`
- `"../application/odds-application.js"` → `"../controller/odds-application.js"`
- `"./betting.js"` → `"./service/betting-service.js"`
- `"./betting-backtest.js"` → `"./service/betting-backtest-service.js"`
- `"./correct-score-api.js"` → `"./service/correct-score-service.js"`
- `"./odds-compact.js"` → `"./service/odds-compact-service.js"`
- `"./odds-text-format.js"` → `"./service/odds-text-format-service.js"`
- `"./match-repository.js"` → `"./repository/match-repository.js"`
- `"./betting-analysis-repository.js"` → `"./repository/betting-analysis-repository.js"`
- `"./betting-gemini.js"` → `"./client/betting-ai-client.js"`

- [ ] **Step 4: Sửa `tests/betting/service/betting-backtest-service.test.ts`**

Đổi import từ shim `../../../src/betting/betting-backtest.js` sang
`../../../src/betting/service/betting-backtest-service.js`.

- [ ] **Step 5: Build + test**

```bash
npx tsc --noEmit
```
Expected: 0 lỗi.

```bash
npm run test
```
Expected: toàn bộ test pass, không giảm test count so với trước khi bắt đầu Task 1.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(betting): remove re-export shims, import layer files directly"
```

---

### Task 2: Xóa shim `shared/` — trỏ import thẳng vào `infra/`/`notification/`

**Files:**
- Delete: `src/shared/db.ts`, `src/shared/env.ts`, `src/shared/logger.ts`, `src/shared/fetch-diagnostics.ts`, `src/shared/rate-limit.ts`, `src/shared/telegram-client.ts`
- Modify: mọi file trong `src/` và `tests/` import các path trên (danh sách đầy đủ ở Step 2)

**Interfaces:**
- `src/shared/infra/db.ts` export `getDb`, `createSupabaseClient`, `SupabaseConfig` — không đổi.
- `src/shared/infra/env.ts`, `infra/logger.ts`, `infra/fetch-diagnostics.ts`, `infra/rate-limit.ts` — không đổi export.
- `src/shared/notification/telegram-client.ts` — không đổi export.

- [ ] **Step 1: Xóa 6 file shim**

```bash
git rm src/shared/db.ts src/shared/env.ts src/shared/logger.ts \
  src/shared/fetch-diagnostics.ts src/shared/rate-limit.ts src/shared/telegram-client.ts
```

- [ ] **Step 2: Tìm toàn bộ import còn trỏ shim**

```bash
grep -rlE "from [\"'](\.\./)*shared/(db|env|logger|fetch-diagnostics|rate-limit|telegram-client)\.js[\"']" src tests --include=*.ts
```

Danh sách file cần sửa (từ khảo sát hiện tại — xác nhận lại bằng lệnh grep trên vì có thể lệch nếu Task 1 đã đổi số file):
`src/betting/{application→controller}/odds-application.ts`, `src/betting/client/betting-ai-client.ts`,
`src/betting/client/betting-api-client.ts`, `src/betting/controller/betting-backtest-runner.ts`,
`src/betting/controller/betting-index.ts`, `src/betting/controller/fetch-matches-list-index.ts`,
`src/betting/service/betting-service.ts`, toàn bộ 30 file `src/charts/*.ts` liệt kê ở khảo sát,
toàn bộ 20 file `src/lottery/*.ts` liệt kê ở khảo sát, toàn bộ 6 file `src/scripts/*.ts`.

Với mỗi file, thay `shared/db.js` → `shared/infra/db.js`, `shared/env.js` → `shared/infra/env.js`,
`shared/logger.js` → `shared/infra/logger.js`, `shared/fetch-diagnostics.js` → `shared/infra/fetch-diagnostics.js`,
`shared/rate-limit.js` → `shared/infra/rate-limit.js`, `shared/telegram-client.js` → `shared/notification/telegram-client.js`
(giữ nguyên số lượng `../` phía trước — chỉ thêm `infra/` hoặc `notification/` vào giữa).

- [ ] **Step 3: Sửa `vi.mock(...)` path trong test files**

```bash
grep -rlE "vi\.mock\([\"'](\.\./)*(\.\./)*src/shared/(db|env|logger|fetch-diagnostics|rate-limit|telegram-client)\.js[\"']" tests --include=*.ts
```

Áp dụng cùng phép thay thế path như Step 2 (test file đã biết ở khảo sát:
`tests/charts/chart-cache-repository-volman.test.ts` — 2 chỗ `vi.mock`).

- [ ] **Step 4: Build + test**

```bash
npx tsc --noEmit
```
Expected: 0 lỗi.

```bash
npm run test
```
Expected: toàn bộ test pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(shared): remove re-export shims, import infra/notification files directly"
```

---

### Task 3: `charts/` — tạo layer `model/`, `client/`, `repository/`

**Files:**
- Create dirs: `src/charts/model/`, `src/charts/client/`, `src/charts/repository/`
- Move (model): `chart-types-common.ts`, `chart-types-volman.ts`, `setup-types.ts`, `volman-config-env.ts`, `binance-futures-config-env.ts`
- Move (client): `binance-futures-client.ts`, `ohlc-provider.ts`, `setup-chart-renderer.ts`
- Move (repository): `chart-cache-repository-volman.ts`, `chart-symbols-repository-volman.ts`, `ohlc-cache-repository.ts`, `positions-repository-volman.ts`, `positions-repository-binance-entry-order-shared.ts`, `scanner-health-repository-volman.ts`

**Interfaces:**
- Không đổi export nào. Chỉ đổi vị trí file vật lý trong `src/charts/`.

- [ ] **Step 1: Move model files**

```bash
git mv src/charts/chart-types-common.ts src/charts/model/chart-types-common.ts
git mv src/charts/chart-types-volman.ts src/charts/model/chart-types-volman.ts
git mv src/charts/setup-types.ts src/charts/model/setup-types.ts
git mv src/charts/volman-config-env.ts src/charts/model/volman-config-env.ts
git mv src/charts/binance-futures-config-env.ts src/charts/model/binance-futures-config-env.ts
```

- [ ] **Step 2: Move client files**

```bash
git mv src/charts/binance-futures-client.ts src/charts/client/binance-futures-client.ts
git mv src/charts/ohlc-provider.ts src/charts/client/ohlc-provider.ts
git mv src/charts/setup-chart-renderer.ts src/charts/client/setup-chart-renderer.ts
```

- [ ] **Step 3: Move repository files**

```bash
git mv src/charts/chart-cache-repository-volman.ts src/charts/repository/chart-cache-repository-volman.ts
git mv src/charts/chart-symbols-repository-volman.ts src/charts/repository/chart-symbols-repository-volman.ts
git mv src/charts/ohlc-cache-repository.ts src/charts/repository/ohlc-cache-repository.ts
git mv src/charts/positions-repository-volman.ts src/charts/repository/positions-repository-volman.ts
git mv src/charts/positions-repository-binance-entry-order-shared.ts src/charts/repository/positions-repository-binance-entry-order-shared.ts
git mv src/charts/scanner-health-repository-volman.ts src/charts/repository/scanner-health-repository-volman.ts
```

- [ ] **Step 4: Sửa import gãy (lặp tới khi sạch)**

```bash
npx tsc --noEmit 2>&1 | head -150
```

Với mỗi lỗi `TS2307 Cannot find module`, mở file báo lỗi, tính lại relative path đúng theo
công thức ở đầu plan (vị trí file hiện tại → vị trí file đích mới), sửa import. Lặp lại lệnh
`tsc --noEmit` tới khi output rỗng. Các import phổ biến cần sửa (tương đối theo từng file, số
lượng `../` tăng thêm 1 nếu import từ file KHÔNG trong `charts/`, giữ nguyên nếu cả 2 file cùng
move vào layer con của `charts/`):
- Import `chart-types-common.js`/`chart-types-volman.js`/`setup-types.js` từ file còn ở root `charts/` → `./model/chart-types-common.js` (thêm `model/`)
- Import `ohlc-provider.js`/`binance-futures-client.js`/`setup-chart-renderer.js` từ file còn ở root `charts/` → `./client/ohlc-provider.js` (thêm `client/`)
- Import các file repository ở trên từ file còn ở root `charts/` → thêm `./repository/`
- Import NGƯỢC LẠI (từ file trong `model/`/`client/`/`repository/` gọi ra file còn ở root `charts/`) → thêm `../` phía trước

- [ ] **Step 5: Sửa `vi.mock(...)` path trong test tương ứng**

```bash
npm run test 2>&1 | grep -A3 "FAIL"
```

Với mỗi test fail do sai `vi.mock` path, sửa theo cùng công thức relative path (test file
đứng yên tại `tests/charts/`, chỉ path bên trong `vi.mock("...")` đổi theo vị trí mới của
src file).

- [ ] **Step 6: Build + test toàn bộ**

```bash
npx tsc --noEmit
```
Expected: 0 lỗi.

```bash
npm run test
```
Expected: toàn bộ test pass, test count không đổi.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(charts): split model/client/repository layers"
```

---

### Task 4: `charts/` — tạo layer `service/` (bao gồm `service/setups/`)

**Files:**
- Create dir: `src/charts/service/`, `src/charts/service/setups/`
- Move (service): `analyzer-common.ts`, `analyzer-volman.ts`, `binance-execution-shared.ts`, `binance-execution-volman.ts`, `binance-position-sizing.ts`, `candle-range-stats.ts`, `chart-cache.ts`, `deterministic-pipeline.ts`, `forex-backtest.ts`, `indicators.ts`, `performance-tracking-volman.ts`, `position-decision-volman.ts`, `position-ema-exit.ts`, `position-engine-volman.ts`, `setup-backtest.ts`, `setup-resolver.ts`, `signal-assembly.ts`, `signal-freshness.ts`, `volman-charts.config.ts`
- Move (service/setups): toàn bộ `src/charts/setups/*.ts` (`arb.ts`, `bb.ts`, `compression-params.ts`, `ddb.ts`, `fb.ts`, `irb.ts`, `rb.ts`, `sb.ts`, `shared.ts`)

**Interfaces:**
- Không đổi export nào.

- [ ] **Step 1: Move service files**

```bash
git mv src/charts/analyzer-common.ts src/charts/service/analyzer-common.ts
git mv src/charts/analyzer-volman.ts src/charts/service/analyzer-volman.ts
git mv src/charts/binance-execution-shared.ts src/charts/service/binance-execution-shared.ts
git mv src/charts/binance-execution-volman.ts src/charts/service/binance-execution-volman.ts
git mv src/charts/binance-position-sizing.ts src/charts/service/binance-position-sizing.ts
git mv src/charts/candle-range-stats.ts src/charts/service/candle-range-stats.ts
git mv src/charts/chart-cache.ts src/charts/service/chart-cache.ts
git mv src/charts/deterministic-pipeline.ts src/charts/service/deterministic-pipeline.ts
git mv src/charts/forex-backtest.ts src/charts/service/forex-backtest.ts
git mv src/charts/indicators.ts src/charts/service/indicators.ts
git mv src/charts/performance-tracking-volman.ts src/charts/service/performance-tracking-volman.ts
git mv src/charts/position-decision-volman.ts src/charts/service/position-decision-volman.ts
git mv src/charts/position-ema-exit.ts src/charts/service/position-ema-exit.ts
git mv src/charts/position-engine-volman.ts src/charts/service/position-engine-volman.ts
git mv src/charts/setup-backtest.ts src/charts/service/setup-backtest.ts
git mv src/charts/setup-resolver.ts src/charts/service/setup-resolver.ts
git mv src/charts/signal-assembly.ts src/charts/service/signal-assembly.ts
git mv src/charts/signal-freshness.ts src/charts/service/signal-freshness.ts
git mv src/charts/volman-charts.config.ts src/charts/service/volman-charts.config.ts
```

- [ ] **Step 2: Move setups vào service/setups/**

```bash
git mv src/charts/setups src/charts/service/setups
```

- [ ] **Step 3: Sửa import gãy (lặp tới khi sạch)**

```bash
npx tsc --noEmit 2>&1 | head -200
```

Sửa từng lỗi theo công thức relative path. Lưu ý: `service/setups/*.ts` import
`./compression-params.js`/`./shared.js` (cùng thư mục `setups/`, giờ là `service/setups/`) —
không đổi vì cả 2 vẫn cùng thư mục con. Import từ `service/setups/*.ts` ra ngoài (v.d. tới
`model/`, `client/`, `repository/`) cần thêm `../../` (2 cấp: ra khỏi `setups/` rồi ra khỏi
`service/`). File `service/deterministic-pipeline.ts` và `service/setup-backtest.ts` import
`./setups/ddb.js` → sửa thành `./setups/ddb.js` (không đổi — vẫn cùng cấp `service/`).

- [ ] **Step 4: Sửa `vi.mock(...)` path trong `tests/charts/setups/*.test.ts` và các test service khác**

```bash
npm run test 2>&1 | grep -A3 "FAIL"
```

- [ ] **Step 5: Build + test toàn bộ**

```bash
npx tsc --noEmit
```
Expected: 0 lỗi.

```bash
npm run test
```
Expected: toàn bộ test pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(charts): split service layer, move setups/ into service/setups/"
```

---

### Task 5: `charts/` — tạo layer `controller/`

**Files:**
- Create dir: `src/charts/controller/`
- Move: `index.ts`, `check-open-trades-runner-volman.ts`, `check-pending-orders-runner-volman.ts`, `forex-backtest-runner.ts`, `performance-report-runner-volman.ts`, `setup-backtest-runner.ts`, `setup-backtest-compare-runner.ts`, `setup-sb-runner.ts`
- Modify: `package.json` (`start`, `analyze`, `forex-backtest`, `performance-report`, `backtest:setups`, `backtest:compare` script paths)

**Interfaces:**
- Không đổi export nào.

- [ ] **Step 1: Move controller files**

```bash
git mv src/charts/index.ts src/charts/controller/index.ts
git mv src/charts/check-open-trades-runner-volman.ts src/charts/controller/check-open-trades-runner-volman.ts
git mv src/charts/check-pending-orders-runner-volman.ts src/charts/controller/check-pending-orders-runner-volman.ts
git mv src/charts/forex-backtest-runner.ts src/charts/controller/forex-backtest-runner.ts
git mv src/charts/performance-report-runner-volman.ts src/charts/controller/performance-report-runner-volman.ts
git mv src/charts/setup-backtest-runner.ts src/charts/controller/setup-backtest-runner.ts
git mv src/charts/setup-backtest-compare-runner.ts src/charts/controller/setup-backtest-compare-runner.ts
git mv src/charts/setup-sb-runner.ts src/charts/controller/setup-sb-runner.ts
```

- [ ] **Step 2: Sửa `package.json` script paths**

Trong `package.json`, đổi:
- `"start": "tsx src/charts/index.ts"` → `"start": "tsx src/charts/controller/index.ts"`
- `"analyze": "tsx src/charts/index.ts"` → `"analyze": "tsx src/charts/controller/index.ts"`
- `"forex-backtest": "tsx src/charts/forex-backtest-runner.ts"` → `"forex-backtest": "tsx src/charts/controller/forex-backtest-runner.ts"`
- `"performance-report": "tsx src/charts/performance-report-runner-volman.ts"` → `"performance-report": "tsx src/charts/controller/performance-report-runner-volman.ts"`
- `"backtest:setups": "tsx src/charts/setup-backtest-runner.ts"` → `"backtest:setups": "tsx src/charts/controller/setup-backtest-runner.ts"`
- `"backtest:compare": "tsx src/charts/setup-backtest-compare-runner.ts"` → `"backtest:compare": "tsx src/charts/controller/setup-backtest-compare-runner.ts"`

- [ ] **Step 3: Sửa import gãy (lặp tới khi sạch)**

```bash
npx tsc --noEmit 2>&1 | head -100
```

- [ ] **Step 4: Sửa `vi.mock(...)` path trong test tương ứng (index.test.ts, orchestration.test.ts, ...)**

```bash
npm run test 2>&1 | grep -A3 "FAIL"
```

- [ ] **Step 5: Build + test toàn bộ + kiểm tra script chạy được**

```bash
npx tsc --noEmit
```
Expected: 0 lỗi.

```bash
npm run test
```
Expected: toàn bộ test pass.

```bash
npm run build
```
Expected: build thành công, không lỗi.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(charts): split controller layer, update package.json script paths"
```

---

### Task 6: `lottery/` — tạo layer `model/`, `client/`, `repository/`

**Files:**
- Create dirs: `src/lottery/model/`, `src/lottery/client/`, `src/lottery/repository/`
- Move (model): `lottery-types.ts`
- Move (client): `lottery-scraper.ts`
- Move (repository): `lottery-draw-status-repository.ts`, `lottery-predictions-repository.ts`, `lottery-repository.ts`

**Interfaces:**
- Không đổi export nào.

- [ ] **Step 1: Move files**

```bash
git mv src/lottery/lottery-types.ts src/lottery/model/lottery-types.ts
git mv src/lottery/lottery-scraper.ts src/lottery/client/lottery-scraper.ts
git mv src/lottery/lottery-draw-status-repository.ts src/lottery/repository/lottery-draw-status-repository.ts
git mv src/lottery/lottery-predictions-repository.ts src/lottery/repository/lottery-predictions-repository.ts
git mv src/lottery/lottery-repository.ts src/lottery/repository/lottery-repository.ts
```

- [ ] **Step 2: Sửa import gãy (lặp tới khi sạch)**

```bash
npx tsc --noEmit 2>&1 | head -100
```

- [ ] **Step 3: Sửa `vi.mock(...)` path trong test tương ứng**

```bash
npm run test 2>&1 | grep -A3 "FAIL"
```

- [ ] **Step 4: Build + test toàn bộ**

```bash
npx tsc --noEmit
```
Expected: 0 lỗi.

```bash
npm run test
```
Expected: toàn bộ test pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(lottery): split model/client/repository layers"
```

---

### Task 7: `lottery/` — tạo layer `service/`

**Files:**
- Create dir: `src/lottery/service/`
- Move: `lottery-ai-predict.ts`, `lottery-backtest.ts`, `lottery-ensemble-predict.ts`, `lottery-format.ts`, `lottery-hit-rate-report.ts`, `lottery-regression-predict.ts`, `lottery-schedule.ts`, `lottery-stats-predict.ts`

**Interfaces:**
- Không đổi export nào.

- [ ] **Step 1: Move files**

```bash
git mv src/lottery/lottery-ai-predict.ts src/lottery/service/lottery-ai-predict.ts
git mv src/lottery/lottery-backtest.ts src/lottery/service/lottery-backtest.ts
git mv src/lottery/lottery-ensemble-predict.ts src/lottery/service/lottery-ensemble-predict.ts
git mv src/lottery/lottery-format.ts src/lottery/service/lottery-format.ts
git mv src/lottery/lottery-hit-rate-report.ts src/lottery/service/lottery-hit-rate-report.ts
git mv src/lottery/lottery-regression-predict.ts src/lottery/service/lottery-regression-predict.ts
git mv src/lottery/lottery-schedule.ts src/lottery/service/lottery-schedule.ts
git mv src/lottery/lottery-stats-predict.ts src/lottery/service/lottery-stats-predict.ts
```

- [ ] **Step 2: Sửa import gãy (lặp tới khi sạch)**

```bash
npx tsc --noEmit 2>&1 | head -150
```

- [ ] **Step 3: Sửa `vi.mock(...)` path trong test tương ứng**

```bash
npm run test 2>&1 | grep -A3 "FAIL"
```

- [ ] **Step 4: Build + test toàn bộ**

```bash
npx tsc --noEmit
```
Expected: 0 lỗi.

```bash
npm run test
```
Expected: toàn bộ test pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(lottery): split service layer"
```

---

### Task 8: `lottery/` — tạo layer `controller/` + sửa `package.json`

**Files:**
- Create dir: `src/lottery/controller/`
- Move: `lottery-backfill-index.ts`, `lottery-backfill-runner.ts`, `lottery-backtest-index.ts`, `lottery-hit-rate-report-index.ts`, `lottery-index.ts`, `lottery-predict-index.ts`, `lottery-predict-resync-index.ts`, `lottery-predict-runner.ts`, `lottery-runner.ts`, `lottery-verify-index.ts`, `lottery-verify-runner.ts`
- Modify: `package.json` (`lottery`, `lottery-backfill`, `lottery-predict`, `lottery-predict-resync`, `lottery-verify`, `lottery-backtest`, `lottery-hit-rate-report` script paths)

**Interfaces:**
- Không đổi export nào.

- [ ] **Step 1: Move files**

```bash
git mv src/lottery/lottery-backfill-index.ts src/lottery/controller/lottery-backfill-index.ts
git mv src/lottery/lottery-backfill-runner.ts src/lottery/controller/lottery-backfill-runner.ts
git mv src/lottery/lottery-backtest-index.ts src/lottery/controller/lottery-backtest-index.ts
git mv src/lottery/lottery-hit-rate-report-index.ts src/lottery/controller/lottery-hit-rate-report-index.ts
git mv src/lottery/lottery-index.ts src/lottery/controller/lottery-index.ts
git mv src/lottery/lottery-predict-index.ts src/lottery/controller/lottery-predict-index.ts
git mv src/lottery/lottery-predict-resync-index.ts src/lottery/controller/lottery-predict-resync-index.ts
git mv src/lottery/lottery-predict-runner.ts src/lottery/controller/lottery-predict-runner.ts
git mv src/lottery/lottery-runner.ts src/lottery/controller/lottery-runner.ts
git mv src/lottery/lottery-verify-index.ts src/lottery/controller/lottery-verify-index.ts
git mv src/lottery/lottery-verify-runner.ts src/lottery/controller/lottery-verify-runner.ts
```

- [ ] **Step 2: Sửa `package.json` script paths**

Trong `package.json`, đổi:
- `"lottery": "tsx src/lottery/lottery-index.ts"` → `"lottery": "tsx src/lottery/controller/lottery-index.ts"`
- `"lottery-backfill": "tsx src/lottery/lottery-backfill-index.ts"` → `"lottery-backfill": "tsx src/lottery/controller/lottery-backfill-index.ts"`
- `"lottery-predict": "tsx src/lottery/lottery-predict-index.ts"` → `"lottery-predict": "tsx src/lottery/controller/lottery-predict-index.ts"`
- `"lottery-predict-resync": "tsx src/lottery/lottery-predict-resync-index.ts"` → `"lottery-predict-resync": "tsx src/lottery/controller/lottery-predict-resync-index.ts"`
- `"lottery-verify": "tsx src/lottery/lottery-verify-index.ts"` → `"lottery-verify": "tsx src/lottery/controller/lottery-verify-index.ts"`
- `"lottery-backtest": "tsx src/lottery/lottery-backtest-index.ts"` → `"lottery-backtest": "tsx src/lottery/controller/lottery-backtest-index.ts"`
- `"lottery-hit-rate-report": "tsx src/lottery/lottery-hit-rate-report-index.ts"` → `"lottery-hit-rate-report": "tsx src/lottery/controller/lottery-hit-rate-report-index.ts"`

- [ ] **Step 3: Sửa import gãy (lặp tới khi sạch)**

```bash
npx tsc --noEmit 2>&1 | head -150
```

- [ ] **Step 4: Sửa `vi.mock(...)` path trong test tương ứng**

```bash
npm run test 2>&1 | grep -A3 "FAIL"
```

- [ ] **Step 5: Build + test toàn bộ + build script check**

```bash
npx tsc --noEmit
```
Expected: 0 lỗi.

```bash
npm run test
```
Expected: toàn bộ test pass.

```bash
npm run build
```
Expected: build thành công.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(lottery): split controller layer, update package.json script paths"
```

---

### Task 9: Rà `src/scripts/` + final full verification

**Files:**
- Modify: `src/scripts/preflight-fetch.ts`, `src/scripts/seed-chart-symbols.ts`, `src/scripts/send-sample-chart.ts`, `src/scripts/send-sample-charts-all.ts`, `src/scripts/verify-chart-symbols.ts` (import path tới `charts/` file đã move)

**Interfaces:**
- Không đổi export nào.

- [ ] **Step 1: Rà toàn bộ import trong `src/scripts/` trỏ tới file `charts/` đã move**

```bash
npx tsc --noEmit 2>&1 | grep "src/scripts"
```

Sửa từng import theo layer mới, ví dụ:
- `../charts/ohlc-provider.js` → `../charts/client/ohlc-provider.js`
- `../charts/chart-symbols-repository-volman.js` → `../charts/repository/chart-symbols-repository-volman.js`
- `../charts/setup-chart-renderer.js` → `../charts/client/setup-chart-renderer.js`
- `../charts/binance-futures-client.js` → `../charts/client/binance-futures-client.js`
- `../charts/chart-types-volman.js` → `../charts/model/chart-types-volman.js`
- `../charts/setup-types.js` → `../charts/model/setup-types.js`

- [ ] **Step 2: Full build + test + verify không còn reference nào tới path cũ**

```bash
npx tsc --noEmit
```
Expected: 0 lỗi.

```bash
npm run test
```
Expected: toàn bộ test pass, tổng test count bằng đúng baseline trước Task 1 (ghi lại số test
pass trước khi bắt đầu plan này để so sánh).

```bash
npm run build
```
Expected: build thành công.

```bash
grep -rE "from [\"'](\.\./)*betting/(betting|betting-analysis-repository|betting-api|betting-backtest\.js|betting-gemini|betting-index|betting-types|correct-score-api|match-repository|odds-compact|odds-runner|odds-text-format)[\"']|from [\"'](\.\./)*shared/(db|env|logger|fetch-diagnostics|rate-limit|telegram-client)\.js[\"']" src tests --include=*.ts
```
Expected: không có output (0 match — xác nhận không còn shim reference nào sót lại).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(scripts): update import paths after charts/ layer split"
```
