# Task 01 — Fix Twelve Data timestamp timezone bug (CRITICAL)

## Vấn đề (đã xác nhận bằng gọi API thật)

`src/charts/ohlc-provider.ts` gọi Twelve Data KHÔNG truyền tham số
`timezone=UTC` trong URL (dòng có
`` `${TWELVEDATA_BASE_URL}?symbol=...&interval=...&outputsize=...&apikey=...` ``).

Đã test trực tiếp: cùng 1 nến EUR/USD H4, không truyền `timezone` trả về
`"datetime":"2026-07-07 19:00:00"`, còn truyền `&timezone=UTC` trả về
`"datetime":"2026-07-07 09:00:00"` — lệch **10 tiếng**, cùng 1 nến (OHLC giống
hệt nhau, chỉ khác nhãn giờ).

Code parse bằng `Date.parse(r.datetime)` — chuỗi Twelve Data trả về dạng
`"2026-07-07 19:00:00"` (không có timezone suffix), nên `Date.parse` sẽ hiểu
theo **giờ local của máy chạy code**, cộng thêm sai lệch múi giờ exchange nữa.

Hậu quả: mọi field `time` của candle từ Twelve Data bị lệch hàng giờ so với
UTC thật, làm hỏng `isTradableWindow` (lọc phiên London/NY 13:00-21:00 UTC
trong `src/charts/indicators.ts`) và mọi logic dựa vào giờ UTC tuyệt đối —
không hề có lỗi/crash nào được báo ra, chỉ âm thầm sai.

## Yêu cầu

Trong `src/charts/ohlc-provider.ts`, hàm `fetchFromTwelveData`:

1. Thêm `&timezone=UTC` vào URL request (biến `url` được build từ
   `TWELVEDATA_BASE_URL`).
2. Xác nhận sau khi thêm, `Date.parse(r.datetime)` parse đúng — vì chuỗi vẫn
   không có timezone suffix (Twelve Data trả `"YYYY-MM-DD HH:mm:ss"` dù có
   `timezone=UTC` hay không, chỉ đổi GIÁ TRỊ giờ chứ không thêm `Z`), cần đảm
   bảo `Date.parse` không tự áp local timezone của máy chạy. Cách an toàn:
   thay `Date.parse(r.datetime)` bằng cách tự parse chuỗi và ép về UTC, ví dụ:
   ```ts
   const time = typeof r.datetime === "string"
     ? Date.parse(r.datetime.replace(" ", "T") + "Z")
     : NaN;
   ```
   (thêm `Z` sau khi đổi space thành `T` để `Date.parse` hiểu là UTC chuẩn
   ISO-8601, thay vì để engine tự đoán theo local time).

## KHÔNG làm

- Không đổi cách parse timestamp của nhánh MetaApi (đã đúng, dùng ISO string
  có `Z` sẵn).
- Không đổi format khác của URL (symbol, interval, outputsize, apikey).

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

Viết thêm 1 test trong `tests/charts/ohlc-provider.test.ts` (nhóm Twelve Data)
xác nhận: mock response có `datetime: "2024-01-01 12:00:00"` thì
`candles[0].time` phải bằng đúng `Date.parse("2024-01-01T12:00:00Z")` (tức
12:00 UTC, không bị dịch theo giờ local máy chạy test).

## Ghi kết quả

`result.md`: dòng đã sửa, test mới thêm, kết quả build + test.
