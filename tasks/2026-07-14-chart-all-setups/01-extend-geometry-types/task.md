# Task: Mở rộng SetupChartGeometry để hỗ trợ line/highlight/pattern-label

## Objective
File `src/charts/setup-types.ts` hiện định nghĩa:

```ts
export type ChartMarker = {
  index: number;
  price: number;
  label: string;
};

export type SetupChartGeometry = {
  boxes: CompressionWindow[];
  markers: ChartMarker[];
};
```

Chỉ hỗ trợ vẽ box (hình chữ nhật) và marker (điểm). Nhưng 3 setup DDB/FB/SB
cần vẽ thêm: đường nối nhiều điểm (sóng pullback, mô hình W/M) và các nến cần
tô đậm (cụm doji, đáy/đỉnh W-M). Ngoài ra tất cả 7 setup cần 1 vị trí đặt
label tên setup + đường chỉ nhỏ (giống style TradingView annotation).

Nhiệm vụ: mở rộng type `SetupChartGeometry`, KHÔNG được đổi ý nghĩa hay xóa
`boxes`/`markers` hiện có (BB/RB/ARB/IRB đang phụ thuộc 2 field này).

## Instructions

1. Mở `src/charts/setup-types.ts`.

2. Sửa `SetupChartGeometry` thành (giữ nguyên `boxes`/`markers`, thêm 3 field
   mới đều optional để không phá code cũ):

```ts
export type ChartLinePoint = {
  index: number;   // vị trí trong mảng candles
  price: number;
};

export type ChartLine = {
  points: ChartLinePoint[];   // >= 2 điểm, nối tuần tự bằng đoạn thẳng
  label?: string;             // ví dụ "Pullback", "W-pattern"
  style?: "pullback" | "pattern";  // gợi ý màu/nét vẽ cho renderer
};

export type ChartHighlight = {
  index: number;   // vị trí nến cần tô đậm
  label?: string;  // ví dụ "Doji", "Bottom 2"
};

export type ChartPatternLabel = {
  index: number;   // vị trí gần điểm breakout/tín hiệu
  price: number;   // giá đặt label (thường gần đỉnh/đáy pattern)
  text: string;    // tên setup hiển thị, ví dụ "BB", "DDB", "ARB"
};

export type SetupChartGeometry = {
  /** Box chính (range/block) — BB, RB, ARB dùng 1 box; IRB dùng boxes[0]=inner, boxes[1]=outer. */
  boxes: CompressionWindow[];
  /** Điểm mốc phụ, ví dụ các nến edge-test bị false break (ARB). */
  markers: ChartMarker[];
  /** Đường nối nhiều điểm — sóng pullback (DDB/FB), mô hình W/M (SB). Optional, không set thì không vẽ. */
  lines?: ChartLine[];
  /** Nến cần tô đậm — cụm doji (DDB), đáy/đỉnh W-M (SB). Optional. */
  highlightCandles?: ChartHighlight[];
  /** Vị trí + text label tên setup (kèm đường chỉ nhỏ khi vẽ). Optional — nếu không set, renderer dùng title mặc định như hiện tại. */
  patternLabel?: ChartPatternLabel;
};
```

3. Export các type mới (`ChartLinePoint`, `ChartLine`, `ChartHighlight`,
   `ChartPatternLabel`) — dùng `export type` như các type khác trong file.

4. Chạy `npm run build` để đảm bảo không lỗi TypeScript. Vì `boxes` và
   `markers` không đổi kiểu, và các field mới đều optional, code hiện tại ở
   `bb.ts`, `rb.ts`, `arb.ts`, `irb.ts`, `setup-chart-renderer.ts` phải vẫn
   build pass không cần sửa gì thêm.

## Constraints
- CHỈ sửa `src/charts/setup-types.ts`.
- KHÔNG xóa hoặc đổi kiểu của `boxes: CompressionWindow[]` và
  `markers: ChartMarker[]` — đây là breaking change sẽ phá BB/RB/ARB/IRB.
- KHÔNG sửa bất kỳ file nào khác (không cần sửa `bb.ts`/`rb.ts`/`arb.ts`/
  `irb.ts`/`setup-chart-renderer.ts` ở task này — các task sau sẽ dùng type
  mới).
- Tên field phải đúng chính xác như trên (`lines`, `highlightCandles`,
  `patternLabel`) vì các task 02-05 sẽ dùng đúng tên này.

## Acceptance Criteria
- [ ] `npm run build` pass không lỗi.
- [ ] `SetupChartGeometry` có đủ 5 field: `boxes`, `markers` (bắt buộc, giữ
      nguyên), `lines`, `highlightCandles`, `patternLabel` (optional, mới).
- [ ] Các type mới (`ChartLine`, `ChartHighlight`, `ChartPatternLabel`,
      `ChartLinePoint`) được export.
- [ ] Không có file nào khác bị thay đổi.
- [ ] Ghi vào `result.md`: nội dung đầy đủ của `SetupChartGeometry` sau khi
      sửa + xác nhận build pass.

## Files to Touch
- `src/charts/setup-types.ts` — mở rộng type geometry
