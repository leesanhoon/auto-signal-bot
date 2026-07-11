# Task 02 — CLI flags cho fillMode trong setup-backtest-runner

Owner: worker
Files được phép sửa: `src/charts/setup-backtest-runner.ts` (chỉ file này)
Phụ thuộc: 01-pending-order-engine phải đã APPROVED (đọc
`tasks/backtest-pending-order-simulation/01-pending-order-engine/result.md` và
`review.md` trước khi bắt đầu; nếu chưa có `done.md` trong thư mục đó, dừng lại
và ghi `blocked.md`).

Đọc `tasks/backtest-pending-order-simulation/plan.md` phần "2.
`src/charts/setup-backtest-runner.ts`" trước khi làm.

## Mục tiêu

Thêm 2 env var mới để chọn `fillMode` và `pendingExpiryBars` khi chạy
`npm run backtest:setups`, và in thêm block thống kê pending order khi
`fillMode = "pending"`.

## Các bước thực hiện

1. Mở `src/charts/setup-backtest-runner.ts`. Đọc toàn bộ file (320 dòng).

2. Import `FillMode` từ `./setup-backtest.js` (cạnh import `ExitMode` hiện có ở
   dòng 8):
   ```ts
   import type { ExitMode, FillMode } from "./setup-backtest.js";
   ```

3. Thêm 2 hàm parser mới, đặt cạnh `parseSwingLookback` (dòng ~26-30):
   ```ts
   function parseFillMode(value: string | undefined): FillMode {
     const normalized = value?.trim().toLowerCase();
     return normalized === "pending" ? "pending" : "immediate";
   }

   function parsePendingExpiryBars(value: string | undefined): number {
     if (value === undefined || value.trim() === "") return 2;
     const parsed = Number(value);
     return Number.isInteger(parsed) && parsed >= 1 ? parsed : 2;
   }
   ```

4. Trong `main()`, sau dòng khai báo `swingLookback` (~dòng 72), thêm:
   ```ts
   const fillMode = parseFillMode(process.env.BACKTEST_FILL_MODE);
   const pendingExpiryBars = parsePendingExpiryBars(process.env.BACKTEST_PENDING_EXPIRY_BARS);
   ```
   Và mở rộng log info hiện có (dòng 75-79) để in thêm fillMode, ví dụ nối thêm
   `` ` + `, fill=${fillMode}${fillMode === "pending" ? ` (expiry=${pendingExpiryBars} bars)` : ""}` `` `` vào
   chuỗi log.

5. Sửa lời gọi `runSetupBacktest(...)` trong vòng lặp `for (const { pair, symbol } of pairs)`
   (dòng ~117-124) để truyền thêm 2 tham số:
   ```ts
   const report = runSetupBacktest(
     candles,
     pair,
     timeframe,
     exitMode,
     trailBufferR,
     swingLookback,
     fillMode,
     pendingExpiryBars,
   );
   ```

6. Sửa lời gọi `printReport(allReports, timeframe, exitMode)` ở cuối `main()`
   thành `printReport(allReports, timeframe, exitMode, fillMode);` — thêm tham
   số `fillMode`.

7. Sửa signature `printReport` để nhận thêm `fillMode: FillMode`:
   ```ts
   function printReport(
     reports: Array<{ pair: string; report: Awaited<ReturnType<typeof runSetupBacktest>> }>,
     timeframe: ChartTimeframe,
     exitMode: ExitMode,
     fillMode: FillMode,
   ): void {
   ```
   Cập nhật dòng tiêu đề (`console.log(\`SETUP BACKTEST REPORT (${timeframe}, exit=${exitMode})\`);`)
   để thêm `fill=${fillMode}` vào chuỗi.

8. Trong `printReport`, sau khối `EXIT BREAKDOWN` hiện có (nếu có) và trước khối
   `OVERALL`, thêm khối mới — chỉ in khi `fillMode === "pending"`:
   ```ts
   if (fillMode === "pending") {
     let signalsSeen = 0, filled = 0, cancelledBeforeFill = 0, expired = 0;
     for (const { report } of reports) {
       if (!report.pendingStats) continue;
       signalsSeen += report.pendingStats.signalsSeen;
       filled += report.pendingStats.filled;
       cancelledBeforeFill += report.pendingStats.cancelledBeforeFill;
       expired += report.pendingStats.expired;
     }
     console.log(`\n📥 PENDING ORDER STATS`);
     console.log(`   Signals seen: ${signalsSeen}`);
     console.log(`   Filled: ${filled} (${signalsSeen > 0 ? ((filled / signalsSeen) * 100).toFixed(1) : "0.0"}%)`);
     console.log(`   Cancelled before fill (SL touched first): ${cancelledBeforeFill} (${signalsSeen > 0 ? ((cancelledBeforeFill / signalsSeen) * 100).toFixed(1) : "0.0"}%)`);
     console.log(`   Expired (no touch within window): ${expired} (${signalsSeen > 0 ? ((expired / signalsSeen) * 100).toFixed(1) : "0.0"}%)`);
   }
   ```

## Ngoài phạm vi

- Không sửa `setup-backtest.ts`, `setup-backtest-compare-runner.ts`,
  `package.json`, test files.
- Không đổi `printEquityCurve` — giữ nguyên.

## Acceptance criteria

- `npm run build` pass.
- `BACKTEST_FILL_MODE` không set hoặc `=immediate` → output console giống hệt
  trước khi sửa (ngoại trừ có thêm `fill=immediate` trong header title — chấp
  nhận thay đổi nhỏ này).
- `BACKTEST_FILL_MODE=pending` chạy được và in thêm block `PENDING ORDER STATS`.
- Verify bằng cách chạy thực tế (cần mạng/API OHLC khả dụng):
  ```bash
  BACKTEST_FILL_MODE=pending BACKTEST_BARS=200 npm run backtest:setups
  ```
  Nếu môi trường không có mạng/API để fetch OHLC, ghi rõ trong `result.md` là đã
  verify bằng `npm run build` + đọc lại code, và note rõ lý do không chạy runtime
  được (không phải blocked — build pass vẫn coi là đủ evidence tối thiểu).

## Ghi kết quả

Viết `tasks/backtest-pending-order-simulation/02-runner-cli-flags/result.md` với
diff các đoạn sửa và output verify. Nếu bị chặn (ví dụ 01 chưa done), ghi
`blocked.md`.
