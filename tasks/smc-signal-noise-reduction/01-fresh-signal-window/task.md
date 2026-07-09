# Task 01 — Freshness filter cho `analyzeSmcWindow`

## Mục tiêu

`analyzeSmcWindow` hiện quét 20 nến gần nhất và trả về candidate tốt nhất trong cửa sổ, khiến một setup cũ bị báo lại tới ~20 lần chạy liên tiếp. Sửa để chỉ trả về signal có `triggerIndex` nằm trong N nến cuối cùng, N config qua env, default 1.

## Không được làm

- KHÔNG sửa `analyzeSmcSignalsAtIndex`, `collectSmcCandidatesInRange`, `buildSmcCandidatesAtIndex`.
- KHÔNG sửa logic FVG hay confidence (thuộc subtask 02/03).
- KHÔNG refactor, KHÔNG thêm feature ngoài mô tả.

## Thay đổi 1 — `src/charts/chart-config-env.ts`

Thêm getter mới (đặt gần `getConfiguredChartSignalConfidenceThreshold`, hiện ở dòng ~36, theo cùng style):

```ts
/**
 * Số nến cuối cùng mà triggerIndex của signal SMC được coi là "mới".
 * Default 1: chỉ nhận signal trigger tại nến vừa đóng.
 */
export function getConfiguredSmcSignalFreshnessCandles(): number {
  const raw = process.env.SMC_SIGNAL_FRESHNESS_CANDLES?.trim();
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 1;
}
```

## Thay đổi 2 — `src/charts/smc/smc-pipeline.ts`

Hàm `analyzeSmcWindow` (dòng ~374-387) hiện tại:

```ts
export function analyzeSmcWindow(
  candles: ...,
  pair: string,
  timeframe: ChartTimeframe,
  htfContext?: HtfContext | null,
): SmcSignal[] {
  const startIndex = Math.max(4, candles.length - 20);
  const candidates = collectSmcCandidatesInRange(candles, pair, timeframe, startIndex, candles.length - 1, htfContext);

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.confidence - a.confidence || b.triggerIndex - a.triggerIndex);
  return [candidates[0].signal];
}
```

Sửa thành: thêm tham số options thứ 5 `options?: { freshnessCandles?: number }`. Sau khi sort và chọn `candidates[0]`, chỉ trả về signal nếu trigger còn "mới":

```ts
export function analyzeSmcWindow(
  candles: ...,
  pair: string,
  timeframe: ChartTimeframe,
  htfContext?: HtfContext | null,
  options?: { freshnessCandles?: number },
): SmcSignal[] {
  const startIndex = Math.max(4, candles.length - 20);
  const candidates = collectSmcCandidatesInRange(candles, pair, timeframe, startIndex, candles.length - 1, htfContext);

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.confidence - a.confidence || b.triggerIndex - a.triggerIndex);
  const freshnessCandles = options?.freshnessCandles ?? 1;
  const minFreshIndex = candles.length - freshnessCandles;
  if (candidates[0].triggerIndex < minFreshIndex) return [];
  return [candidates[0].signal];
}
```

Trong `analyzeAllChartsSmc` (dòng ~413), chỗ gọi:

```ts
const signals = analyzeSmcWindow(fetched, pair, timeframe, htfContext);
```

sửa thành:

```ts
const signals = analyzeSmcWindow(fetched, pair, timeframe, htfContext, {
  freshnessCandles: getConfiguredSmcSignalFreshnessCandles(),
});
```

và thêm import `getConfiguredSmcSignalFreshnessCandles` từ `../chart-config-env.js`.

## Thay đổi 3 — Tests: `tests/charts/smc/smc-pipeline.test.ts`

Đọc file test hiện có để theo đúng pattern dựng candle fixture, rồi thêm các test case cho `analyzeSmcWindow`:

1. **Trigger tại nến cuối → trả về signal**: fixture có setup trigger tại `candles.length - 1`, gọi với `{ freshnessCandles: 1 }`, expect trả về 1 signal.
2. **Trigger cũ (không nằm trong nến cuối) → trả về []**: fixture có setup trigger ở giữa cửa sổ nhưng KHÔNG có setup tại nến cuối; thêm vài nến "trung tính" (không tạo BOS/CHOCH/FVG) phía sau nến trigger; gọi với `{ freshnessCandles: 1 }`, expect `[]`.
3. **freshnessCandles nới rộng → nhận lại signal cũ**: cùng fixture case 2 nhưng `freshnessCandles` đủ lớn để phủ trigger, expect trả về 1 signal.
4. **Default khi không truyền options**: không truyền options → hành vi như `freshnessCandles: 1`.

Nếu file test hiện có test nào của `analyzeSmcWindow` dựa vào hành vi cũ (nhận signal trigger cũ), cập nhật test đó bằng cách truyền `{ freshnessCandles: 20 }` để giữ nguyên intent, KHÔNG xoá test.

Thêm test cho getter env (nếu đã có file test cho `chart-config-env` thì thêm vào đó; kiểm tra bằng `ls tests/charts/`): default = 1, giá trị hợp lệ được parse, giá trị rác/âm/thập phân → fallback 1.

## Verification

```bash
npm run build
npm run test
```

Cả hai phải pass. Ghi kết quả vào `tasks/smc-signal-noise-reduction/01-fresh-signal-window/result.md`:
- Danh sách file đã sửa
- Output tóm tắt của build + test (số test pass/fail)
- Nếu blocked → ghi `blocked.md`, KHÔNG đoán.
