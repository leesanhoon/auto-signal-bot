# Task 01 — Fix 2 bug cốt lõi: exact-boundary + weekend không neo đúng giờ mở cửa (HIGH)

## Bug 1: `getNextCandleCloseMs` trả về CHÍNH thời điểm hiện tại khi rơi đúng mốc nến

`src/charts/ohlc-provider.ts`, dòng ~147-150:
```ts
function getNextCandleCloseMs(timeframe: ChartTimeframe, fromMs: number): number {
  const intervalMs = getIntervalMs(timeframe);
  return Math.ceil(fromMs / intervalMs) * intervalMs;
}
```

**Đã xác nhận bằng code chạy thật:** khi `fromMs` là bội số CHÍNH XÁC của
`intervalMs` (ví dụ fetch đúng lúc 10:15:00.000 UTC cho M15), `Math.ceil`
trả về CHÍNH `fromMs`, không phải mốc TIẾP THEO (10:30:00). Kết quả:
`getCacheExpiryMs` tính ra `expiresAt = fromMs + 1 phút buffer` thay vì đủ 1
chu kỳ nến — cache gần như hết hạn ngay lập tức. Nếu bot chạy theo lịch cố
định khớp đúng mốc nến (rất tự nhiên với 1 bot dựa trên nến), bug này xảy ra
MỌI LẦN chạy đúng lịch, không phải case hiếm.

### Fix

```ts
function getNextCandleCloseMs(timeframe: ChartTimeframe, fromMs: number): number {
  const intervalMs = getIntervalMs(timeframe);
  const next = Math.ceil(fromMs / intervalMs) * intervalMs;
  return next === fromMs ? next + intervalMs : next;
}
```
(Hoặc cách tương đương: `Math.floor(fromMs / intervalMs) * intervalMs + intervalMs` —
LUÔN trả về mốc lớn hơn `fromMs` một cách nghiêm ngặt, không cần check
riêng.)

## Bug 2: Cache cuối tuần không neo đúng giờ mở cửa lại thật sự

`src/charts/ohlc-provider.ts`, dòng ~169-175:
```ts
function getCacheExpiryMs(timeframe: ChartTimeframe, nowMs: number): number {
  if (isForexWeekendClosed(nowMs)) {
    return nowMs + WEEKEND_CACHE_TTL_MS;  // +6 giờ cố định
  }
  return getNextCandleCloseMs(timeframe, nowMs) + CANDLE_CLOSE_BUFFER_MS;
}
```

`isForexWeekendClosed` (dòng ~152-161) đã BIẾT chính xác mốc mở cửa lại
(Chủ nhật 21:00 UTC — xem điều kiện `day === 0 && hour < 21`), nhưng
`getCacheExpiryMs` chỉ cộng thêm 6 giờ CỐ ĐỊNH kể từ lúc fetch, không quan
tâm mốc mở cửa thật.

**Hậu quả cụ thể:** fetch lúc Chủ nhật 18:00 UTC (vẫn đóng cửa) →
`expiresAt` = Thứ 2 00:00 UTC. Nhưng thị trường mở lại lúc Chủ nhật 21:00
UTC — trong khoảng 21:00 Chủ nhật đến 00:00 Thứ 2 (3 tiếng), hệ thống VẪN
trả về dữ liệu nến CŨ từ trước khi đóng cửa, dù thị trường đã mở và có nến
mới — đúng lúc biến động mạnh nhất trong tuần (giờ mở cửa lại). Đây trực
tiếp đi ngược mục tiêu ban đầu của tính năng cache (không phục vụ dữ liệu
cũ).

### Fix

Viết hàm tính chính xác mốc mở cửa lại tiếp theo, tương tự
`getNextCandleCloseMs`:

```ts
function getNextWeekendReopenMs(fromMs: number): number {
  const date = new Date(fromMs);
  // Tính mốc Chủ nhật 21:00 UTC gần nhất SAU fromMs
  // (tự viết logic dựa theo UTCDay/UTCHours hiện có trong isForexWeekendClosed,
  // đảm bảo xử lý đúng mọi ngày trong tuần — không chỉ riêng lúc đang là
  // Thứ 7 hoặc Chủ nhật, vì hàm này cần đúng cho MỌI fromMs rơi vào khung
  // đóng cửa, bao gồm cả Thứ 6 sau 21:00 UTC)
  ...
}
```

Rồi đổi `getCacheExpiryMs`:
```ts
function getCacheExpiryMs(timeframe: ChartTimeframe, nowMs: number): number {
  if (isForexWeekendClosed(nowMs)) {
    return getNextWeekendReopenMs(nowMs);
  }
  return getNextCandleCloseMs(timeframe, nowMs) + CANDLE_CLOSE_BUFFER_MS;
}
```

Xóa `WEEKEND_CACHE_TTL_MS` nếu không còn dùng.

## KHÔNG làm

- Không đổi `shouldSkipLatestCandle`, `isForexWeekendClosed` (dùng lại logic
  UTCDay/UTCHours đã có, không viết lại từ đầu).
- Không đổi cache key, cache Map structure.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

**BẮT BUỘC** test mới:

1. Test bug 1: mock `Date.now()` rơi ĐÚNG vào 1 mốc nến (ví dụ đúng
   10:15:00.000 UTC cho M15) → xác nhận `expiresAt` được set tới 10:30:00
   (mốc TIẾP THEO), không phải ~10:16:00.

2. Test bug 2: mock thời gian Chủ nhật 18:00 UTC → fetch → xác nhận
   `expiresAt` gần với Chủ nhật 21:00 UTC (giờ mở cửa thật), KHÔNG PHẢI
   Thứ 2 00:00 UTC (18:00 + 6h cũ). Test thêm: mock thời gian ngay sau 21:00
   Chủ nhật (ví dụ 21:05) → fetch → xác nhận cache đã hết hạn/không dùng dữ
   liệu cache cũ trước đó (vì thị trường đã mở).

## Ghi kết quả

`result.md`: code đã sửa, test mới, kết quả build + test.
