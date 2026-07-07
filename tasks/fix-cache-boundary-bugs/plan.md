# Plan — Fix 6 finding từ review cache boundary-aligned

## Context

Tính năng cache-tới-khi-nến-đóng vừa triển khai đúng hướng nhưng có 2 bug
thật (xác nhận độc lập bởi 4 lượt review + tự tay verify bằng code chạy
thật), ảnh hưởng trực tiếp mục tiêu ban đầu (giảm request, không phục vụ dữ
liệu cũ).

## 5 subtask

- `01-fix-exact-boundary-and-weekend-anchor/` — **HIGH**: gộp 2 bug cốt lõi
  (cùng nằm trong `getCacheExpiryMs`/`getNextCandleCloseMs`)
- `02-verify-d1-close-time-assumption/` — **MEDIUM**: xác minh D1 đóng nến
  lúc nào thật sự (UTC midnight hay 21:00-22:00 UTC)
- `03-unify-staleness-concept/` — **LOW**: 2 khái niệm "dữ liệu cũ" khác
  nhau (`shouldSkipLatestCandle` vs `getCacheExpiryMs`) nên gộp thành 1
  nguồn chân lý duy nhất
- `04-add-d1-cache-test/` — **LOW**: D1 chưa có test cache boundary
- `05-fix-stale-test-comment/` — **LOW**: comment cũ nhắc tới TTL đã xóa

## Thứ tự khuyến nghị

01 và 02 có thể làm SONG SONG (độc lập — bug trong 01 xảy ra ở mọi
timeframe bất kể D1 đóng nến lúc nào). Nhưng **04 (test D1) nên đợi 02 xong**
vì cần biết chính xác mốc đóng nến D1 thật sự để viết test đúng — nếu 02 kết
luận D1 cần offset riêng, phải áp dụng offset đó vào code TRƯỚC KHI viết
test 04, nếu không test sẽ dựa trên giả định sai. 03/05 độc lập, làm lúc
nào cũng được.

## Verification chung

```bash
npm run build
npm run test -- --run
```
