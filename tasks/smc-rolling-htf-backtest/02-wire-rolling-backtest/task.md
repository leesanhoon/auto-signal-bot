# Task 02: Wire Rolling HTF Context vào Backtest

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 01 đã approved.**

## Mục tiêu

Đổi `runSmcBacktest` từ nhận **1 `HtfContext` tĩnh áp dụng cho cả cửa sổ backtest** sang nhận **1 mảng context theo từng index** (dùng `buildRollingHtfContexts` từ subtask 01). Cập nhật `smc-backtest-runner.ts` để fetch đủ dữ liệu HTF lịch sử và build mảng rolling trước khi gọi.

## Vị trí cần sửa

### 1. `src/charts/smc/smc-backtest.ts`

Hiện tại (dòng 208): `runSmcBacktest(candles, pair, timeframe, htfContext?: HtfContext | null)` — dòng 237 dùng `htfContext` y hệt cho mọi index trong vòng lặp.

Đổi thành:

```ts
export function runSmcBacktest(
  candles: Candle[],
  pair: string,
  timeframe: ChartTimeframe,
  htfContexts?: (HtfContext | null)[],
): SmcBacktestReport {
```

Trong vòng lặp chính (khoảng dòng 234-237), sửa:

```ts
const windowSignals = analyzeSmcSignalsAtIndex(candles, pair, timeframe, index, htfContexts?.[index] ?? null);
```

**Lưu ý quan trọng**: `analyzeSmcSignalsAtIndex` trong `smc-pipeline.ts` **không đổi gì** — vẫn nhận đúng 1 `HtfContext | null` như cũ ở tham số thứ 5. Chỉ có cách `runSmcBacktest` chọn giá trị nào để truyền vào là thay đổi (chọn theo index thay vì dùng chung 1 giá trị).

Cập nhật dòng `assumptions` đã thêm ở task trước (2 chỗ: case `candles.length < 30` và `computeReport`) — sửa nội dung câu đã có:

Từ:
```
"HTF context (bias/dealing-range) chỉ tính 1 lần cho toàn bộ giai đoạn backtest, không tính lại theo từng thời điểm lịch sử."
```

Thành:
```
"HTF context (bias/dealing-range) được tính lại theo từng thời điểm lịch sử (rolling), chỉ dùng nến HTF đã đóng tính đến thời điểm đó — không look-ahead."
```

### 2. `src/charts/smc-backtest-runner.ts`

Vị trí: trong vòng lặp `for (const { pair, symbol } of pairs) { ... }` (khoảng dòng 108-115).

Thay:

```ts
const htfContext = await buildHtfContext(symbol, timeframe);
const report = runSmcBacktest(candles, pair, timeframe, htfContext);
```

bằng:

```ts
const htfTimeframe = getHtfTimeframeFor(timeframe);
let htfContexts: (HtfContext | null)[] | undefined;
if (htfTimeframe) {
  const htfCandlesOrError = await fetchOhlcHistory(symbol, htfTimeframe, 300);
  if (!(htfCandlesOrError instanceof Error)) {
    htfContexts = buildRollingHtfContexts(htfTimeframe, htfCandlesOrError as Candle[], candles);
  }
}
const report = runSmcBacktest(candles, pair, timeframe, htfContexts);
```

Import thêm `getHtfTimeframeFor`, `buildRollingHtfContexts` từ `./smc/smc-htf-context.js` (giữ hoặc bỏ `buildHtfContext` tuỳ có còn dùng — kiểm tra, nếu không còn chỗ nào dùng `buildHtfContext` trong file này thì bỏ import, không để import thừa gây lỗi lint/build).

Số `300` (bars HTF) là mặc định hợp lý để đảm bảo đủ lịch sử D1 cho cửa sổ backtest H4 500 nến (~83 ngày) — nếu `bars` (số nến entry, từ `BACKTEST_BARS` env) lớn hơn mặc định 500 nhiều, cân nhắc tăng số HTF bars tương ứng, nhưng **không bắt buộc phải làm động trong subtask này** — giữ hằng số 300 là đủ, ghi chú trong `result.md` nếu thấy cần cải thiện thêm.

## Việc KHÔNG được làm

- Không đổi `analyzeSmcSignalsAtIndex`, `analyzeSmcWindow`, `buildSmcCandidatesAtIndex`, `analyzeAllChartsSmc` trong `smc-pipeline.ts` — không đụng file này ở subtask này.
- Không đổi `buildHtfContext` (vẫn dùng cho production, không ai xoá).
- Không đổi cấu trúc `SmcBacktestReport` ngoài việc sửa nội dung 2 dòng `assumptions` đã nêu.

## Test cần thêm/sửa

### `tests/charts/smc/smc-backtest.test.ts`

Test cũ từ task trước (dùng `htfContext` đơn — 1 object, không phải mảng) sẽ vỡ vì signature đổi từ `HtfContext | null` sang `(HtfContext | null)[]`. Cập nhật các test sau cho đúng API mới:

1. `"runSmcBacktest passes htfContext to analyzeSmcSignalsAtIndex"` → đổi sang truyền mảng, ví dụ `const htfContexts = candles.map(() => htfContextWithShortBias);`, gọi `runSmcBacktest(candles, "XAUTUSDT", "M15", htfContexts)`, assert `analyzeSmcSignalsAtIndex` được gọi với đúng context tại đúng index (`calls[i][4] === htfContexts[i]`).
2. `"runSmcBacktest backward compatibility: works without htfContext parameter"` → giữ nguyên ý nghĩa (không truyền, hoặc truyền `undefined`/mảng rỗng) vẫn không throw, `analyzeSmcSignalsAtIndex` nhận `null` ở tham số thứ 5 khi không có context cho index đó.
3. `"runSmcBacktest includes HTF context assumption in report"` → cập nhật chuỗi assert cho khớp câu `assumptions` mới ("được tính lại theo từng thời điểm lịch sử (rolling)...").
4. Thêm test mới: mảng `htfContexts` có độ dài **khác** với `candles` (ví dụ ngắn hơn) → assert không throw, các index vượt quá độ dài mảng nhận `null` (dùng `htfContexts?.[index] ?? null`, `undefined` tại index ngoài phạm vi mảng tự nhiên fallback về `null`).

### `src/charts/smc-backtest-runner.ts` — không có test riêng (là entrypoint script), không cần thêm test mới cho file này, chỉ cần `npm run build` pass (kiểm tra type đúng).

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm test hiện có (test cũ được cập nhật hợp lý theo API mới, không bị xoá mà không giải thích).
- `runSmcBacktest` dùng đúng context theo từng index khi được truyền mảng.

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau cho cả 2 file.
- Danh sách test đã sửa/thêm, giải thích rõ vì sao test cũ phải đổi cách gọi (do đổi signature, không phải đổi hành vi).
- Output build/test.
- Nếu bị chặn → ghi `blocked.md`.
