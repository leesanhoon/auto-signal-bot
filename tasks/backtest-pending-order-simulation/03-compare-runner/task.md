# Task 03 — A/B compare runner (immediate vs pending)

Owner: worker
Files được phép sửa/tạo: `src/charts/setup-backtest-compare-runner.ts` (file
mới), `package.json` (chỉ thêm 1 dòng script)
Phụ thuộc: 01-pending-order-engine phải đã APPROVED (có `done.md` trong
`tasks/backtest-pending-order-simulation/01-pending-order-engine/`). Nếu chưa,
ghi `blocked.md` và dừng.

Đọc `tasks/backtest-pending-order-simulation/plan.md` phần "3.
`src/charts/setup-backtest-compare-runner.ts` (mới)" trước khi làm.

## Mục tiêu

Tạo script mới chạy backtest 2 lần trên cùng dữ liệu (fillMode="immediate" vs
"pending") và in ra bảng so sánh + JSON tổng hợp, để so sánh win rate / avg R /
số trade giữa 2 chế độ.

## Các bước thực hiện

1. Đọc `src/charts/setup-backtest-runner.ts` (toàn bộ, đã được cập nhật bởi
   subtask 02 — nếu subtask 02 chưa merge, vẫn có thể đọc bản gốc và tự thêm phần
   fillMode parsing tương tự, KHÔNG phụ thuộc runtime vào subtask 02 vì đây là
   file riêng biệt) để tái sử dụng đúng cách parse env (`parseBacktestTimeframe`,
   `parseBacktestBars`, `parseExitMode`, `parseTrailBufferR`,
   `parseSwingLookback`, `parsePendingExpiryBars` nếu có) và cách lấy danh sách
   `pairs` từ `CHARTS` (`./volman-charts.config.js`).

2. Tạo file mới `src/charts/setup-backtest-compare-runner.ts`:
   - Import `"../shared/env.js"`, `createLogger`, `CHARTS`, `fetchOhlcHistory`,
     `runSetupBacktest`, types `Candle`, `ChartTimeframe`, `ExitMode`.
   - Copy các hàm parse env cần thiết từ `setup-backtest-runner.ts`
     (`parseBacktestTimeframe`, `parseBacktestBars`, `parseExitMode`,
     `parseTrailBufferR`, `parseSwingLookback`). Thêm
     `parsePendingExpiryBars` (default 2, giống task 02) nếu chưa có sẵn để tái sử
     dụng — copy logic, không import chéo từ `setup-backtest-runner.ts` (giữ file
     độc lập, tránh side-effect từ `main()` của file kia).

3. Trong `main()`:
   - Đọc `timeframe`, `bars`, `exitMode`, `trailBufferR`, `swingLookback`,
     `pendingExpiryBars` từ env (cùng tên biến env như `setup-backtest-runner.ts`:
     `BACKTEST_TIMEFRAME`, `BACKTEST_BARS`, `BACKTEST_EXIT_MODE`,
     `BACKTEST_TRAIL_BUFFER_R`, `BACKTEST_SWING_LOOKBACK`,
     `BACKTEST_PENDING_EXPIRY_BARS`).
   - Lấy danh sách `pairs` từ `CHARTS` giống hệt cách làm trong
     `setup-backtest-runner.ts` (dòng 82-91 của file gốc).
   - Với mỗi pair: fetch OHLC một lần (`bypassCache: true`), rồi chạy
     `runSetupBacktest` HAI LẦN trên cùng `candles`:
     ```ts
     const immediateReport = runSetupBacktest(candles, pair, timeframe, exitMode, trailBufferR, swingLookback, "immediate");
     const pendingReport = runSetupBacktest(candles, pair, timeframe, exitMode, trailBufferR, swingLookback, "pending", pendingExpiryBars);
     ```
   - Gom kết quả vào 2 mảng `immediateReports` và `pendingReports` (cùng shape
     `Array<{ pair: string; report: SetupBacktestReport }>` như
     `setup-backtest-runner.ts`).

4. Viết hàm `aggregate(reports)` tính tổng overall/bySetup/byPair (trades, wins,
   totalRr) y hệt logic đã có trong `printReport` của `setup-backtest-runner.ts`
   (dòng ~165-199) — có thể copy logic, trả về object thay vì console.log trực
   tiếp, ví dụ:
   ```ts
   type Agg = { trades: number; wins: number; totalRr: number };
   function aggregate(reports: Array<{ pair: string; report: SetupBacktestReport }>): {
     overall: Agg; bySetup: Record<string, Agg>; byPair: Record<string, Agg>;
   }
   ```

5. Viết hàm `printComparisonTable(label, immediateAgg, pendingAgg)` in ra console
   một bảng cho từng breakdown (overall / bySetup / byPair) với các cột:
   `Trades (imm/pend)`, `Win Rate (imm/pend, Δ pp)`, `Avg R (imm/pend, Δ)`.
   Format số: win rate theo %, 1 chữ số thập phân; avg R 2 chữ số thập phân; delta
   có dấu `+`/`-`.

6. In thêm block `PENDING ORDER STATS` (tổng hợp `pendingReport.pendingStats`
   qua các pair), logic giống task 02 bước 8 (copy).

7. Ở cuối `main()`, in một khối JSON tổng hợp bằng
   `console.log(JSON.stringify({...}, null, 2))` chứa:
   ```ts
   {
     timeframe, bars, exitMode, trailBufferR, swingLookback, pendingExpiryBars,
     overall: { immediate: {...}, pending: {...}, deltaWinRatePct, deltaAvgR, deltaTrades },
     bySetup: { [setup]: { immediate, pending, delta... } },
     byPair: { [pair]: { immediate, pending, delta... } },
     pendingStats: { signalsSeen, filled, cancelledBeforeFill, expired },
   }
   ```
   Số liệu làm tròn hợp lý (2 chữ số thập phân cho tỉ lệ/avg R).

8. Thêm `main().catch(...)` pattern giống các runner khác trong file.

9. Mở `package.json`, thêm dòng script (đặt cạnh `"backtest:setups"` dòng 19):
   ```json
   "backtest:compare": "tsx src/charts/setup-backtest-compare-runner.ts",
   ```

## Ngoài phạm vi

- Không sửa `setup-backtest.ts`, `setup-backtest-runner.ts`.
- Không tự động ghi file kết quả ra `tasks/backtest-pending-order-simulation/results/`
  trong code (đó là việc chạy thủ công của subtask 05 qua redirect `>`), script
  chỉ cần in ra stdout đúng, đủ, format rõ ràng.

## Acceptance criteria

- `npm run build` pass.
- `npx tsc --noEmit` hoặc build không báo lỗi type ở file mới.
- Chạy thử `npm run backtest:compare` (nếu có mạng/API OHLC) không throw, in ra
  đủ 3 khối bảng so sánh + PENDING ORDER STATS + JSON cuối cùng hợp lệ (parse
  được bằng `JSON.parse`). Nếu môi trường không có mạng, verify bằng
  `npm run build` và note rõ lý do trong `result.md`.

## Ghi kết quả

Viết `tasks/backtest-pending-order-simulation/03-compare-runner/result.md` với
nội dung file mới, diff `package.json`, và output verify. Nếu bị chặn, ghi
`blocked.md`.
