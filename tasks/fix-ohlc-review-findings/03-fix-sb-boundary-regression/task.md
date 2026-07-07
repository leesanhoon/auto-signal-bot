# Task 03 — Fix SB false-break boundary regression (HIGH)

## Vấn đề (đã xác nhận bằng cách trace code)

`src/charts/setup-sb-runner.ts:41`:
```ts
const sbIndex = Math.min(signal.triggerIndex + SB_BUILDUP_LOOKAHEAD, currentIndex);
```

`src/charts/deterministic-pipeline.ts:96` luôn gọi
`runSbDetection(candles, signals, lastIndex, ctx)` — tức `currentIndex` trong
production LUÔN LÀ `lastIndex` (nến cuối cùng có sẵn — trường hợp bình thường
khi phân tích real-time).

`src/charts/setups/sb.ts:67` (sau khi fix bug off-by-one ở task trước) check:
```ts
if (newBlock.endIndex <= failedIndex) return null;
```
với `newBlock.endIndex = sbIndex - 1` (vì `detectCompression` giờ nhận
`index - 1`).

Khi false-break được xác nhận chỉ 1-2 nến trước nến cuối cùng của dữ liệu
(tình huống bình thường khi chạy real-time), `sbIndex` bị clamp về
`currentIndex = lastIndex`. Nếu `failedIndex = lastIndex - 1`, thì
`newBlock.endIndex = lastIndex - 1 = failedIndex` → điều kiện
`newBlock.endIndex <= failedIndex` đúng → tín hiệu SB hợp lệ bị loại bỏ NGẦM,
dù trước khi fix off-by-one, cùng input này KHÔNG bị loại (vì lúc đó
`newBlock.endIndex` = `sbIndex` = `lastIndex` > `failedIndex`).

Đây là regression chỉ xảy ra ở biên real-time (không lộ ra khi backtest với
nhiều nến sau, vì batch backtest có `currentIndex` lớn hơn nhiều so với
`triggerIndex`).

## Yêu cầu

Sửa `src/charts/setup-sb-runner.ts`, hàm `runSbDetection`, dòng tính
`sbIndex`:

```ts
const sbIndex = Math.min(signal.triggerIndex + SB_BUILDUP_LOOKAHEAD, currentIndex);
```

Vấn đề gốc: `sbIndex` cần ĐỦ CHỖ để `detectCompression` bên trong `detectSb`
hình thành block mới tại `sbIndex - 1` (không phải `sbIndex`), vì vậy điều
kiện clamp phải đảm bảo `sbIndex - 1 > failedIndex` (khoảng cách tối thiểu 2,
không phải 1, giữa `failedIndex` và `sbIndex`). Sửa thành:

```ts
const sbIndex = Math.min(
  Math.max(signal.triggerIndex + SB_BUILDUP_LOOKAHEAD, signal.triggerIndex + 2),
  currentIndex,
);
```

Hoặc đơn giản hơn — nếu `currentIndex < signal.triggerIndex + 2` (không đủ nến
để hình thành block sau khi trừ 1 cho window), coi như CHƯA ĐỦ DỮ LIỆU và bỏ
qua SB detection ở lần gọi này (không loại bỏ signal gốc vĩnh viễn — có thể
để signal gốc bị drop như hiện tại nếu không đủ điều kiện, nhưng ghi log rõ
ràng "insufficient trailing candles" thay vì để logic tự nhiên trả null im
lặng). Chọn cách nào cũng được miễn là: khi `currentIndex = failedIndex + 1`
(trường hợp boundary vừa nêu), KHÔNG gọi `detectSb` với `sbIndex` sao cho
`newBlock.endIndex <= failedIndex` một cách chắc chắn toán học — tức đảm bảo
`sbIndex >= failedIndex + 2` trước khi gọi, nếu không đủ thì bỏ qua (log
debug) thay vì gọi detectSb với input chắc chắn thất bại.

## Verification

```bash
npm run build
npm run test -- --run
```

Thêm test trong `tests/charts/setup-sb-runner.test.ts` (nếu file tồn tại,
nếu không thì tạo) mô phỏng đúng tình huống boundary: `currentIndex =
triggerIndex + 1` (false-break xác nhận ngay sát nến cuối cùng), xác nhận
hành vi mới (không gọi detectSb với input vô nghĩa, hoặc detectSb được gọi
đúng offset và có thể trả tín hiệu nếu dữ liệu phù hợp).

## Ghi kết quả

`result.md`: cách sửa cụ thể đã chọn, test mới, kết quả build + test.
