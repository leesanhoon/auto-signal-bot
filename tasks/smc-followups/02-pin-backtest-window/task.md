# Task 02: Pin backtest vào khung thời gian cố định (Binance)

Prerequisite: Task 01 đã xong (bypassCache).
Files được sửa (chỉ 3 file này):
- `src/charts/ohlc-provider.ts`
- `src/charts/smc-backtest-runner.ts`
- `src/charts/chart-types-common.ts` — CHỈ NẾU cần thêm type, kiểm tra trước khi sửa; nếu không cần thì không đụng.

KHÔNG sửa file nào khác. KHÔNG đổi hành vi mặc định khi không set `BACKTEST_END_TIME`. KHÔNG commit.

## Mục tiêu

Cho phép `npm run backtest:smc` nhận biến môi trường `BACKTEST_END_TIME` (chuỗi ISO 8601, ví dụ `2026-07-01T00:00:00Z`). Khi set, backtest lấy N nến kết thúc tại đúng thời điểm đó thay vì "N nến gần nhất tính đến hiện tại" — để 2 lần chạy cùng tham số cho ra kết quả **giống hệt nhau**.

**Phạm vi**: chỉ áp dụng cho symbol Binance (crypto). Với symbol TwelveData (forex/commodity, dùng `OANDA:` hoặc tương tự — kiểm tra hàm `isBinanceSymbol` trong `ohlc-provider.ts` để biết cách phân loại), nếu `BACKTEST_END_TIME` được set thì log 1 dòng warning "Bỏ qua pin window cho {symbol}: chưa hỗ trợ TwelveData" và fetch bình thường (không pin) — KHÔNG cố implement pin cho TwelveData trong task này.

## Thay đổi 1 — `src/charts/ohlc-provider.ts`

Mở rộng `options` param đã thêm ở task 01:

```ts
options?: { bypassCache?: boolean; endTimeMs?: number };
```

Trong `fetchOhlcHistory`, đọc `const endTimeMs = options?.endTimeMs;`. Khi gọi `fetchFromBinance`, truyền thêm `endTimeMs`:

```ts
const result = useBinance
  ? await fetchFromBinance(symbol, timeframe, bars, endTimeMs)
  : await fetchFromTwelveData(symbol, timeframe, bars, twelveDataApiKey!);
```

Nếu `endTimeMs` được set và symbol KHÔNG phải Binance (`!useBinance`), log warning qua `logger` hiện có trong file này (kiểm tra file đã import logger nào, dùng đúng logger đó) rồi tiếp tục gọi `fetchFromTwelveData` như cũ (không truyền endTime).

Sửa signature `fetchFromBinance` (dòng ~397) thêm tham số thứ 4 optional `endTimeMs?: number`. Trong URL build (dòng ~410):

```ts
const url = `${BINANCE_BASE_URL}?symbol=${encodeURIComponent(bnSymbol)}&interval=${interval}&limit=${limit}${endTimeMs ? `&endTime=${endTimeMs}` : ""}`;
```

Lưu ý dòng 472-473 hiện có logic "Drop the still-forming candle (closeTime is in the future)" dùng `nowMs = Date.now()` — khi pin window trong quá khứ, điều kiện `closeTime > nowMs` gần như luôn false (đúng), không cần sửa gì thêm ở đó.

## Thay đổi 2 — `src/charts/smc-backtest-runner.ts`

Thêm hàm parse:

```ts
function parseBacktestEndTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
```

Trong `main()`, đọc `const endTimeMs = parseBacktestEndTime(process.env.BACKTEST_END_TIME);` và log nó cùng `logger.info("SMC backtest starting", ...)` hiện có (thêm field `endTime: process.env.BACKTEST_END_TIME ?? "latest"`).

Truyền `endTimeMs` vào cả 2 lời gọi `fetchOhlcHistory` (LTF và HTF) đã sửa ở task 01, gộp vào object `options`:

```ts
await fetchOhlcHistory(symbol, timeframe, bars, { bypassCache: true, endTimeMs });
```

Với HTF context (`fetchOhlcHistory(symbol, htfTimeframe, 300, ...)`), cũng truyền cùng `endTimeMs` để đảm bảo HTF và LTF cùng pin về một thời điểm (tránh look-ahead ngược — HTF phải dừng cùng lúc hoặc trước LTF).

## Verification (bắt buộc, ghi vào result.md)

```bash
npm run build
npm run test
```

Chạy backtest với cùng `BACKTEST_END_TIME` 2 lần liên tiếp, xác nhận **JSON output giống hệt nhau**:

```powershell
$env:BACKTEST_TIMEFRAME="M15"; $env:BACKTEST_BARS="500"; $env:BACKTEST_END_TIME="2026-07-01T00:00:00Z"
npm run backtest:smc > run1.json
npm run backtest:smc > run2.json
```

So sánh 2 file (có thể dùng `Compare-Object` hoặc đọc field `summary` trong cả 2 và đối chiếu bằng mắt) — ghi kết quả xác nhận giống hệt vào result.md. Xoá `run1.json`/`run2.json` sau khi verify xong (file tạm, không cần giữ).

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục, không đoán.
