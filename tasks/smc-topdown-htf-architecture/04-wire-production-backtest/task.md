# Task 04: Wire HTF Context vào Production Pipeline và Backtest

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 03 đã approved.**

## Mục tiêu

3 subtask trước đã tạo module `smc-htf-context.ts` và wire tham số `htfContext` xuyên suốt các hàm export của `smc-pipeline.ts`, nhưng **chưa có nơi nào thực sự gọi `buildHtfContext`** — production (`analyzeAllChartsSmc`) và backtest (`runSmcBacktest`/`smc-backtest-runner.ts`) vẫn chạy như cũ, không có HTF context thật. Subtask này nối 2 đầu dây cuối cùng.

## Việc cần làm

### 1. Production: `analyzeAllChartsSmc` trong `src/charts/smc/smc-pipeline.ts`

Vị trí: bên trong `Promise.all(pairs.map(async ({ pair, symbol }) => { ... }))` (khoảng dòng 453-496).

Sau dòng `const fetched = await fetchOhlcHistory(symbol, timeframe, 200);` và kiểm tra lỗi, thêm:

```ts
const htfContext = await buildHtfContext(symbol, timeframe);
```

rồi truyền vào lời gọi `analyzeSmcWindow`:

```ts
const signals = analyzeSmcWindow(fetched, pair, timeframe, htfContext);
```

Import thêm `buildHtfContext` từ `./smc-htf-context.js` ở đầu file.

### 2. Backtest core: `src/charts/smc/smc-backtest.ts`

Thêm tham số optional vào cuối signature `runSmcBacktest`:

```ts
export function runSmcBacktest(
  candles: Candle[],
  pair: string,
  timeframe: ChartTimeframe,
  htfContext?: HtfContext | null,
): SmcBacktestReport {
```

Truyền `htfContext` xuống lời gọi `analyzeSmcSignalsAtIndex` bên trong vòng lặp chính (khoảng dòng 234-236 hiện tại):

```ts
const windowSignals = analyzeSmcSignalsAtIndex(candles, pair, timeframe, index, htfContext);
```

Import thêm `type { HtfContext } from "./smc-htf-context.js"`.

Thêm 1 dòng vào mảng `assumptions` (cả 2 chỗ trả về report trong file — case `candles.length < 30` và `computeReport`) mô tả rõ giới hạn:

```
"HTF context (bias/dealing-range) chỉ tính 1 lần cho toàn bộ giai đoạn backtest, không tính lại theo từng thời điểm lịch sử."
```

### 3. Backtest runner: `src/charts/smc-backtest-runner.ts`

Vị trí: trong vòng lặp `for (const { pair, symbol } of pairs) { ... }` (khoảng dòng 108-134).

Sau `const candles = candlesOrError as Candle[];`, thêm:

```ts
const htfContext = await buildHtfContext(symbol, timeframe);
```

rồi truyền vào `runSmcBacktest`:

```ts
const report = runSmcBacktest(candles, pair, timeframe, htfContext);
```

Import thêm `buildHtfContext` từ `./smc/smc-htf-context.js`.

## Việc KHÔNG được làm

- Không đổi cấu trúc `SmcBacktestReport` (chỉ thêm 1 dòng text vào `assumptions`, không đổi type).
- Không đổi logic `computeReport`, `scanOutcome`, `fillSignal` trong `smc-backtest.ts`.
- Không đổi `smc-backtest-runner.ts` ngoài 2 dòng nêu trên (fetch htfContext + truyền vào `runSmcBacktest`).
- Không thêm cơ chế cache/song song hoá riêng cho việc fetch HTF — dùng thẳng `await` tuần tự như các fetch khác trong file, giữ đơn giản.

## Test cần thêm/sửa

### `tests/charts/smc/smc-pipeline.test.ts`

1. Test `analyzeAllChartsSmc` (mock `fetchOhlcHistory` để trả về đủ dữ liệu cho cả M15 lẫn H4 — mock có thể phân biệt theo tham số `timeframe` truyền vào `fetchOhlcHistory` để trả về bộ candle khác nhau) → assert hàm `buildHtfContext`/`fetchOhlcHistory` được gọi thêm 1 lần với timeframe `"H4"` cho mỗi cặp, và setup trả về phản ánh đúng có HTF context (ví dụ premium/discount hoặc gate hướng theo HTF).
2. Nếu việc mock `analyzeAllChartsSmc` với 2 timeframe khác nhau quá phức tạp trong file test hiện tại, ít nhất phải có 1 test xác nhận `fetchOhlcHistory` được gọi với `"H4"` (bằng `mocks.fetchOhlcHistory.mock.calls`) — không được bỏ qua việc verify HTF thực sự được fetch trong production path.

### `tests/charts/smc/smc-backtest.test.ts` (nếu đã tồn tại — kiểm tra trước khi viết mới)

1. Gọi `runSmcBacktest(candles, pair, timeframe, htfContext)` với `htfContext` giả lập có bias ngược hướng toàn bộ tín hiệu trong `candles` → assert `report.signals` giữ nguyên (vẫn đếm số candidate thô) nhưng `report.overall.trades` giảm hẳn hoặc về 0 (vì bị gate ở tầng pipeline).
2. Gọi không truyền `htfContext` → assert hành vi y hệt trước khi có subtask này (test cũ vẫn pass nguyên trạng — đây là điều kiện bắt buộc, không được sửa test cũ để né).

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm test hiện có.
- `analyzeAllChartsSmc` thực sự gọi `fetchOhlcHistory` với timeframe HTF tương ứng (verify bằng test, không chỉ đọc code).
- `runSmcBacktest`/`smc-backtest-runner.ts` nhận và dùng đúng `htfContext` khi được truyền vào; khi không truyền, hành vi y hệt cũ.

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau cho cả 3 file.
- Test case đã thêm, giải thích.
- Output build/test.
- Nếu bị chặn (ví dụ mock 2-timeframe quá phức tạp trong test hiện tại) → ghi rõ trong `result.md`, đề xuất hướng xử lý để Lead quyết định, không tự ý bỏ qua yêu cầu verify.
