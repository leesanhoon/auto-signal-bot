# Task 02 — Restore "skip incomplete candle" filter (CRITICAL)

## Vấn đề (đã xác nhận qua git history)

`git show HEAD:src/charts/ohlc-provider.ts` cho thấy code CŨ có đoạn:
```ts
// Only accept completed candles
if (r.complete === false) continue;
```
trong vòng lặp parse candle. Code hiện tại (sau khi thêm Twelve Data) đã MẤT
đoạn này hoàn toàn — grep `complete` trong file hiện tại ra 0 kết quả.

MetaApi's historical-market-data endpoint thường trả về CẢ nến đang hình
thành (chưa đóng) làm phần tử cuối cùng. Thiếu filter này, các detector
(BB/RB/DD/...) và backtest sẽ chạy trên 1 nến còn đang thay đổi giá trị
high/low/close intra-period → tín hiệu chớp tắt (flicker), backtest không
reproducible giữa các lần chạy.

## Yêu cầu

Trong `src/charts/ohlc-provider.ts`:

1. **Nhánh MetaApi** (vòng lặp parse response, gần chỗ tính `time`, `volume`,
   `open`/`high`/`low`/`close`): thêm lại check bỏ qua nến chưa hoàn thành,
   tương đương code cũ:
   ```ts
   if (r.complete === false) continue;
   ```
   đặt TRƯỚC các check `Number.isFinite`, giữ nguyên vị trí tương đối như code
   cũ (ngay đầu vòng lặp, sau khi cast `r`).

2. **Nhánh Twelve Data** (`fetchFromTwelveData`): Twelve Data time_series
   endpoint không có field `complete` — nhưng cần kiểm tra xem candle cuối
   cùng (mới nhất, đứng đầu mảng `values` do Twelve Data trả newest-first)
   có phải nến đang hình thành hay không. Cách đơn giản: nếu `datetime` của
   candle đầu tiên trong `values` (trước khi sort) có timestamp gần hiện tại
   hơn độ dài 1 interval (ví dụ với H4, nến mới nhất mà `now - candleTime <
   4 giờ` và nến đó chưa "chốt" theo lịch UTC chuẩn của khung giờ), thì loại
   bỏ nến đó. Nếu không chắc chắn cách xác định chính xác, ghi rõ trong
   `result.md` cách bạn tiếp cận và để `blocked.md` nếu cần Lead quyết định
   thêm — KHÔNG bỏ qua yêu cầu này im lặng.

## KHÔNG làm

- Không đổi logic parse OHLC/volume khác.
- Không đổi cache logic.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

Thêm test cho nhánh MetaApi: mock response có 1 candle với `complete: false`
→ xác nhận candle đó KHÔNG xuất hiện trong kết quả trả về.

## Ghi kết quả

`result.md`: đoạn code đã thêm lại, cách xử lý nhánh Twelve Data, test mới,
kết quả build + test.
