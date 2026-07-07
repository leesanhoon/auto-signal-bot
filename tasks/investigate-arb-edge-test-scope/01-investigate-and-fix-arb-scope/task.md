# Task 01 — Điều tra + fix (nếu xác nhận bug) phạm vi edge-test scan trong ARB

## Bối cảnh

`src/charts/setups/arb.ts`, hàm `detectArb`:

```ts
// dòng 56-58
let edgeTestCount = 0;
const testLookback = Math.max(0, range.startIndex - 15);  // <-- tính nhưng không dùng
const levelHigh = range.high;
const levelLow = range.low;

// dòng 62 — vòng lặp thực tế chỉ quét trong phạm vi range đã detect
for (let i = range.startIndex; i < index; i++) {
  ...
}
```

`range` được detect với `windowSizes = [10, 8, 6]` (dòng 27) — tức
`range.startIndex` đến `index-1` chỉ cách nhau tối đa 10 nến. Vòng lặp đếm
`edgeTestCount` chỉ quét đúng trong khoảng đó (6-10 nến) — RẤT hẹp để tìm
được `edgeTestCount === 2` (yêu cầu ở dòng 80-89: phải ≥2 VÀ <3, tức đúng
bằng 2).

`testLookback` (tính `range.startIndex - 15`, tức mở rộng phạm vi quét thêm
15 nến VỀ TRƯỚC so với `range.startIndex`) được tính ra nhưng KHÔNG dùng ở
đâu — nghi vấn đây là ý định gốc bị bỏ sót khi viết code, không phải biến
thừa vô hại.

## Yêu cầu điều tra (làm TRƯỚC khi sửa)

1. Đọc lại toàn bộ `docs/volman-numeric-engine.md` và tài liệu context còn
   lại trong `tasks/` (nếu có) xem có mô tả nào về ý định gốc của ARB's edge
   test — cụ thể là "test biên" nên tính trong phạm vi nào (chỉ trong range
   hiện tại, hay bao gồm cả các lần test TRƯỚC KHI range được compression
   detect chính thức)?

2. So sánh với `rb.ts` và `irb.ts` (2 setup anh em, dùng chung
   `detectCompression`) — chúng có khái niệm "edge test" tương tự không?
   Nếu không, ARB là setup DUY NHẤT có khái niệm này — cần hiểu rõ ý nghĩa
   Volman gốc: "≥2 lần test biên thất bại TRƯỚC breakout thật" — về logic,
   "test biên" nên xảy ra khi giá thử phá biên NHIỀU LẦN trong 1 giai đoạn
   dài hơn cửa sổ compression 6-10 nến (vì bản chất ARB là "range LỚN đã bị
   test nhiều lần" — 1 range chỉ mới hình thành 6-10 nến khó có đủ chỗ chứa
   2 lần test rõ ràng).

3. Dựa trên điều tra, XÁC ĐỊNH rõ: `testLookback` có phải ý định gốc bị bỏ
   sót hay không.

## Yêu cầu sửa (CHỈ làm nếu bước điều tra xác nhận là bug)

Nếu xác nhận: sửa vòng lặp đếm edge-test để quét từ `testLookback` thay vì
`range.startIndex`:

```ts
for (let i = testLookback; i < index; i++) {
  ...
}
```

Cẩn thận: mở rộng phạm vi quét có thể làm tăng `edgeTestCount` vượt quá 3
dễ hơn (dẫn tới bị coi là "range hết hiệu lực" ở dòng 87-90) — kiểm tra kỹ
logic này vẫn hợp lý sau khi mở rộng phạm vi, không tạo ra hiệu ứng phụ (ví
dụ ARB giờ lại KHÔNG BAO GIỜ ra tín hiệu vì luôn đếm được ≥3 edge test).

**NẾU điều tra KHÔNG xác nhận được rõ ràng đây là bug** (ví dụ không tìm
được tài liệu gốc, hoặc thấy code hiện tại có lý do hợp lý khác) — KHÔNG tự
ý sửa, viết `blocked.md` mô tả rõ những gì đã điều tra và tại sao không kết
luận được, để Lead quyết định.

## KHÔNG làm

- Không đổi các threshold khác (`kBlockArb=2.0`, `windowSizes`,
  `edgeTestCount<2`/`>=3` bounds) — CHỈ sửa phạm vi quét (`testLookback` vs
  `range.startIndex`) nếu xác nhận đúng là bug.
- Không đổi `rb.ts`, `irb.ts`, hay setup khác.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts
```

Nếu có sửa code: viết thêm 1 test trong `tests/charts/setups.test.ts` (nhóm
ARB) dựng dữ liệu nến có ≥2 edge-test xảy ra TRƯỚC `range.startIndex` (trong
phạm vi `testLookback`) nhưng KHÔNG có edge-test nào TRONG range — xác nhận
`detectArb` giờ vẫn phát hiện được ARB (trước khi sửa sẽ trả `null`, sau khi
sửa sẽ trả signal hợp lệ).

## Ghi kết quả

`result.md`: kết luận điều tra (có phải bug hay không, dẫn chứng cụ thể),
thay đổi đã làm (nếu có), test mới, kết quả build + test. Hoặc `blocked.md`
nếu không kết luận được.
