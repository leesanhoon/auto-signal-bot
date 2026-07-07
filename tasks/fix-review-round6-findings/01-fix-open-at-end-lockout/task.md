# Task 01 — Fix trade "open_at_end" khóa vĩnh viễn slot openTrade (HIGH)

## Vấn đề (đã xác nhận)

`src/charts/setup-backtest.ts`, 3 chỗ giải phóng slot `openTrade` (dòng
~101-103, ~154-156, ~212-214) đều yêu cầu `trade.exitIndex !== null` mới
được set `openTrade = null`. Nhưng `scanOutcome` trả `exitIndex: null` khi
outcome là `"open_at_end"` (giá không bao giờ chạm stop/TP của CHÍNH lệnh đó
trong suốt phần dữ liệu còn lại) — điều này có thể xảy ra ở BẤT KỲ đâu trong
dataset (không chỉ gần cuối), ví dụ 1 lệnh BB mở ở nến 40/500 mà giá đi
ngang mãi không chạm stop/TP2 tới hết dữ liệu.

Hậu quả: `canRunFreshDetectors` (dòng ~182, yêu cầu `openTrade === null`)
KHÔNG BAO GIỜ trở lại `true` sau đó — toàn bộ phần backtest còn lại (dù có
setup khác hoàn toàn không liên quan, mức giá khác hẳn) bị khóa, không phát
hiện thêm tín hiệu nào nữa.

## Yêu cầu

Sửa điều kiện giải phóng `openTrade`: khi trade đã "open_at_end" (tức đã
quét hết `candles` mà không tìm thấy outcome), lệnh này CŨNG cần được coi là
"đã xử lý xong" (không còn hoạt động, dù không biết chính xác điểm thoát) —
giải phóng slot ngay tại `index` hiện tại (không phải chờ 1 `exitIndex` không
tồn tại).

Cách sửa cụ thể: đổi điều kiện giải phóng ở cả 3 chỗ thành:
```ts
if (openTrade !== null && openTrade.committed &&
    (openTrade.trade.exitIndex === null || index > openTrade.trade.exitIndex)) {
  openTrade = null;
}
```
Nghĩa là: nếu `exitIndex === null` (open_at_end), giải phóng NGAY (không cần
so sánh `index > exitIndex` vì không có exitIndex để so sánh) — miễn trade đó
đã được "build" xong (đã quét hết `scanOutcome`, tức đã committed).

LƯU Ý: `open_at_end` nghĩa là `scanOutcome` đã quét tới hết `candles` — tại
thời điểm build trade (lúc `buildTrade` được gọi), toàn bộ thông tin đã có
sẵn (không cần đợi thêm dữ liệu). Vì vậy có thể giải phóng `openTrade` NGAY
KHI trade được đánh dấu `open_at_end`, thay vì chờ đến vòng lặp sau — cân
nhắc giải phóng NGAY tại điểm `committed = true` nếu `exitIndex === null`
(kiểm tra logic ở dòng ~152-156 và ~204-214, nơi trade được commit) thay vì
chỉ dựa vào check đầu vòng lặp (dòng ~101-103) — miễn đảm bảo tính nhất quán,
không tạo ra 1 vòng lặp "chờ thêm 1 index rồi mới giải phóng" không cần
thiết.

## KHÔNG làm

- Không đổi `scanOutcome` (giữ nguyên logic hiện có, `open_at_end` vẫn là
  outcome hợp lệ được ghi vào báo cáo).
- Không đổi cách tính `bySetup`/`byPair` trong `computeReport` (đã lọc
  `open_at_end` ra khỏi thống kê win-rate — giữ nguyên).

## Verification

```bash
npm run build
npm run test -- --run
```

**BẮT BUỘC** viết test mới trong `tests/charts/setup-backtest.test.ts` hoặc
`tests/charts/setup-backtest-queue.test.ts`: dựng 1 trade mở sớm trong
dataset mà không bao giờ chạm stop/TP (open_at_end), rồi dựng 1 signal KHÁC
HẲN (khác setup, khác mức giá) xuất hiện SAU đó trong cùng dataset — xác
nhận signal thứ 2 VẪN được phát hiện và tạo thành trade (không bị khóa).

## Ghi kết quả

`result.md`: đoạn code đã sửa, test mới, kết quả build + test.
