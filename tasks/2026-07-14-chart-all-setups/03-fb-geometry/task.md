# Task: Bổ sung geometry (sóng pullback) cho FB

## Prerequisite
Task `01-extend-geometry-types` PHẢI đã hoàn thành trước. Đọc `result.md`
của task đó để xác nhận `SetupChartGeometry` đã có field `lines`,
`highlightCandles`, `patternLabel`. Nếu chưa xong, dừng lại và báo
`blocked.md`.

## Objective
Theo tài liệu Bob Volman (`bob_volman_setups.pdf`, mục "2. First Break"):
> Hồi về đường trung bình bằng sóng kéo ngược hài hòa — đây là pullback đầu
> tiên của xu hướng mới. Mua/Bán ngay khi giá quay trở lại, kỳ vọng cú phá vỡ
> đầu tiên thành công. Dừng lỗ đặt dưới đáy/trên đỉnh sóng kéo ngược.

File `src/charts/setups/fb.ts` hiện detect đúng logic này (sóng pullback từ
`trendStartIndex` đến `index`, tức nến chạm EMA21) nhưng **không trả
`geometry`** — object trả về ở cuối hàm (dòng ~147-158) thiếu field
`geometry`.

Nhiệm vụ: thêm `geometry` vào object trả về, dùng ĐÚNG các biến đã tính sẵn
trong hàm.

## Instructions

1. Mở `src/charts/setups/fb.ts`. Các biến đã có sẵn trong scope tại điểm
   `return` (dòng ~147-158):
   - `trendStartIndex` (number) — index bắt đầu sóng pullback (điểm trend
     mới hình thành)
   - `index` (number, tham số hàm) — nến tín hiệu (chạm EMA21 lần đầu)
   - `direction` ("LONG" | "SHORT")
   - `entry` (number) — đã tính ở trên (dòng ~134)
   - `candles` (Candle[], tham số hàm)
   - `kind` = "FB"

2. Trước `return { ... }`, thêm đoạn build geometry:

```ts
  const geometry: SetupChartGeometry = {
    boxes: [],
    markers: [],
    lines: [
      {
        points: [
          { index: trendStartIndex, price: candles[trendStartIndex].close },
          { index, price: candles[index].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
    patternLabel: {
      index,
      price: entry,
      text: kind,
    },
  };
```

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

4. Thêm import type `SetupChartGeometry` ở đầu file:

```ts
import type { DetectedSignal, DetectionContext, SetupKind, SetupChartGeometry } from "../setup-types.js";
```

5. Chạy `npm run build` để đảm bảo không lỗi TypeScript.

6. Viết 1 test nhỏ (tương tự cách làm ở task `02-ddb-geometry`) gọi
   `detectFb()` với input giả lập tối thiểu, xác nhận:
   - `geometry.lines.length === 1` và `lines[0].points.length === 2`,
     `points[0].index === trendStartIndex`, `points[1].index === index`
   - `geometry.patternLabel.text === "FB"`

## Constraints
- CHỈ sửa `src/charts/setups/fb.ts` (và thêm test mới nếu cần, đặt tại
  `tests/charts/setups/fb.test.ts` nếu chưa có).
- KHÔNG đổi bất kỳ logic detect/gate nào đã có trong hàm (không đổi
  `trendLookback`, điều kiện `touchCount`, `isHarmonicPullback`, v.v.).
- KHÔNG đổi giá trị `entry`, `stopLoss`, `takeProfit`, `confidence`.
- KHÔNG sửa `setup-types.ts` hoặc bất kỳ file setup khác.

## Acceptance Criteria
- [ ] `npm run build` pass không lỗi.
- [ ] Object trả về từ `detectFb()` khi có tín hiệu hợp lệ có field
      `geometry` đúng cấu trúc: `lines` chứa 1 line nối `trendStartIndex` →
      `index`, `patternLabel.text === "FB"`.
- [ ] Không có logic detect nào bị thay đổi.
- [ ] Ghi vào `result.md`: đoạn code đã thêm + kết quả chạy test/script verify
      geometry.

## Files to Touch
- `src/charts/setups/fb.ts` — thêm geometry vào return object
- (tuỳ chọn) `tests/charts/setups/fb.test.ts` — test verify geometry
