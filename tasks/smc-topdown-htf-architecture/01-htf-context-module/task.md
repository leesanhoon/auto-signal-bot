# Task 01: HTF Context Module

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc.

## Mục tiêu

Tạo module mới `src/charts/smc/smc-htf-context.ts` cung cấp "ngữ cảnh khung thời gian lớn hơn" (Higher Timeframe context) cho một cặp giao dịch: bias hướng (LONG/SHORT/null) + dữ liệu swing để tính premium/discount range. Module này **độc lập, chưa wire vào pipeline** — chỉ tạo và test riêng ở subtask này.

## Việc cần làm

1. Tạo file `src/charts/smc/smc-htf-context.ts` với nội dung:

```ts
import type { ChartTimeframe } from "../chart-types.js";
import type { Candle } from "../ohlc-provider.js";
import { fetchOhlcHistory } from "../ohlc-provider.js";
import { findSwingPoints } from "./smc-structure.js";
import { detectTimeframeBias } from "./smc-confluence.js";
import type { SmcDirection, SmcSwingPoint } from "./smc-types.js";

export type HtfContext = {
  timeframe: ChartTimeframe;
  bias: SmcDirection | null;
  swings: SmcSwingPoint[];
  candlesLength: number;
};

/**
 * Map timeframe entry (LTF) sang timeframe HTF tương ứng dùng làm bias/dealing-range.
 * M15 -> H4, H4 -> D1, D1 -> null (không có khung cao hơn cấu hình sẵn).
 */
export function getHtfTimeframeFor(entryTimeframe: ChartTimeframe): ChartTimeframe | null {
  if (entryTimeframe === "M15") return "H4";
  if (entryTimeframe === "H4") return "D1";
  return null;
}

export function computeHtfContextFromCandles(
  timeframe: ChartTimeframe,
  candles: Candle[],
): HtfContext | null {
  if (candles.length === 0) return null;
  const swings = findSwingPoints(candles, { left: 2, right: 2 });
  const bias = detectTimeframeBias(candles);
  return { timeframe, bias, swings, candlesLength: candles.length };
}

export async function buildHtfContext(
  symbol: string,
  entryTimeframe: ChartTimeframe,
  bars = 200,
): Promise<HtfContext | null> {
  const htfTimeframe = getHtfTimeframeFor(entryTimeframe);
  if (!htfTimeframe) return null;

  const candles = await fetchOhlcHistory(symbol, htfTimeframe, bars);
  if (candles instanceof Error) return null;

  return computeHtfContextFromCandles(htfTimeframe, candles);
}
```

2. Hàm `computeHtfContextFromCandles` tách riêng khỏi `buildHtfContext` (phần fetch network) để test không cần mock `fetchOhlcHistory` cho phần logic tính toán chính — chỉ test `buildHtfContext` cần mock.
3. Không thêm field/hàm nào khác ngoài những gì liệt kê ở trên — subtask sau (02, 03, 04) sẽ dùng đúng các export này.

## Việc KHÔNG được làm

- Không sửa `smc-structure.ts`, `smc-confluence.ts`, `smc-liquidity-context.ts` — chỉ import và gọi hàm có sẵn (`findSwingPoints`, `detectTimeframeBias`).
- Không wire file này vào `smc-pipeline.ts` — đó là việc của subtask 02/03/04.
- Không tự thêm cache/rate-limit riêng cho `buildHtfContext` — dùng thẳng `fetchOhlcHistory` đã có sẵn cơ chế retry/rate-limit riêng của nó.

## Test cần thêm

Tạo `tests/charts/smc/smc-htf-context.test.ts`:

1. `getHtfTimeframeFor`:
   - `"M15"` → `"H4"`.
   - `"H4"` → `"D1"`.
   - `"D1"` → `null`.
2. `computeHtfContextFromCandles`:
   - Dựng mảng candle giả có xu hướng tăng rõ ràng (đủ để `detectTimeframeBias` trả về `"LONG"`, tham khảo cách test hiện có dùng cho `detectTimeframeBias` nếu có trong `tests/charts/smc/smc-confluence.test.ts`) → assert `bias === "LONG"`, `swings.length > 0`, `candlesLength` đúng bằng số candle truyền vào.
   - Mảng candle rỗng → assert trả về `null`.
3. `buildHtfContext` (mock `fetchOhlcHistory` từ `../../../src/charts/ohlc-provider.js`, theo đúng pattern `vi.mock` đã dùng trong `tests/charts/smc/smc-pipeline.test.ts`):
   - `entryTimeframe = "M15"` → assert gọi `fetchOhlcHistory` với timeframe `"H4"`.
   - `entryTimeframe = "D1"` → assert **không gọi** `fetchOhlcHistory` (vì `getHtfTimeframeFor` trả `null`), hàm trả về `null` ngay.
   - Mock `fetchOhlcHistory` trả về `Error` → assert `buildHtfContext` trả về `null` (không throw).

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, số test tăng đúng theo các case trên, không giảm test hiện có.
- File mới không có import nào từ `smc-pipeline.ts` (tránh circular dependency).

## Kết quả cần ghi vào `result.md`

- Nội dung file mới đã tạo.
- Danh sách test case, giải thích từng case.
- Output `npm run build` và `npm test`.
- Nếu bị chặn → ghi `blocked.md`.
