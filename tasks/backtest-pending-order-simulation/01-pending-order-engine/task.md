# Task 01 — Pending-order simulation engine

Owner: worker
Files được phép sửa: `src/charts/setup-backtest.ts` (chỉ file này)
Phụ thuộc: none

Đọc `tasks/backtest-pending-order-simulation/plan.md` trước để hiểu bối cảnh đầy
đủ (đặc biệt phần "1. `src/charts/setup-backtest.ts`" và "Rủi ro / Edge cases").

## Mục tiêu

Thêm chế độ `fillMode = "pending"` vào `runSetupBacktest` mô phỏng đúng hành vi
pending-order của live (`resolvePendingOrderDecision` trong
`src/charts/position-decision-volman.ts:168-264`), trong khi chế độ mặc định
`fillMode = "immediate"` **giữ nguyên 100% hành vi hiện tại** (không đổi 1 dòng
output nào so với code cũ khi gọi hàm không truyền `fillMode`).

## Các bước thực hiện

1. Mở `src/charts/setup-backtest.ts`. Đọc toàn bộ file hiện tại (461 dòng) trước
   khi sửa.

2. Thêm export type mới ngay dưới `export type ExitMode`:
   ```ts
   export type FillMode = "immediate" | "pending";
   ```

3. Sửa signature của `runSetupBacktest` (dòng ~71-78) thành:
   ```ts
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
   Mọi call site hiện có (không truyền 2 tham số mới) phải tiếp tục compile và
   chạy y hệt như trước — không được sửa call site nào khác ngoài file này.

4. Thêm type state cho pending order, đặt gần `type PendingFalseBreak`:
   ```ts
   type PendingOrderState = {
     signal: DetectedSignal;
     triggerIndex: number;
     orderStartIndex: number;
     deadlineIndex: number;
   };

   type PendingModeStats = {
     signalsSeen: number;
     filled: number;
     cancelledBeforeFill: number;
     expired: number;
   };
   ```

5. Mở rộng `SetupBacktestReport` (dòng ~43-48) thêm field optional:
   ```ts
   pendingStats?: {
     signalsSeen: number;
     filled: number;
     cancelledBeforeFill: number;
     expired: number;
   };
   ```

6. Trong thân `runSetupBacktest`, giữ nguyên toàn bộ logic hiện có (biến
   `openTrade`, `watchingFalseBreak`, vòng lặp chính, `detectors`, `startIndex`,
   v.v.) khi `fillMode === "immediate"`. Cách làm an toàn nhất: giữ nguyên đường
   dẫn code cũ y hệt, và **rẽ nhánh mới** chỉ khi `fillMode === "pending"`. Gợi ý
   cấu trúc (không bắt buộc đúng từng dòng, nhưng phải đúng hành vi):

   - Thêm biến `let pendingOrder: PendingOrderState | null = null;` và
     `const pendingStats: PendingModeStats = { signalsSeen: 0, filled: 0, cancelledBeforeFill: 0, expired: 0 };`
     chỉ dùng khi `fillMode === "pending"`.
   - Trong vòng lặp `for (let index = startIndex; ...)`, TRƯỚC đoạn xử lý
     `watchingFalseBreak` hiện tại, thêm nhánh: nếu `fillMode === "pending"`,
     bỏ qua hoàn toàn logic `watchingFalseBreak` (không chạy đoạn dòng 111-139
     gốc trong nhánh pending) và thay bằng xử lý pending order:
     ```ts
     if (fillMode === "pending" && pendingOrder !== null && index >= pendingOrder.orderStartIndex) {
       const { high, low } = candles[index];
       const { entry, stopLoss, direction } = pendingOrder.signal;

       const invalidated = direction === "LONG" ? low <= stopLoss : high >= stopLoss;
       if (invalidated) {
         pendingStats.cancelledBeforeFill++;
         pendingOrder = null;
       } else {
         const triggered = direction === "LONG" ? high >= entry : low <= entry;
         if (triggered) {
           const trade = buildTrade(candles, pendingOrder.signal, exitMode, trailBufferR, swingLookback, index);
           trades.push(trade);
           pendingStats.filled++;
           openTrade = { signal: pendingOrder.signal, trade, triggerIndex: pendingOrder.triggerIndex, committed: true };
           pendingOrder = null;
         } else if (index >= pendingOrder.deadlineIndex) {
           pendingStats.expired++;
           pendingOrder = null;
         }
       }
     }
     ```
   - Điều kiện chặn detect signal mới (dòng ~142 `if (openTrade === null) {`) khi
     `fillMode === "pending"` phải đổi thành: chỉ detect signal mới khi
     `openTrade === null && pendingOrder === null`.
   - Khi có signal mới hợp lệ (`resolvedSignals[0]`) và `fillMode === "pending"`:
     KHÔNG gọi `buildTrade` ngay, KHÔNG set `openTrade`. Thay vào đó:
     ```ts
     pendingStats.signalsSeen++;
     pendingOrder = {
       signal,
       triggerIndex: signal.triggerIndex,
       orderStartIndex: signal.triggerIndex + 1,
       deadlineIndex: signal.triggerIndex + pendingExpiryBars,
     };
     ```
   - Khi `fillMode === "immediate"`, đoạn code signal mới phải chạy y hệt logic
     gốc hiện tại (build trade ngay, set `openTrade` + `watchingFalseBreak`).
   - Đoạn dọn `openTrade` khi trade đã đóng (dòng 103-109 gốc) áp dụng cho cả 2
     mode, giữ nguyên.

7. Sửa `buildTrade` để nhận thêm tham số optional `entryIndexOverride?: number`:
   ```ts
   function buildTrade(
     candles: Candle[],
     signal: DetectedSignal,
     exitMode: ExitMode,
     trailBufferR: number,
     swingLookback: number,
     entryIndexOverride?: number,
   ): SetupBacktestTrade {
     const entryIndex = entryIndexOverride ?? signal.triggerIndex;
     // ... phần còn lại giữ nguyên, chỉ đổi `signal.triggerIndex` -> `entryIndex` ở mọi chỗ dùng làm entry
   ```
   Đảm bảo mọi call site cũ (không truyền `entryIndexOverride`) tiếp tục dùng
   `signal.triggerIndex` như trước — hành vi immediate mode không đổi.

8. Cuối hàm `runSetupBacktest`, thay `return computeReport(trades);` bằng:
   ```ts
   const report = computeReport(trades);
   if (fillMode === "pending") {
     report.pendingStats = { ...pendingStats };
   }
   return report;
   ```

9. KHÔNG sửa `scanOutcome`, `scanOutcomeTrailing`, `scanOutcomeSwingTrail`,
   `computeReport` — các hàm này giữ nguyên logic, chỉ nhận `entryIndex` khác
   (đã đến từ `buildTrade`).

## Ngoài phạm vi (out-of-scope)

- Không sửa `setup-backtest-runner.ts`, `setup-backtest-compare-runner.ts`,
  `package.json`, hay bất kỳ file test nào — các subtask khác lo.
- Không thêm `WAIT_FOR_CONFIRMATION` / `BUY_LIMIT` / `SELL_LIMIT` — chỉ
  `BUY_STOP`/`SELL_STOP` semantics (LONG dùng high>=entry, SHORT dùng
  low<=entry).
- Không đổi các setup detector trong `src/charts/setups/*.ts`.

## Acceptance criteria

- `npm run build` pass, không lỗi TypeScript.
- Gọi `runSetupBacktest(candles, pair, tf)` (không truyền `fillMode`) cho ra kết
  quả **giống hệt** trước khi sửa (immediate mode không đổi behavior) — verify
  bằng cách chạy `npm run test -- tests/charts/setup-backtest.test.ts` (test file
  hiện có, chưa có test mới cho pending mode ở subtask này) và đảm bảo pass.
- `fillMode = "pending"`: trade chỉ được tạo khi entry thực sự bị chạm ở nến sau
  `triggerIndex`; nếu SL bị chạm trước entry ở cùng hoặc trước nến trigger entry
  → không có trade; nếu quá `pendingExpiryBars` nến mà chưa chạm entry → không
  có trade.
- `report.pendingStats` chỉ xuất hiện (không phải `undefined`) khi
  `fillMode === "pending"`.

## Ghi kết quả

Viết `tasks/backtest-pending-order-simulation/01-pending-order-engine/result.md`
gồm: tóm tắt thay đổi, diff các đoạn code chính, output của
`npm run build` và `npm run test -- tests/charts/setup-backtest.test.ts`.
Nếu bị chặn, ghi `blocked.md` trong cùng thư mục, không đoán.
