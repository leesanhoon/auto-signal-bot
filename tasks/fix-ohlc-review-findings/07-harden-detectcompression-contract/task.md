# Task 07 — Harden detectCompression's contract to prevent recurrence (LOW)

## Vấn đề

Bug off-by-one vừa fix (`tasks/fix-volman-compression-bug/01`) chỉ sửa 5 nơi
GỌI `detectCompression` (bb.ts, rb.ts, arb.ts, irb.ts, sb.ts đổi `index`
thành `index - 1`). Bản thân hàm `detectCompression` trong
`src/charts/indicators.ts:170` không có gì thay đổi — JSDoc vẫn chỉ nói
"cửa sổ trượt", không nói rõ `endIndex` PHẢI loại trừ nến breakout/nến hiện
tại đang xét. Không có tên tham số rõ ràng, không có assertion nào ngăn 1
caller thứ 6 trong tương lai (hoặc refactor 1 trong 5 file hiện tại) vô tình
truyền lại `index` thay vì `index - 1`, tái tạo lại đúng bug vừa mất 4 vòng
review + 1 lần chạy backtest thật mới phát hiện ra.

## Yêu cầu

Trong `src/charts/indicators.ts`:

1. Cập nhật JSDoc của `detectCompression` (ngay phía trên function, dòng
   ~163-169) thêm 1 dòng rõ ràng bằng tiếng Việt, ví dụ:
   ```
   * QUAN TRỌNG: `endIndex` phải là nến CUỐI CÙNG của block/range — KHÔNG
   * bao gồm nến đang được kiểm tra breakout. Nếu bạn đang kiểm tra breakout
   * tại `index`, phải truyền `endIndex = index - 1`, nếu không điều kiện
   * `close > block.high` sẽ không bao giờ đúng (block.high đã bao gồm chính
   * candles[index].high).
   ```

2. Cân nhắc đổi tên tham số `endIndex` thành `lastClosedIndex` để tên tự nói
   lên ý nghĩa (rename trong signature + trong toàn bộ 5 call site + trong
   `CompressionWindow` type nếu field đó cũng tên `endIndex`). Nếu rename
   toàn bộ quá rủi ro/tốn công, ít nhất PHẢI làm bước 1 (JSDoc) — rename là
   nice-to-have, không bắt buộc.

3. KHÔNG thêm runtime assertion phức tạp (ví dụ so sánh với 1 "currentIndex"
   truyền thêm vào) — việc đó đòi hỏi đổi signature và tăng rủi ro hơn lợi
   ích ở mức fix này. Chỉ cần JSDoc rõ ràng là đủ cho task này.

## Verification

```bash
npm run build
npm run test -- --run
```

Nếu có rename tham số/field, đảm bảo TypeScript compile clean và toàn bộ test
vẫn pass (rename không đổi behavior).

## Ghi kết quả

`result.md`: đã làm bước nào (JSDoc, có rename hay không), kết quả build +
test.
