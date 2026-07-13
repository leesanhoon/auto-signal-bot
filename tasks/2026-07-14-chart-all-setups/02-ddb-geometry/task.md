# Task: Bổ sung geometry (cụm doji + sóng pullback) cho DDB

## Prerequisite
Task `01-extend-geometry-types` PHẢI đã hoàn thành trước (đọc
`result.md` của task đó để xác nhận `SetupChartGeometry` đã có field
`lines`, `highlightCandles`, `patternLabel`). Nếu chưa xong, dừng lại và báo
`blocked.md`.

## Objective
Theo tài liệu Bob Volman (`bob_volman_setups.pdf`, mục "1. Double Doji
Break"):
> Hồi về bằng sóng kéo ngược hài hòa đơn lẻ đi xuống/lên. Tạo cụm ít nhất 2
> nến doji (thân nhỏ, đuôi dài, biên độ ngắn) nằm gần đường trung bình. Mua/
> Bán khi giá phá vỡ khỏi cụm doji. Dừng lỗ đặt dưới đáy/trên đỉnh cụm doji.

File `src/charts/setups/ddb.ts` hiện detect đúng logic này (cụm doji tại
`dojiStart..index`, sóng pullback tại `pullbackStartIndex..dojiStart-1`)
nhưng **không trả `geometry`** — object trả về ở cuối hàm (dòng ~90-101)
chỉ có `{ setup, pair, timeframe, direction, entry, stopLoss, takeProfit,
confidence, triggerIndex, ruleTrace }`, thiếu field `geometry`.

Nhiệm vụ: thêm `geometry` vào object trả về, dùng ĐÚNG các biến đã tính sẵn
trong hàm (không tính lại, không đổi logic detect).

## Instructions

1. Mở `src/charts/setups/ddb.ts`. Các biến đã có sẵn trong scope tại điểm
   `return` (dòng ~90-101):
   - `dojiStart` (number) — index nến doji đầu tiên trong cụm
   - `index` (number, tham số hàm) — index nến doji cuối cùng (= nến hiện tại)
   - `pullbackStartIndex` (number) — index bắt đầu sóng pullback (trước cụm doji)
   - `direction` ("LONG" | "SHORT")
   - `candles` (Candle[], tham số hàm)
   - `kind` = "DDB"

2. Trước `return { ... }`, thêm đoạn build geometry:

```ts
  const highlightCandles = [];
  for (let i = dojiStart; i <= index; i++) {
    highlightCandles.push({ index: i, label: "Doji" });
  }

  const geometry: SetupChartGeometry = {
    boxes: [],
    markers: [],
    highlightCandles,
    lines: [
      {
        points: [
          { index: pullbackStartIndex, price: candles[pullbackStartIndex].close },
          { index: dojiStart, price: candles[dojiStart].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
    patternLabel: {
      index,
      price: direction === "LONG" ? entry : entry,
      text: kind,
    },
  };
```

   Lưu ý: `entry` đã được tính ở trên trong hàm (dòng ~77) — dùng lại biến
   đó, không tính lại. Với `patternLabel.price`, dùng giá trị `entry` cho cả
   2 hướng (đơn giản, đúng vị trí breakout).

3. Thêm `geometry` vào object trả về:

```ts
  return {
    setup: kind,
    pair: ctx.pair,
    timeframe: ctx.timeframe,
    direction,
    entry,
    stopLoss,
    takeProfit,
    confidence,
    triggerIndex: index,
    ruleTrace: trace,
    geometry,
  };
```

4. Thêm import type `SetupChartGeometry` ở đầu file (dòng import hiện có):

```ts
import type { DetectedSignal, DetectionContext, SetupKind, SetupChartGeometry } from "../setup-types.js";
```

   (giữ nguyên các import khác đã có, chỉ thêm `SetupChartGeometry` vào danh
   sách named import).

5. Chạy `npm run build` để đảm bảo không lỗi TypeScript.

6. Viết 1 test nhỏ (hoặc script tạm trong `tests/` nếu có fixture nến sẵn)
   gọi `detectDdb()` với input giả lập tối thiểu để in ra `geometry`, xác
   nhận:
   - `geometry.highlightCandles.length >= 2`
   - `geometry.lines.length === 1` và `lines[0].points.length === 2`
   - `geometry.patternLabel.text === "DDB"`
   Nếu không có fixture nến sẵn phù hợp để trigger DDB thật, có thể viết unit
   test trực tiếp cho phần build-geometry (mock input tối thiểu đủ để pass
   qua các gate trước đó trong hàm), miễn là verify được cấu trúc `geometry`
   đúng hình dạng.

## Constraints
- CHỈ sửa `src/charts/setups/ddb.ts` (và thêm test mới nếu cần, đặt tại
  `tests/charts/setups/ddb.test.ts` nếu chưa có, theo cấu trúc mirror `src/`).
- KHÔNG đổi bất kỳ logic detect/gate nào đã có (không đổi điều kiện
  `dojiCount < 2`, `distance > 0.3`, `isHarmonic`, v.v.).
- KHÔNG đổi giá trị `entry`, `stopLoss`, `takeProfit`, `confidence` — chỉ
  thêm field `geometry` mới vào object trả về.
- KHÔNG sửa `setup-types.ts` (đã sửa ở task 01) hoặc bất kỳ file setup khác.

## Acceptance Criteria
- [ ] `npm run build` pass không lỗi.
- [ ] Object trả về từ `detectDdb()` khi có tín hiệu hợp lệ có field
      `geometry` đúng cấu trúc: `highlightCandles` chứa toàn bộ nến trong cụm
      doji (`dojiStart` đến `index`), `lines` chứa 1 line nối
      `pullbackStartIndex` → `dojiStart`, `patternLabel.text === "DDB"`.
- [ ] Không có logic detect nào bị thay đổi (entry/stopLoss/takeProfit/
      confidence giữ nguyên giá trị như trước khi sửa).
- [ ] Ghi vào `result.md`: đoạn code đã thêm + kết quả chạy test/script verify
      geometry.

## Files to Touch
- `src/charts/setups/ddb.ts` — thêm geometry vào return object
- (tuỳ chọn) `tests/charts/setups/ddb.test.ts` — test verify geometry
