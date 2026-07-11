# Plan: Pending-Order Simulation trong Volman Setup Backtest

## Bối cảnh

`runSetupBacktest` (`src/charts/setup-backtest.ts:71`) hiện fill entry NGAY tại
`triggerIndex` — nến mà detector phát hiện breakout (`entryIndex = signal.triggerIndex`,
`setup-backtest.ts:185,198`). Đây KHÔNG khớp với hệ thống live:

- Live tạo **pending order** (`BUY_STOP`/`SELL_STOP`, xem
  `src/charts/signal-assembly.ts:95` — mọi setup Volman hiện tại (BB/RB/ARB/IRB) luôn
  dùng `BUY_STOP`/`SELL_STOP`, không dùng `WAIT_FOR_CONFIRMATION`/`*_LIMIT`).
- `check-pending-orders-runner-volman.ts` chạy định kỳ, mỗi lần gọi
  `resolvePendingOrderDecision` (`position-decision-volman.ts:168-264`):
  1. Nếu giá đã xuyên **stop loss** trước → `CANCELLED` (dòng 194-203, kiểm tra
     **trước** khi kiểm tra trigger).
  2. Nếu chưa cancel, kiểm tra trigger theo `orderType`: `BUY_STOP` fill khi
     `high >= entry`, `SELL_STOP` fill khi `low <= entry` (dòng 236-249).
  3. Nếu chưa cancel/trigger và `runCount >= expiryRuns` → `EXPIRED`
     (`check-pending-orders-runner-volman.ts:127-139`). Default
     `expiryRuns = 2` (`volman-config-env.ts:64-69`, override qua
     `PENDING_ORDER_EXPIRY_RUNS`).
- Quan trọng: candle mà detector phát hiện signal (đóng nến, close phá block) đã
  dùng hết dữ liệu nến đó — pending order chỉ có thể được đặt và bắt đầu theo dõi
  **từ nến kế tiếp**, không phải fill ngay trong chính nến tín hiệu.

Cơ chế `watchingFalseBreak` hiện tại trong backtest (`setup-backtest.ts:57-60,111-139`)
là heuristic riêng của backtest (xác nhận/huỷ trade **đã fill** dựa trên 2 nến kế
tiếp), khác hoàn toàn với pending-order thật của live. Plan này thêm một **chế độ
mô phỏng pending-order đúng theo live**, chạy song song (A/B) với chế độ
"immediate fill" hiện tại, không phá vỡ hành vi cũ.

## Kiến trúc thay đổi

### 1. `src/charts/setup-backtest.ts`

Thêm tham số mới cho `runSetupBacktest`:

```ts
export type FillMode = "immediate" | "pending";

export function runSetupBacktest(
  candles: Candle[],
  pair: string,
  timeframe: ChartTimeframe,
  exitMode: ExitMode = "fixed",
  trailBufferR = 0,
  swingLookback = 3,
  fillMode: FillMode = "immediate",
  pendingExpiryBars = 2,
): SetupBacktestReport
```

- `fillMode` mặc định `"immediate"` → **không đổi hành vi hiện có**, giữ nguyên
  toàn bộ code path `watchingFalseBreak` như hiện tại (backward compatible với mọi
  kết quả backtest cũ).
- `fillMode = "pending"` → thay thế hoàn toàn `watchingFalseBreak` bằng state
  machine pending-order mới:
  - Khi có signal mới tại `triggerIndex`, tạo `PendingOrderState` thay vì fill
    ngay: `{ signal, orderStartIndex: triggerIndex + 1, deadlineIndex: triggerIndex + pendingExpiryBars }`.
  - Không detect signal mới khi đang có `pendingOrder` hoặc `openTrade` (giữ đúng
    nguyên tắc "one trade/order at a time" như live và như code hiện tại dòng 142).
  - Tại mỗi `index >= orderStartIndex`, dùng `candles[index].high/low` để đánh giá
    theo đúng thứ tự ưu tiên của `resolvePendingOrderDecision`:
    1. **Invalidation trước**: LONG → `low <= stopLoss`; SHORT → `high >= stopLoss`.
       Nếu đúng → huỷ pending order, không tạo trade, tăng
       `pendingStats.cancelledBeforeFill`.
    2. **Trigger**: LONG (BUY_STOP) → `high >= entry`; SHORT (SELL_STOP) →
       `low <= entry`. Nếu đúng (và không bị invalidation ở bước 1 tại cùng nến)
       → fill trade tại `entryIndex = index`, `entryPrice = signal.entry`, gọi lại
       đúng logic scan hiện có (`scanOutcome`/`scanOutcomeTrailing`/`scanOutcomeSwingTrail`)
       bắt đầu từ nến fill này. Tăng `pendingStats.filled`.
    3. Nếu chưa cancel/trigger và `index >= deadlineIndex` → hết hạn, không tạo
       trade, tăng `pendingStats.expired`.
  - `pendingStats.signalsSeen` tăng mỗi khi một signal mới được đưa vào trạng thái
    chờ.
- Mở rộng `SetupBacktestReport` với field optional:
  ```ts
  pendingStats?: {
    signalsSeen: number;
    filled: number;
    cancelledBeforeFill: number;
    expired: number;
  };
  ```
  Chỉ populate khi `fillMode === "pending"`; `undefined` khi `"immediate"`.
- Export `FillMode` type.

### 2. `src/charts/setup-backtest-runner.ts`

- Thêm parser + env var:
  - `BACKTEST_FILL_MODE` (`immediate` | `pending`, default `immediate`).
  - `BACKTEST_PENDING_EXPIRY_BARS` (số nguyên >=1, default `2` — khớp default
    `PENDING_ORDER_EXPIRY_RUNS` của live).
- Truyền 2 tham số này vào `runSetupBacktest`.
- `printReport`: khi `fillMode === "pending"`, in thêm block `PENDING ORDER STATS`
  (tổng hợp `pendingStats` cộng dồn qua tất cả pairs): số signal, số filled, số
  cancelled-before-fill, số expired, tỉ lệ % từng loại.

### 3. `src/charts/setup-backtest-compare-runner.ts` (mới)

Script A/B: fetch candles một lần cho mỗi pair (dùng lại cấu hình `CHARTS`,
`fetchOhlcHistory` như `setup-backtest-runner.ts`), sau đó chạy `runSetupBacktest`
**hai lần** trên cùng bộ candles/pair — một lần `fillMode="immediate"`, một lần
`fillMode="pending"` — với cùng `exitMode`/`trailBufferR`/`swingLookback` (đọc từ
env, tái dùng parser hiện có).

Output:
- Console table so sánh overall/bySetup/byPair giữa 2 mode: trades, win rate,
  avg R, và **delta** (pending − immediate) cho từng metric.
- Block `PENDING ORDER STATS` tổng hợp (fill rate / cancel rate / expiry rate).
- Cuối cùng in một khối JSON tổng hợp (`console.log(JSON.stringify(..., null, 2))`)
  theo đúng convention đã dùng ở `smc-backtest-runner.ts:186` — để có thể redirect
  ra file bằng `>` khi chạy, giống cách `tasks/smc-h1-h4-vs-m15-backtest/*.json`
  đã được tạo trước đây.

Thêm script vào `package.json`:
```json
"backtest:compare": "tsx src/charts/setup-backtest-compare-runner.ts"
```

### 4. Tests

Thêm test cases trong `tests/charts/setup-backtest.test.ts` cho `fillMode="pending"`:
- Immediate mode không đổi hành vi (regression, so sánh với snapshot hiện có).
- Entry chỉ fill ở nến sau `triggerIndex` khi giá thực sự chạm entry.
- Invalidation: SL bị chạm trước khi entry chạm → không tạo trade,
  `pendingStats.cancelledBeforeFill` tăng.
- Expiry: qua `pendingExpiryBars` nến mà chưa chạm entry → không tạo trade,
  `pendingStats.expired` tăng.
- Trường hợp cùng nến vừa chạm SL vừa chạm entry → tính là cancelled (invalidation
  ưu tiên trước), không phải filled.

### 5. Chạy A/B thật và báo cáo

Sau khi code + test xong, chạy `npm run backtest:compare` với cấu hình hiện tại
của `CHARTS` (H4, `BACKTEST_BARS` mặc định 500, `exitMode` mặc định `fixed`) và
lưu output vào `tasks/backtest-pending-order-simulation/results/`:
- `h4-fixed.json` — output JSON từ `backtest:compare`.
- `h4-fixed.log` — console log đầy đủ (bao gồm bảng so sánh) để tham khảo dạng
  người đọc.

Ghi tóm tắt kết quả (win rate / avg R / số trade, tổng và theo setup) vào
`tasks/backtest-pending-order-simulation/05-run-comparison-and-report/result.md`.

## Rủi ro / Edge cases

- Nến cuối cùng của mảng candles: nếu pending order chưa fill/cancel/expire khi
  hết dữ liệu, coi như vẫn "pending" — không tạo trade, không tính vào
  `filled/cancelledBeforeFill/expired` (không đếm nhầm, không throw).
- `pendingExpiryBars` là xấp xỉ cho "số lần check" của live (`expiryRuns`), vì
  live check theo lịch cron chứ không hẳn 1:1 theo nến — ghi rõ đây là giả định
  xấp xỉ trong comment code và trong result.md, không cần làm chính xác tuyệt đối.
- `WAIT_FOR_CONFIRMATION`/`BUY_LIMIT`/`SELL_LIMIT` **ngoài phạm vi** — toàn bộ
  setup Volman hiện tại (BB/RB/ARB/IRB) chỉ dùng `BUY_STOP`/`SELL_STOP`
  (`signal-assembly.ts:95`), nên state machine chỉ cần xử lý 2 loại lệnh stop.
- Không đổi `exitMode`/`scanOutcome*` logic — chỉ đổi điểm bắt đầu (`entryIndex`)
  và cách xác định trade có tồn tại hay không.
- Immediate mode (default) phải giữ nguyên 100% output so với code hiện tại —
  đây là điều kiện bắt buộc để review pass.

## Subtasks

| ID | Owner | Files được sửa | Phụ thuộc | Output |
|----|-------|----------------|-----------|--------|
| 01-pending-order-engine | worker | `src/charts/setup-backtest.ts` | none | `tasks/backtest-pending-order-simulation/01-pending-order-engine/result.md` |
| 02-runner-cli-flags | worker | `src/charts/setup-backtest-runner.ts` | 01 | `tasks/backtest-pending-order-simulation/02-runner-cli-flags/result.md` |
| 03-compare-runner | worker | `src/charts/setup-backtest-compare-runner.ts` (mới), `package.json` | 01 | `tasks/backtest-pending-order-simulation/03-compare-runner/result.md` |
| 04-tests | worker | `tests/charts/setup-backtest.test.ts` | 01 | `tasks/backtest-pending-order-simulation/04-tests/result.md` |
| 05-run-comparison-and-report | worker | (không sửa code) `tasks/backtest-pending-order-simulation/results/*` | 01,02,03,04 | `tasks/backtest-pending-order-simulation/05-run-comparison-and-report/result.md` |

Parallelizable: 01 phải chạy trước (thay đổi signature `runSetupBacktest`). Sau khi
01 xong (review APPROVED), 02, 03, 04 có thể chạy song song vì sửa các file khác
nhau. 05 chỉ chạy sau khi 01-04 đều APPROVED.

## Verification tổng thể

```bash
npm run build
npm run test -- tests/charts/setup-backtest.test.ts
npm run backtest:setups
npm run backtest:compare
```
