# Task 03 — Gộp 2 khái niệm "dữ liệu cũ" thành 1 nguồn chân lý (LOW)

## Vấn đề

`src/charts/ohlc-provider.ts` hiện có 2 cách tính "dữ liệu có còn mới hay
không" độc lập nhau:

- `shouldSkipLatestCandle` (dòng ~163-167): neo theo timestamp THẬT của nến
  cuối cùng nhận được từ provider (`Date.now() - latestTime < intervalMs`).
- `getCacheExpiryMs`/`getNextCandleCloseMs` (dòng ~147-174): neo theo
  wall-clock boundary tính từ `Date.now()` tại thời điểm ghi cache, KHÔNG
  tham chiếu gì tới dữ liệu nến thực tế vừa fetch được.

Nếu provider trả dữ liệu trễ so với wall-clock (ví dụ nến vừa đóng nhưng
provider mất vài phút mới publish), 2 hàm này có thể tính lệch nhau — không
có 1 nguồn chân lý duy nhất cho "khi nào dữ liệu này sẽ đổi".

## Yêu cầu

Cân nhắc refactor để `getCacheExpiryMs` dùng THAM CHIẾU tới nến cuối cùng
thực tế đã fetch (`candles[candles.length-1].time`) thay vì chỉ dùng
`Date.now()` tại thời điểm ghi cache — ví dụ:

```ts
function getCacheExpiryMs(timeframe: ChartTimeframe, nowMs: number, latestCandleTime: number | null): number {
  if (isForexWeekendClosed(nowMs)) {
    return getNextWeekendReopenMs(nowMs); // (nếu task 01 đã có hàm này)
  }
  const anchor = latestCandleTime ?? nowMs;
  return getNextCandleCloseMs(timeframe, anchor) + CANDLE_CLOSE_BUFFER_MS;
}
```

Gọi hàm này SAU KHI đã parse xong candles (có `candles[candles.length-1].time`),
truyền vào làm `latestCandleTime`. Điều này đảm bảo cache expiry PHẢN ÁNH
đúng nến thật đã nhận được, không chỉ thời điểm gọi API.

**Lưu ý:** đây là task LOW priority, mang tính robustness/architecture — có
thể bỏ qua nếu đánh giá độ phức tạp không đáng so với lợi ích, miễn ghi rõ lý
do trong `result.md`.

## KHÔNG làm

- Không đổi `shouldSkipLatestCandle` — giữ nguyên vai trò lọc nến chưa đóng.
- Không đổi cách gọi 2 provider (Twelve Data, MetaApi).

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

## Ghi kết quả

`result.md`: đã làm hay quyết định bỏ qua (kèm lý do), thay đổi cụ thể nếu
có, kết quả build + test.
