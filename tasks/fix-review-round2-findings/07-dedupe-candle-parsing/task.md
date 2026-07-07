# Task 07 — Deduplicate candle-parsing and timeframe-switch logic (LOW)

## Vấn đề

Trong `src/charts/ohlc-provider.ts`, MetaApi và Twelve Data mỗi bên tự viết
1 bản gần giống nhau của:

1. Vòng lặp parse OHLCV từ raw record + validate `Number.isFinite` + skip
   nếu invalid — 2 bản riêng (nhánh MetaApi có fallback `tickVolume`, nhánh
   Twelve Data không có).
2. 3 switch statement riêng biệt trên cùng kiểu `ChartTimeframe`:
   `toMetaApiTimeframe`, `toTwelveDataInterval`, `getTwelveDataIntervalMs` —
   phải sửa đồng bộ cả 3 nếu `ChartTimeframe` thay đổi.

## Yêu cầu

1. Viết 1 hàm dùng chung `parseCandleRow` (hoặc tên tương tự) nhận vào raw
   record + 1 object mô tả cách map field (tên field cho open/high/low/
   close/volume/time, có fallback field cho volume hay không), trả về
   `Candle | null` (null nếu invalid) — dùng chung cho cả 2 vòng lặp parse
   hiện có trong MetaApi và Twelve Data.

2. Với 3 switch statement trên `ChartTimeframe`: KHÔNG bắt buộc gộp thành 1
   hàm duy nhất (2 hàm map sang string khác nhau về mục đích — 1 map sang
   string endpoint MetaApi, 1 map sang string endpoint Twelve Data — gộp có
   thể làm code khó đọc hơn). Chỉ cần đảm bảo `getTwelveDataIntervalMs` (task
   05 đã thêm exhaustiveness check) và các hàm còn lại đều dùng
   `switch` với `default` case ném lỗi rõ ràng khi gặp giá trị chưa xử lý
   (nếu task 05 đã làm việc này cho `getTwelveDataIntervalMs`, chỉ cần áp
   dụng tương tự cho `toMetaApiTimeframe`/`toTwelveDataInterval` nếu chúng
   chưa có `default`).

## KHÔNG làm

- Không đổi bất kỳ giá trị/threshold/mapping nào — CHỈ refactor cấu trúc code,
  hành vi phải giữ nguyên 100%.
- Không gộp 2 hàm map timeframe thành 1 (khác mục đích, khác kiểu trả về).

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

Toàn bộ test hiện có PHẢI pass không đổi gì (refactor không đổi behavior) —
đây là tiêu chí quan trọng nhất để xác nhận refactor an toàn.

## Ghi kết quả

`result.md`: helper mới đã tạo, danh sách chỗ đã thay thế bằng helper, kết
quả build + test (đối chiếu số test pass trước/sau — phải bằng nhau).
