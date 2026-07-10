# Task 01: Bypass cache cho backtest (fix nhầm lẫn dữ liệu giữa các BACKTEST_BARS khác nhau)

Files được sửa (chỉ 2 file này):
- `src/charts/ohlc-provider.ts`
- `src/charts/smc-backtest-runner.ts`

KHÔNG sửa file nào khác. KHÔNG đổi hành vi mặc định của `fetchOhlcHistory` khi gọi không truyền tham số mới (luồng live `smc-index.ts`, `volman-index.ts` phải không đổi). KHÔNG commit.

## Vấn đề

`src/charts/ohlc-provider.ts`, hàm `cacheKey(symbol, timeframe)` (dòng ~103) không chứa số `bars`. Trong `fetchOhlcHistory` (dòng ~627), nếu cache còn hạn (in-memory hoặc persisted trên disk), hàm trả thẳng `cached.candles` bất kể `bars` được truyền vào là bao nhiêu — nên chạy backtest với `BACKTEST_BARS=500` rồi `BACKTEST_BARS=1000` trong cùng phiên có thể trả về cùng một bộ dữ liệu.

## Giải pháp — thêm option bypassCache, KHÔNG đổi cache key

Không sửa `cacheKey()` hay format cache key hiện có (tránh ảnh hưởng cache production của luồng live). Thay vào đó thêm tham số thứ 4 optional.

### Thay đổi 1 — `src/charts/ohlc-provider.ts`

Sửa signature `fetchOhlcHistory` (dòng ~627):

```ts
export async function fetchOhlcHistory(
  symbol: string,
  timeframe: ChartTimeframe,
  bars: number,
  options?: { bypassCache?: boolean },
): Promise<Candle[] | Error> {
```

Trong thân hàm, thêm `const bypassCache = options?.bypassCache ?? false;` ngay đầu. Sửa 3 chỗ dùng cache:

1. Dòng đọc in-memory cache (`const cached = isCacheEnabled(timeframe) ? cache.get(key) : undefined;`) → thêm điều kiện `!bypassCache`:
   ```ts
   const cached = !bypassCache && isCacheEnabled(timeframe) ? cache.get(key) : undefined;
   ```
2. Block đọc persisted cache (`if (isCacheEnabled(timeframe)) { const persisted = await loadOhlcCandleCache(key); ... }`) → thêm `!bypassCache &&` vào điều kiện `if`.
3. Block ghi cache sau khi fetch xong (`if (isCacheEnabled(timeframe)) { cache.set(...); await saveOhlcCandleCache(...); }`) → thêm `!bypassCache &&` vào điều kiện `if`.

Không đổi gì khác trong file này.

### Thay đổi 2 — `src/charts/smc-backtest-runner.ts`

Tìm 2 chỗ gọi `fetchOhlcHistory(symbol, timeframe, bars)` và `fetchOhlcHistory(symbol, htfTimeframe, 300)` trong hàm `main()`. Thêm tham số thứ 4 `{ bypassCache: true }` vào cả 2 lời gọi.

## Verification (bắt buộc, ghi vào result.md)

```bash
npm run build
npm run test
```

Sau đó verify fix hoạt động — chạy 2 lệnh liên tiếp trong cùng phiên PowerShell, khác `BACKTEST_BARS`, cùng 1 pair (giới hạn thời gian bằng cách tạm không cần chạy hết 72 pairs — chạy full runner bình thường là đủ vì bypassCache áp dụng mọi pair):

```powershell
$env:BACKTEST_TIMEFRAME="M15"; $env:BACKTEST_BARS="300"; npm run backtest:smc
$env:BACKTEST_TIMEFRAME="M15"; $env:BACKTEST_BARS="600"; npm run backtest:smc
```

Ghi vào result.md: 2 summary JSON, xác nhận **số signals/trades khác nhau** giữa 2 lần chạy (bằng chứng bypassCache hoạt động — trước đây 2 lần này ra kết quả giống hệt nhau do dùng chung cache).

Ngoài ra, xác nhận KHÔNG phá vỡ luồng live: đọc code `src/charts/smc-index.ts` xem nó gọi `fetchOhlcHistory` qua đâu (gián tiếp qua chart pipeline) — chỉ cần xác nhận các lời gọi đó vẫn dùng signature 3-argument cũ, không cần sửa gì ở đó, và ghi xác nhận vào result.md.

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục, không đoán.
