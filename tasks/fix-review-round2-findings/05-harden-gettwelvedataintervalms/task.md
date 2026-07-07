# Task 05 — Add default case guard to getTwelveDataIntervalMs (MEDIUM)

## Vấn đề

`src/charts/ohlc-provider.ts:193-202`:
```ts
function getTwelveDataIntervalMs(timeframe: ChartTimeframe): number {
  switch (timeframe) {
    case "M15":
      return 15 * 60 * 1000;
    case "H4":
      return 4 * 60 * 60 * 1000;
    case "D1":
      return 24 * 60 * 60 * 1000;
  }
}
```
Không có `default` case, kiểu trả về là `number` (không phải `number | null`).
Hiện tại an toàn vì `ChartTimeframe` chỉ có đúng 3 giá trị, cả 3 đều được xử
lý — nhưng không có gì ngăn hàm này trả `undefined` (silent, không lỗi
compile rõ ràng tùy cấu hình `tsconfig`) nếu `ChartTimeframe` sau này thêm
giá trị mới mà quên cập nhật switch này. `undefined` sẽ làm
`Date.now() - latestTime < intervalMs` tính sai (so sánh với `undefined`
luôn `false`), âm thầm tắt heuristic skip nến chưa đóng cho timeframe mới mà
không có lỗi/cảnh báo nào.

## Yêu cầu

Sửa `getTwelveDataIntervalMs` trong `src/charts/ohlc-provider.ts`:

```ts
function getTwelveDataIntervalMs(timeframe: ChartTimeframe): number {
  switch (timeframe) {
    case "M15":
      return 15 * 60 * 1000;
    case "H4":
      return 4 * 60 * 60 * 1000;
    case "D1":
      return 24 * 60 * 60 * 1000;
    default: {
      const exhaustive: never = timeframe;
      throw new Error(`Timeframe không hỗ trợ trong getTwelveDataIntervalMs: ${exhaustive}`);
    }
  }
}
```

Pattern `const exhaustive: never = timeframe` là TypeScript exhaustiveness
check chuẩn — nếu sau này thêm giá trị mới vào `ChartTimeframe` mà quên xử lý
ở đây, TypeScript sẽ báo lỗi compile ngay (`Type 'X' is not assignable to
type 'never'`), thay vì để runtime âm thầm sai.

LƯU Ý: hàm này được gọi từ trong `fetchFromTwelveData`, một hàm PHẢI trả về
`Error` object thay vì throw (theo quy ước trong `CLAUDE.md`: "Error
handling: return Error objects, không throw — catch ở top level"). Kiểm tra
xem lời gọi `getTwelveDataIntervalMs` có nằm trong khối `try/catch` nào bắt
được throw này và convert thành `return new Error(...)` hay không. Nếu
KHÔNG, cần bọc lại hoặc đổi cách xử lý (ví dụ trả `null` thay vì throw, rồi
caller check null và return Error) — chọn cách nào phù hợp với code xung
quanh, miễn là hàm cấp cao nhất (`fetchOhlcHistory`) vẫn tuân thủ "return
Error, không throw ra ngoài".

## Verification

```bash
npm run build
npm run test -- --run
```

`npm run build` phải pass — xác nhận đây thực sự là exhaustive switch với
kiểu `ChartTimeframe` hiện tại (không có case nào bị bỏ sót gây lỗi compile
`never` giả).

## Ghi kết quả

`result.md`: đoạn code đã sửa, cách xử lý throw/Error đã chọn, kết quả build
+ test.
