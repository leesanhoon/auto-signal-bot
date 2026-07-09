# Task 01: Rolling HTF Context (point-in-time, no look-ahead)

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc.

## Mục tiêu

Thêm hàm thuần tuý `buildRollingHtfContexts` vào `src/charts/smc/smc-htf-context.ts`: với mỗi candle ở khung entry (ví dụ H4), trả về `HtfContext` được tính **chỉ từ các nến HTF (ví dụ D1) đã đóng hoàn toàn tính đến thời điểm đó** — không nhìn trước nến HTF nào chưa đóng.

## Vị trí cần sửa

`src/charts/smc/smc-htf-context.ts` — file đã tồn tại từ task `smc-topdown-htf-architecture`, hiện có `getHtfTimeframeFor`, `computeHtfContextFromCandles`, `buildHtfContext`, type `HtfContext`. **Không sửa 3 hàm này** — chỉ thêm hàm mới.

## Việc cần làm

1. Thêm map hằng số interval (ms) cho từng timeframe — **KHÔNG import từ `ohlc-provider.ts`** vì `intervalMs`/`TIMEFRAME_CONFIG` không được export ở đó (đã kiểm tra, chỉ export `Candle`, `toTwelveDataSymbol`, `fetchOhlcHistory`, `clearOhlcCache`, `invalidateOhlcCache`). Định nghĩa local trong file này:

```ts
const TIMEFRAME_INTERVAL_MS: Record<ChartTimeframe, number> = {
  M15: 15 * 60 * 1000,
  M30: 30 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
};
```

2. Thêm hàm:

```ts
/**
 * Với mỗi candle trong `entryCandles`, tính HtfContext chỉ từ các nến HTF
 * đã đóng hoàn toàn tính đến thời điểm candle đó — tránh look-ahead bias.
 * Yêu cầu cả 2 mảng đã sắp xếp theo `time` tăng dần (đúng theo cách
 * `fetchOhlcHistory` trả về).
 */
export function buildRollingHtfContexts(
  htfTimeframe: ChartTimeframe,
  htfCandles: Candle[],
  entryCandles: Candle[],
): (HtfContext | null)[] {
  const intervalMs = TIMEFRAME_INTERVAL_MS[htfTimeframe];
  const results: (HtfContext | null)[] = new Array(entryCandles.length).fill(null);

  let htfBoundary = 0;
  let cachedContext: HtfContext | null = null;
  let cachedBoundary = -1;

  for (let i = 0; i < entryCandles.length; i += 1) {
    const entryTime = entryCandles[i].time;
    while (
      htfBoundary < htfCandles.length &&
      htfCandles[htfBoundary].time + intervalMs <= entryTime
    ) {
      htfBoundary += 1;
    }

    if (htfBoundary !== cachedBoundary) {
      const closedSlice = htfCandles.slice(0, htfBoundary);
      cachedContext = computeHtfContextFromCandles(htfTimeframe, closedSlice);
      cachedBoundary = htfBoundary;
    }

    results[i] = cachedContext;
  }

  return results;
}
```

3. Giải thích điều kiện đóng nến: nến HTF tại `htfCandles[htfBoundary]` được coi là "đã đóng tính đến `entryTime`" khi `htfCandles[htfBoundary].time + intervalMs <= entryTime` — tức là thời điểm đóng của nến HTF đó (open time + 1 interval) phải xảy ra **trước hoặc đúng lúc** entry candle đó mở ra. Đây là điểm mấu chốt tránh look-ahead: không dùng so sánh `time` thô (`htfCandle.time <= entryTime`) vì nến D1 mở lúc 00:00 cùng ngày với nến H4 lúc 04:00 sẽ bị coi là "đã có" dù thực tế nến D1 đó **chưa đóng** (phải đợi đến 24:00 hôm đó).

## Việc KHÔNG được làm

- Không sửa `getHtfTimeframeFor`, `computeHtfContextFromCandles`, `buildHtfContext` đã có.
- Không import gì từ `ohlc-provider.ts` ngoài type `Candle` đã import sẵn.
- Không wire hàm này vào `smc-pipeline.ts`, `smc-backtest.ts`, hay `smc-backtest-runner.ts` — đó là subtask 02.
- Không dùng `find`/`filter` lồng nhau theo kiểu O(n×m) — phải dùng con trỏ tăng dần như mẫu trên.

## Test cần thêm

Trong `tests/charts/smc/smc-htf-context.test.ts`, thêm `describe("buildRollingHtfContexts", ...)`:

1. **Look-ahead test (quan trọng nhất)**: dựng 1 nến HTF (D1) mở lúc `T0`, và 1 entry candle (H4) tại thời điểm `T0 + 2h` (tức là trong cùng ngày, TRƯỚC khi nến D1 đó đóng ở `T0 + 24h`) → assert context tại entry candle đó có `candlesLength === 0` hoặc là `null` (không được dùng nến D1 chưa đóng).
2. Entry candle tại thời điểm `T0 + 24h` (đúng lúc nến D1 đóng) → assert context giờ đã bao gồm nến D1 đó (`candlesLength >= 1`).
3. **Nhiều entry dùng chung context**: 6 entry candle H4 liên tiếp trong cùng 1 ngày D1 (chưa có nến D1 mới đóng thêm) → assert cả 6 context trả về **cùng 1 object reference** hoặc cùng giá trị (chứng minh có cache, không tính lại mỗi lần).
4. Mảng `entryCandles` rỗng → trả về mảng rỗng.
5. Mảng `htfCandles` rỗng → tất cả context trong kết quả đều `null`.
6. Case tổng hợp thực tế hơn: dựng ≥ 15 nến D1 với xu hướng tăng rõ ràng + 40 nến H4 trải dài tương ứng → assert các context ở cuối chuỗi có `bias === "LONG"`, các context ở đầu chuỗi (khi chưa đủ 10 nến D1 đã đóng — do `detectTimeframeBias` yêu cầu tối thiểu 10 nến) có `bias === null` hoặc context `null`.

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm test hiện có.
- Test case 1 (look-ahead) phải pass — đây là điều kiện quan trọng nhất của subtask này.

## Kết quả cần ghi vào `result.md`

- Nội dung hàm mới đã thêm.
- Danh sách test case, giải thích từng case, đặc biệt case look-ahead.
- Output `npm run build` và `npm test`.
- Nếu bị chặn → ghi `blocked.md`.
