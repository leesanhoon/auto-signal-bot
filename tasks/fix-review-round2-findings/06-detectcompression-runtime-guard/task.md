# Task 06 — Add lightweight runtime guard to detectCompression (LOW)

## Vấn đề

Bug off-by-one gốc (`endIndex = index` thay vì `index - 1`, khiến BB/RB/ARB/
IRB/SB không bao giờ ra tín hiệu) đã fix ở 5 call site, và JSDoc của
`detectCompression` (`src/charts/indicators.ts:170`) đã được cập nhật giải
thích rõ contract — nhưng KHÔNG có enforcement runtime nào. 1 caller thứ 6
trong tương lai (setup detector mới, hoặc refactor 1 trong 5 file hiện tại)
vẫn có thể vô tình truyền `index` thay vì `index - 1` và tái tạo lại đúng bug
này mà không có gì báo hiệu (không crash, không lỗi test nào tự động phát
hiện trừ khi có test cụ thể nhắm đúng call site đó).

## Yêu cầu

Trong `src/charts/indicators.ts`, hàm `detectCompression`, KHÔNG đổi
signature (giữ risk thấp như quyết định ở fix trước) — nhưng thêm 1 dòng
comment + không cần assertion phức tạp. Thay vào đó, cách hiệu quả hơn với
rủi ro thấp: viết 1 UNIT TEST chuyên biệt trong
`tests/charts/indicators.test.ts` (nếu file này tồn tại, nếu không tạo mới)
xác nhận CHÍNH XÁC hành vi biên đã gây bug trước đây, để nếu ai đó vô tình
gọi sai (dù không phải qua 5 file hiện tại mà qua unit test trực tiếp gọi
`detectCompression`), có 1 test rõ ràng làm tài liệu sống:

```ts
test("breakout candle must be excluded from the window — close can never exceed a window that includes its own high", () => {
  // Dựng nến sao cho candles[index] có close = high = giá trị lớn nhất
  // Gọi detectCompression với endIndex = index (SAI, mô phỏng bug cũ)
  // -> xác nhận block.high >= candles[index].close LUÔN đúng (chứng minh
  //    breakout không bao giờ khả thi nếu gọi sai)
  // Gọi detectCompression với endIndex = index - 1 (ĐÚNG)
  // -> xác nhận block.high không còn bị ràng buộc bởi candles[index],
  //    breakout khả thi
});
```

Mục đích: test này không ngăn được bug ở call site khác, nhưng là tài liệu
sống + cảnh báo sớm nếu ai đó đọc test suite trước khi viết detector mới.

Nếu bạn đánh giá cách trên không đủ giá trị so với công sức, có thể thay thế
bằng: đổi tên tham số `endIndex` trong `detectCompression`'s JSDoc/type thành
rõ ràng hơn nữa (đã làm 1 phần ở fix trước) — nhưng KHÔNG đổi tên biến thực tế
trong code (tránh phải sửa 5+ call site không cần thiết cho task LOW priority
này). Ghi rõ trong `result.md` bạn chọn cách nào.

## KHÔNG làm

- Không đổi signature của `detectCompression` (thêm tham số, đổi kiểu trả
  về...).
- Không thêm runtime `throw`/assertion vào `detectCompression` — hàm này
  được gọi rất nhiều lần trong hot path (mỗi candle × mỗi detector), thêm
  check phức tạp không cần thiết cho mức độ risk LOW của task này.

## Verification

```bash
npm run build
npm run test -- --run
```

## Ghi kết quả

`result.md`: cách đã chọn, test mới (nếu có), kết quả build + test.
