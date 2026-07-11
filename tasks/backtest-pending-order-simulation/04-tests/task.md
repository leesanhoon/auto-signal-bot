# Task 04 — Unit tests cho pending-order simulation

Owner: worker
Files được phép sửa: `tests/charts/setup-backtest.test.ts` (chỉ file này)
Phụ thuộc: 01-pending-order-engine phải đã APPROVED (có `done.md` trong
`tasks/backtest-pending-order-simulation/01-pending-order-engine/`). Nếu chưa,
ghi `blocked.md` và dừng.

Đọc `tasks/backtest-pending-order-simulation/plan.md` phần "4. Tests" trước khi
làm. Đọc toàn bộ `tests/charts/setup-backtest.test.ts` hiện có để hiểu style
fixture (`makeCandles`, `buildImmediateRbCandles`) và giữ đúng convention.

## Mục tiêu

Thêm test cases cho `fillMode = "pending"` trong `runSetupBacktest`, verify đúng
3 hành vi: fill-sau-trigger, invalidation-trước-fill, expiry.

## Các bước thực hiện

1. Đọc kỹ `src/charts/setup-backtest.ts` sau khi subtask 01 đã sửa xong (đọc bản
   mới nhất trên disk, không đoán) để biết chính xác signature
   `runSetupBacktest(candles, pair, timeframe, exitMode, trailBufferR, swingLookback, fillMode, pendingExpiryBars)`
   và shape `report.pendingStats`.

2. Trong `tests/charts/setup-backtest.test.ts`, thêm một `describe("runSetupBacktest — pending fill mode", () => { ... })`
   mới ở cuối file, dùng lại fixture `buildImmediateRbCandles()` (hoặc
   `makeCandles` trực tiếp) làm nền, chỉnh sửa các nến sau breakout để kiểm soát
   chính xác lúc nào entry/SL bị chạm.

3. Test case 1 — "immediate mode không đổi hành vi khi không truyền fillMode":
   - Chạy `runSetupBacktest(candles, pair, tf)` (không truyền fillMode) và
     `runSetupBacktest(candles, pair, tf, "fixed", 0, 3, "immediate")` (truyền
     tường minh) trên cùng bộ candles.
   - Assert 2 kết quả `report.trades` giống hệt nhau (deep equal hoặc so sánh
     từng field entryIndex/entryPrice/outcome).

4. Test case 2 — "pending mode chỉ fill khi giá thực sự chạm entry ở nến sau
   trigger":
   - Dựng fixture: nến trigger breakout tại index N (giống hệt
     `buildImmediateRbCandles`, nơi entry = block high, close phá breakout).
   - Thêm 1-2 nến sau đó KHÔNG chạm entry (high < entry với LONG), rồi 1 nến chạm
     entry (`high >= entry`).
   - Chạy với `fillMode = "pending"`, `pendingExpiryBars = 5` (đủ rộng để không
     hết hạn).
   - Assert: có đúng 1 trade, `trade.entryIndex` là index của nến CHẠM entry
     (không phải nến trigger N), `report.pendingStats.filled === 1`,
     `report.pendingStats.signalsSeen === 1`.

5. Test case 3 — "invalidation: SL chạm trước entry -> cancel, không tạo trade":
   - Dựng fixture tương tự nhưng nến ngay sau trigger có `low <= stopLoss` (với
     LONG) trước khi bất kỳ nến nào chạm entry.
   - Chạy với `fillMode = "pending"`.
   - Assert: `report.trades` rỗng (không tính trade nào từ setup này),
     `report.pendingStats.cancelledBeforeFill === 1`,
     `report.pendingStats.filled === 0`.

6. Test case 4 — "expiry: quá pendingExpiryBars mà chưa chạm entry -> không tạo
   trade":
   - Dựng fixture: các nến sau trigger đều không chạm entry và không chạm SL,
     kéo dài quá `pendingExpiryBars` (dùng `pendingExpiryBars = 2` nhỏ để dễ test).
   - Chạy với `fillMode = "pending"`, `pendingExpiryBars = 2`.
   - Assert: `report.trades` rỗng, `report.pendingStats.expired === 1`.

7. Test case 5 — "cùng nến vừa chạm SL vừa chạm entry -> tính là cancelled, ưu
   tiên invalidation":
   - Dựng 1 nến ngay sau trigger có cả `high >= entry` VÀ `low <= stopLoss`
     (range rộng bao trùm cả 2 mức).
   - Assert: không có trade, `pendingStats.cancelledBeforeFill === 1`,
     `pendingStats.filled === 0`.

8. Chạy `npm run test -- tests/charts/setup-backtest.test.ts` và đảm bảo toàn bộ
   test (cũ + mới) pass.

## Ngoài phạm vi

- Không sửa `src/charts/setup-backtest.ts` hay bất kỳ file nguồn nào — nếu phát
  hiện bug trong logic pending-order khi viết test, KHÔNG tự sửa file nguồn, ghi
  rõ trong `result.md` (hoặc `blocked.md` nếu bug chặn hoàn toàn việc viết test
  hợp lệ) để Lead review và tạo fix task riêng cho 01.
- Không sửa `tests/charts/setup-backtest-queue.test.ts` hay test file khác.

## Acceptance criteria

- `npm run test -- tests/charts/setup-backtest.test.ts` toàn bộ pass, bao gồm
  5 test case mới ở trên cộng với các test case cũ không bị regress.
- `npm run build` pass.

## Ghi kết quả

Viết `tasks/backtest-pending-order-simulation/04-tests/result.md` với danh sách
test case đã thêm, output đầy đủ của lệnh test. Nếu bị chặn hoặc phát hiện bug ở
subtask 01, ghi `blocked.md` mô tả rõ hành vi sai lệch quan sát được.
