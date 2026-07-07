# Task 06 — Tag OHLC cache entries by provider (MEDIUM)

## Vấn đề

`src/charts/ohlc-provider.ts` dùng cache key `${symbol}:${timeframe}`
(hàm `cacheKey`) chung cho cả MetaApi và Twelve Data. Nếu
`TWELVEDATA_API_KEY` được thêm/xóa/tạm thời lỗi giữa các lần deploy/restart
trong lúc cache còn hạn (TTL 5 phút - 6 giờ tùy timeframe), có thể vô tình
trả về candles từ provider KHÁC với provider đang cấu hình hiện tại — không
báo lỗi gì, âm thầm trộn dữ liệu 2 nguồn khác nhau (đặc biệt nghiêm trọng nếu
kết hợp với bug timezone ở task 01, dù task 01 fix rồi thì rủi ro giảm nhưng
vẫn nên tách biệt).

## Yêu cầu

Trong `src/charts/ohlc-provider.ts`:

1. Sửa hàm `cacheKey(symbol, timeframe)` thành nhận thêm tham số `provider`:
   ```ts
   function cacheKey(symbol: string, timeframe: ChartTimeframe, provider: "metaapi" | "twelvedata"): string {
     return `${provider}:${symbol}:${timeframe}`;
   }
   ```

2. Cập nhật TẤT CẢ chỗ gọi `cacheKey(...)` trong `fetchOhlcHistory` để truyền
   đúng provider đang dùng (xác định bằng việc có `TWELVEDATA_API_KEY` hay
   không, đúng logic if/else hiện có trong hàm).

3. Cập nhật `clearOhlcCache`/`invalidateOhlcCache` (export functions) — nếu
   `invalidateOhlcCache(symbol, timeframe)` hiện không nhận provider, cần
   quyết định: hoặc thêm tham số provider (breaking change cho caller), hoặc
   xóa cache entry của CẢ HAI provider cho symbol/timeframe đó (đơn giản hơn,
   không cần sửa call site khác). Chọn cách xóa cả hai (an toàn hơn, ít thay
   đổi call site) trừ khi có lý do cụ thể khác.

## KHÔNG làm

- Không đổi TTL logic (`getCacheTtl`).
- Không đổi cấu trúc `CacheEntry`.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

Test hiện có dùng `clearOhlcCache()`/`invalidateOhlcCache()` giữa các test —
đảm bảo vẫn hoạt động đúng sau khi đổi cache key format. Thêm 1 test mới xác
nhận: fetch qua MetaApi trước, set `TWELVEDATA_API_KEY`, fetch cùng
symbol/timeframe → phải gọi Twelve Data thật (cache miss), không trả nhầm
data cũ từ MetaApi.

## Ghi kết quả

`result.md`: diff, test mới, kết quả build + test.
