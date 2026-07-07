# Task 01 — Cache OHLC tới đúng thời điểm nến kế tiếp đóng

## File liên quan

`src/charts/ohlc-provider.ts` — đọc kỹ toàn bộ file trước khi sửa, đặc biệt:
- `TIMEFRAME_CONFIG` (dòng ~65-84) — hiện có field `cacheTtlMs`
- `getCacheTtl` (dòng ~92-94)
- `cache.set(key, { candles, expiresAt: Date.now() + getCacheTtl(timeframe) })`
  — 2 chỗ dùng (nhánh Twelve Data dòng ~399, nhánh MetaApi dòng ~465-468)
- `isForexWeekendClosed` (dòng ~153-162) — ĐÃ CÓ SẴN, dùng lại được
- `shouldSkipLatestCandle` (dòng ~164-168) — logic loại nến chưa đóng, liên
  quan trực tiếp tới yêu cầu này

## Yêu cầu

### 1. Viết hàm tính thời điểm nến TIẾP THEO đóng

```ts
function getNextCandleCloseMs(timeframe: ChartTimeframe, fromMs: number): number {
  const intervalMs = getIntervalMs(timeframe);
  // Nến được coi là "đóng" tại các mốc thời gian UTC chia hết cho intervalMs
  // (M15: 00,15,30,45 phút mỗi giờ; H4: 00:00,04:00,08:00,...UTC; D1: 00:00 UTC)
  return Math.ceil(fromMs / intervalMs) * intervalMs;
}
```

Lưu ý: `Date.now()` trả về epoch ms kể từ 1970-01-01 UTC — chia hết cho
`intervalMs` (15 phút / 4 giờ / 24 giờ, tất cả tính bằng ms) sẽ tự động cho
ra đúng các mốc UTC chuẩn (00:00, 00:15, 00:30... cho M15; 00:00, 04:00,
08:00... cho H4 vì epoch bắt đầu đúng 00:00 UTC 1970-01-01, chia hết cho
4h). Không cần tính thủ công giờ/phút UTC.

### 2. Thêm buffer cho độ trễ dữ liệu từ provider

Sau khi nến đóng, provider (MetaApi/Twelve Data) có thể mất vài giây tới vài
phút để dữ liệu nến mới thực sự sẵn sàng qua API. Thêm 1 buffer nhỏ để tránh
cache hết hạn đúng lúc gọi API mà provider chưa kịp cập nhật (dẫn tới lấy lại
dữ liệu CŨ y hệt, tốn request vô ích):

```ts
const CANDLE_CLOSE_BUFFER_MS = 60 * 1000; // 1 phút, chờ provider cập nhật dữ liệu
```

`expiresAt = getNextCandleCloseMs(timeframe, Date.now()) + CANDLE_CLOSE_BUFFER_MS`

### 3. Xử lý case cuối tuần thị trường đóng cửa

Nếu hiện tại đang trong khung cuối tuần (`isForexWeekendClosed(Date.now())`
trả `true`), KHÔNG có nến mới nào sẽ đóng cho tới khi thị trường mở cửa lại
— cache nên sống LÂU HƠN (tới lúc thị trường mở cửa lại), không chỉ tới mốc
nến tiếp theo (vì mốc đó sẽ không có dữ liệu mới thật). Cách đơn giản: nếu
đang cuối tuần, đặt `expiresAt` xa hơn (ví dụ 6 giờ, đủ để không gọi lại
liên tục, nhưng vẫn tự kiểm tra lại theo chu kỳ hợp lý — không cần tính
chính xác giờ mở cửa lại, chỉ cần tránh spam gọi API vô ích trong lúc chắc
chắn không có nến mới). Tham khảo `isForexWeekendClosed` đã có sẵn.

### 4. Xóa field `cacheTtlMs` khỏi `TimeframeConfig`/`TIMEFRAME_CONFIG`

Không còn cần thiết vì cache giờ tính theo boundary, không phải TTL cố định.
Cập nhật `getCacheTtl` → xóa hẳn hoặc đổi thành gọi hàm mới
`getNextCandleCloseMs`.

### 5. Cập nhật 2 chỗ `cache.set(...)`

Cả nhánh Twelve Data và MetaApi trong `fetchOhlcHistory`, đổi
`expiresAt: Date.now() + getCacheTtl(timeframe)` thành logic mới (bước 1-3).

## KHÔNG làm

- Không đổi logic `shouldSkipLatestCandle` (loại nến chưa đóng) — giữ
  nguyên, đây là cơ chế RIÊNG, không phải cache expiry.
- Không đổi `clearOhlcCache`/`invalidateOhlcCache` (vẫn hoạt động như cũ,
  cho phép force refresh thủ công).
- Không đổi cách cache key được tạo (`cacheKey`, vẫn theo
  `provider:symbol:timeframe`).

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

**BẮT BUỘC** viết/cập nhật test trong `tests/charts/ohlc-provider.test.ts`:

1. Test cache boundary-aligned: mock `Date.now()` (dùng `vi.setSystemTime`
   hoặc tương đương đã có sẵn cách làm trong file test này) ở 1 thời điểm cụ
   thể GIỮA 2 mốc nến M15 (ví dụ 10:07:00 UTC, giữa mốc 10:00 và 10:15) →
   fetch lần 1 → advance system time tới 10:14:59 (vẫn trước mốc đóng nến kế
   tiếp) → fetch lần 2 → xác nhận CHỈ gọi API 1 lần (cache hit lần 2). Advance
   tiếp tới 10:16:00 (đã qua mốc 10:15 + buffer) → fetch lần 3 → xác nhận gọi
   API lại (cache miss, đúng vì đã sang nến mới).

2. Test tương tự cho H4 (mốc 4 giờ UTC).

3. Test case cuối tuần: mock thời gian trong khung `isForexWeekendClosed` →
   fetch 2 lần cách nhau ngắn (trong cùng khung TTL cũ 5-30 phút mà TRƯỚC
   ĐÂY sẽ hết hạn) → xác nhận vẫn cache hit (không gọi lại API), vì cuối
   tuần không có nến mới.

4. Xóa/cập nhật test cũ đang assert hành vi TTL cố định (nếu có, ví dụ test
   "returns cached data within TTL and re-fetches after TTL expires" — đọc
   lại xem có cần điều chỉnh cho khớp behavior mới).

## Ghi kết quả

`result.md`: hàm mới đã viết, cách xử lý buffer/cuối tuần, test mới/đã sửa,
kết quả build + test.
