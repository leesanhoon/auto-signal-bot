# Task: Bổ sung geometry (mô hình W/M + sóng dẫn) cho SB

## Prerequisite
Task `01-extend-geometry-types` PHẢI đã hoàn thành trước. Đọc `result.md`
của task đó để xác nhận `SetupChartGeometry` đã có field `lines`,
`highlightCandles`, `patternLabel`. Nếu chưa xong, dừng lại và báo
`blocked.md`.

## Objective
Theo tài liệu Bob Volman (`bob_volman_setups.pdf`, mục "3. Second Break"):
> Giá kéo ngược về EMA21 bằng sóng hài hòa; cú phá vỡ đầu tiên đã thất bại,
> tạo mô hình chữ W (2 đáy, cho LONG) / chữ M (2 đỉnh, cho SHORT) quanh
> EMA21. Mua/Bán khi giá phá vỡ lần thứ hai. Dừng lỗ đặt dưới đáy/trên đỉnh
> thứ hai của mô hình W/M.

File `src/charts/setups/sb.ts` có 2 nhánh riêng biệt (LONG và SHORT), MỖI
nhánh có `return { ... }` RIÊNG (không dùng chung 1 điểm return). Cả 2 nhánh
đều **không trả `geometry`**.

Nhiệm vụ: thêm `geometry` vào CẢ 2 object trả về (LONG ở dòng ~141-152,
SHORT ở dòng ~240-251), dùng ĐÚNG biến đã tính sẵn trong mỗi nhánh.

## Instructions

### Nhánh LONG (dòng ~40-152, W-pattern, 2 đáy)

1. Các biến đã có sẵn trong scope tại điểm `return` của nhánh LONG:
   - `firstLowIndex`, `firstLow` — đáy 1
   - `secondLowIndex`, `secondLow` — đáy 2
   - `pullbackStart` (= `swingHighIndex`) — điểm bắt đầu sóng dẫn tới đáy 1
   - `index` (tham số hàm) — nến tín hiệu hiện tại
   - `entry` (= `wHigh`) — đã tính ở trên
   - `candles` (tham số hàm)
   - `kind` = "SB"

2. Trước `return { ... }` của nhánh LONG, thêm:

```ts
    const geometry: SetupChartGeometry = {
      boxes: [],
      markers: [],
      highlightCandles: [
        { index: firstLowIndex, label: "Bottom 1" },
        { index: secondLowIndex, label: "Bottom 2" },
      ],
      lines: [
        {
          points: [
            { index: pullbackStart, price: candles[pullbackStart].close },
            { index: firstLowIndex, price: firstLow },
          ],
          label: "Pullback",
          style: "pullback",
        },
        {
          points: [
            { index: firstLowIndex, price: firstLow },
            { index: secondLowIndex, price: secondLow },
          ],
          label: "W-pattern",
          style: "pattern",
        },
      ],
      patternLabel: {
        index,
        price: entry,
        text: kind,
      },
    };
```

3. Thêm `geometry` vào object trả về của nhánh LONG (sau `ruleTrace: trace,`):

```ts
    return {
      setup: kind,
      pair: ctx.pair,
      timeframe: ctx.timeframe,
      direction: "LONG",
      entry,
      stopLoss,
      takeProfit,
      confidence,
      triggerIndex: index,
      ruleTrace: trace,
      geometry,
    };
```

### Nhánh SHORT (dòng ~153-252, M-pattern, 2 đỉnh)

4. Các biến đã có sẵn trong scope tại điểm `return` của nhánh SHORT:
   - `firstHighIndex`, `firstHigh` — đỉnh 1
   - `secondHighIndex`, `secondHigh` — đỉnh 2
   - `pullbackStartShort` (= `swingLowIndex`) — điểm bắt đầu sóng dẫn tới đỉnh 1
   - `index` (tham số hàm)
   - `entry` (= `wLow`) — đã tính ở trên
   - `candles` (tham số hàm)
   - `kind` = "SB"

5. Trước `return { ... }` của nhánh SHORT, thêm (LƯU Ý: dùng đúng tên biến
   của nhánh SHORT, không copy nhầm biến của nhánh LONG):

```ts
    const geometry: SetupChartGeometry = {
      boxes: [],
      markers: [],
      highlightCandles: [
        { index: firstHighIndex, label: "Top 1" },
        { index: secondHighIndex, label: "Top 2" },
      ],
      lines: [
        {
          points: [
            { index: pullbackStartShort, price: candles[pullbackStartShort].close },
            { index: firstHighIndex, price: firstHigh },
          ],
          label: "Pullback",
          style: "pullback",
        },
        {
          points: [
            { index: firstHighIndex, price: firstHigh },
            { index: secondHighIndex, price: secondHigh },
          ],
          label: "M-pattern",
          style: "pattern",
        },
      ],
      patternLabel: {
        index,
        price: entry,
        text: kind,
      },
    };
```

6. Thêm `geometry` vào object trả về của nhánh SHORT (sau `ruleTrace: trace,`):

```ts
    return {
      setup: kind,
      pair: ctx.pair,
      timeframe: ctx.timeframe,
      direction: "SHORT",
      entry,
      stopLoss,
      takeProfit,
      confidence,
      triggerIndex: index,
      ruleTrace: trace,
      geometry,
    };
```

### Chung cho cả file

7. Thêm import type `SetupChartGeometry` ở đầu file:

```ts
import type { DetectedSignal, DetectionContext, SetupKind, SetupChartGeometry } from "../setup-types.js";
```

8. Chạy `npm run build` để đảm bảo không lỗi TypeScript. Chú ý biến `const
   geometry` được khai báo RIÊNG trong mỗi nhánh (block scope `if/else`) —
   không được khai báo 1 lần dùng chung cho cả 2 nhánh vì tên biến nguồn
   khác nhau giữa LONG/SHORT.

9. Viết test cho cả 2 nhánh (tương tự cách làm ở task `02-ddb-geometry`),
   xác nhận:
   - LONG: `geometry.highlightCandles` có 2 phần tử (`firstLowIndex`,
     `secondLowIndex`), `geometry.lines.length === 2`,
     `geometry.patternLabel.text === "SB"`.
   - SHORT: `geometry.highlightCandles` có 2 phần tử (`firstHighIndex`,
     `secondHighIndex`), `geometry.lines.length === 2`,
     `geometry.patternLabel.text === "SB"`.

## Constraints
- CHỈ sửa `src/charts/setups/sb.ts` (và thêm test mới nếu cần, đặt tại
  `tests/charts/setups/sb.test.ts` nếu chưa có).
- KHÔNG đổi bất kỳ logic detect/gate nào đã có (không đổi điều kiện tìm đáy/
  đỉnh, `isFalseBreak`, `isHarmonicPullback`, look-ahead guard, v.v.).
- KHÔNG đổi giá trị `entry`, `stopLoss`, `takeProfit`, `confidence` ở cả 2
  nhánh.
- KHÔNG trộn biến giữa 2 nhánh (vd không dùng `firstLowIndex` trong nhánh
  SHORT).
- KHÔNG sửa `setup-types.ts` hoặc bất kỳ file setup khác.

## Acceptance Criteria
- [ ] `npm run build` pass không lỗi.
- [ ] Object trả về từ nhánh LONG của `detectSb()` có `geometry` đúng cấu
      trúc như mô tả (2 highlightCandles, 2 lines, patternLabel="SB").
- [ ] Object trả về từ nhánh SHORT của `detectSb()` có `geometry` đúng cấu
      trúc tương ứng (dùng biến nhánh SHORT).
- [ ] Không có logic detect nào bị thay đổi ở cả 2 nhánh.
- [ ] Ghi vào `result.md`: đoạn code đã thêm ở cả 2 nhánh + kết quả chạy
      test/script verify geometry cho cả LONG và SHORT.

## Files to Touch
- `src/charts/setups/sb.ts` — thêm geometry vào CẢ 2 object trả về (LONG và SHORT)
- (tuỳ chọn) `tests/charts/setups/sb.test.ts` — test verify geometry cho cả 2 nhánh
