# Task 03: Wire cache Supabase vào `fetchOhlcHistory` trong `ohlc-provider.ts`

## Bối cảnh

Task 01 tạo bảng `ohlc_candle_cache`, task 02 tạo `src/charts/ohlc-cache-repository.ts` với `saveOhlcCandleCache(cacheKey, candles, expiresAtMs)` và `loadOhlcCandleCache(cacheKey)`. Task này wire 2 hàm đó vào `fetchOhlcHistory` trong `src/charts/ohlc-provider.ts` để cache bền vững qua các lần chạy GitHub Actions (không chỉ trong 1 process).

## Đọc trước khi sửa

Đọc kỹ `src/charts/ohlc-provider.ts`, đặc biệt:
- `isCacheEnabled(timeframe)` (dòng 92-94) — trả `false` cho `D1`. **Không sửa hàm này.**
- `cacheKey(symbol, timeframe)` (dòng 96-98) — format `"${symbol}:${timeframe}"`.
- `getCacheExpiryMs(timeframe, nowMs, latestCandleTime)` (dòng 202-216) — tính thời điểm hết hạn cache.
- `fetchOhlcHistory` (dòng 371-403) — hàm cần sửa.

Nội dung hiện tại của `fetchOhlcHistory`:

```typescript
export async function fetchOhlcHistory(
  symbol: string,
  timeframe: ChartTimeframe,
  bars: number,
): Promise<Candle[] | Error> {
  const twelveDataApiKey = process.env.TWELVEDATA_API_KEY?.trim();
  if (!twelveDataApiKey) {
    return new Error("TWELVEDATA_API_KEY chua cau hinh");
  }

  const key = cacheKey(symbol, timeframe);
  const cached = isCacheEnabled(timeframe) ? cache.get(key) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.candles.slice();
  }

  const result = await fetchFromTwelveData(
    symbol,
    timeframe,
    bars,
    twelveDataApiKey,
  );
  if (result instanceof Error) return result;
  if (isCacheEnabled(timeframe)) {
    const latestCandleTime =
      result.length > 0 ? result[result.length - 1].time : null;
    cache.set(key, {
      candles: result.slice(),
      expiresAt: getCacheExpiryMs(timeframe, Date.now(), latestCandleTime),
    });
  }
  return result;
}
```

## Việc cần làm

1. Thêm import ở đầu file: `import { loadOhlcCandleCache, saveOhlcCandleCache } from "./ohlc-cache-repository.js";`

2. Sửa `fetchOhlcHistory` thành:

```typescript
export async function fetchOhlcHistory(
  symbol: string,
  timeframe: ChartTimeframe,
  bars: number,
): Promise<Candle[] | Error> {
  const twelveDataApiKey = process.env.TWELVEDATA_API_KEY?.trim();
  if (!twelveDataApiKey) {
    return new Error("TWELVEDATA_API_KEY chua cau hinh");
  }

  const key = cacheKey(symbol, timeframe);
  const cached = isCacheEnabled(timeframe) ? cache.get(key) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.candles.slice();
  }

  if (isCacheEnabled(timeframe)) {
    const persisted = await loadOhlcCandleCache(key);
    if (persisted) {
      cache.set(key, { candles: persisted.candles.slice(), expiresAt: persisted.expiresAtMs });
      return persisted.candles.slice();
    }
  }

  const result = await fetchFromTwelveData(
    symbol,
    timeframe,
    bars,
    twelveDataApiKey,
  );
  if (result instanceof Error) return result;
  if (isCacheEnabled(timeframe)) {
    const latestCandleTime =
      result.length > 0 ? result[result.length - 1].time : null;
    const expiresAt = getCacheExpiryMs(timeframe, Date.now(), latestCandleTime);
    cache.set(key, {
      candles: result.slice(),
      expiresAt,
    });
    await saveOhlcCandleCache(key, result, expiresAt);
  }
  return result;
}
```

Lưu ý: `await saveOhlcCandleCache(...)` được gọi (không "fire and forget") để đảm bảo test có thể chờ và verify được — bản thân hàm này đã fail-silent bên trong (task 02), nên `await` ở đây không thể làm `fetchOhlcHistory` throw hay chậm bất thường (không có retry/timeout dài trong repository).

## Ràng buộc

- KHÔNG sửa `isCacheEnabled`, `cacheKey`, `getCacheExpiryMs`, hay bất kỳ hàm nào khác trong file ngoài `fetchOhlcHistory` và phần import.
- KHÔNG sửa `src/charts/ohlc-cache-repository.ts` (đã xong ở task 02) — nếu thấy cần đổi signature, dừng lại và ghi `blocked.md` thay vì tự sửa.
- D1 (`isCacheEnabled` trả `false`) phải **hoàn toàn không gọi** `loadOhlcCandleCache`/`saveOhlcCandleCache` — giữ đúng hành vi hiện tại (không cache D1 cả in-memory lẫn Supabase).
- Không đổi behavior khi in-memory cache đã hit (dòng đầu `if (cached && cached.expiresAt > Date.now())`) — đường đi đó giữ nguyên 100%, cache Supabase chỉ là **fallback khi in-memory miss**.
- Không thêm log, không thêm metrics, không thêm optimization khác ngoài yêu cầu trên.

## Cách verify

- `npm run build` pass.
- `npm test` pass — đặc biệt các test hiện có trong `tests/charts/ohlc-provider.test.ts` (vd. "keeps H4 cache until the next 4h close boundary plus buffer", "does not cache D1 results yet...") phải tiếp tục pass nguyên trạng. Các test này mock `globalThis.fetch` nhưng KHÔNG mock `src/shared/db.js` — nếu `getDb()` throw khi không có Supabase config trong môi trường test, `loadOhlcCandleCache`/`saveOhlcCandleCache` phải tự nuốt lỗi đó (đã đảm bảo ở task 02 bằng try/catch) để các test này không bị vỡ. Nếu chạy `npm test` mà các test cũ trong `ohlc-provider.test.ts` fail vì lỗi liên quan đến DB/Supabase, đây là bug ở task 02 — ghi rõ vào `blocked.md`, không tự sửa lan sang task 02.

## Output

Ghi kết quả vào `tasks/smc-ohlc-persistent-cache/03-wire-ohlc-provider/result.md`:
- Diff đầy đủ của `src/charts/ohlc-provider.ts`
- Kết quả `npm run build && npm test` (paste output, đặc biệt số lượng test pass/fail)

Nếu bị chặn → ghi `blocked.md` với chi tiết lỗi cụ thể.
