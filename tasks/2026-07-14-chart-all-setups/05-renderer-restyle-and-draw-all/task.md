# Task: Restyle renderer theo ảnh mẫu + vẽ đủ geometry cho cả 7 setup

## Prerequisite
Các task `01-extend-geometry-types`, `02-ddb-geometry`, `03-fb-geometry`,
`04-sb-geometry` PHẢI đã hoàn thành trước. Đọc `result.md` của cả 4 task để
xác nhận `SetupChartGeometry` có đủ `boxes`, `markers`, `lines`,
`highlightCandles`, `patternLabel`, và DDB/FB/SB đã trả geometry đúng. Nếu
chưa xong, dừng lại và báo `blocked.md`.

## Objective
User cung cấp 1 ảnh chart mẫu (style TradingView) làm tham chiếu:
- Nền: xám gradient (không phải trắng)
- Nến: outline đen, thân trắng (up) / đen (down) — không phải xanh/đỏ
- Đường EMA21: màu đen (không phải cam)
- Box range/block (BB/RB/ARB/IRB): CHỈ viền đen, KHÔNG fill màu
- Label tên setup (vd "BB"): đặt gần điểm breakout, kèm 1 đường chỉ nhỏ màu
  xanh dương trỏ từ label xuống điểm breakout

File `src/charts/setup-chart-renderer.ts`, hàm `buildSetupChartSvg()` (dòng
79-192) hiện chỉ vẽ: nến xanh/đỏ, EMA cam, box fill xanh mờ, marker chấm
hồng, 3 đường Entry/SL/TP, title chữ đen góc trên trái. KHÔNG đọc
`geometry.lines`, `geometry.highlightCandles`, `geometry.patternLabel` (các
field mới từ task 01) vì chưa được implement.

Nhiệm vụ: đổi style theo ảnh mẫu VÀ vẽ đầy đủ tất cả field trong
`SetupChartGeometry` để cả 7 setup (DDB, FB, SB, BB, RB, ARB, IRB) đều hiển
thị đúng geometry của mình.

## Instructions

### 1. Đổi màu nền (thay dòng 85-88)

Thay `<rect width="900" height="500" fill="white"/>` bằng gradient xám:

```ts
  svg += `<defs><linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#b8bcc4"/>
    <stop offset="100%" stop-color="#8f95a0"/>
  </linearGradient></defs>`;
  svg += `<rect width="900" height="500" fill="url(#bgGrad)"/>`;
```

Và đổi `style="background:white;..."` trong thẻ `<svg>` mở đầu (dòng 85)
thành không set background inline nữa (để gradient rect làm nền).

### 2. Đổi màu nến (sửa đoạn dòng 112-133)

Thay:
```ts
const isUp = candle.close >= candle.open;
const candleColor = isUp ? "#00AA00" : "#AA0000";
const bodyColor = candleColor;
```
thành:
```ts
const isUp = candle.close >= candle.open;
const candleColor = "#000000";
const bodyColor = isUp ? "#FFFFFF" : "#000000";
```
(wick và viền thân luôn đen, chỉ fill thân đổi trắng/đen theo up/down — giữ
nguyên phần code vẽ `<line>` wick và `<rect>` body, chỉ đổi 2 biến màu này).

### 3. Đổi màu EMA21 (sửa dòng 151)

Thay `stroke="#FF8800"` thành `stroke="#000000"` trong dòng vẽ path EMA.

### 4. Đổi style box (sửa đoạn dòng 90-110)

Thay fill mờ xanh dương bằng outline-only đen:

```ts
  if (geometry?.boxes) {
    const boxes = geometry.boxes;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const box = boxes[i];
      const boxStartIndex = box.startIndex - sliceStartIndex;
      const boxEndIndex = box.endIndex - sliceStartIndex;

      const x1 = mapXCoord(boxStartIndex, coord);
      const x2 = mapXCoord(boxEndIndex, coord);
      const y1 = mapYCoord(box.high, coord);
      const y2 = mapYCoord(box.low, coord);

      svg += `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(
        x2 - x1,
      )}" height="${Math.abs(y2 - y1)}" fill="none" stroke="#000000" stroke-width="1.5"/>`;
    }
  }
```
(chỉ đổi `fill`/`stroke` của `<rect>`, giữ nguyên phần tính toán tọa độ).

### 5. Vẽ `geometry.lines` (thêm mới, đặt sau đoạn vẽ EMA21, trước đoạn vẽ markers)

```ts
  if (geometry?.lines) {
    for (const line of geometry.lines) {
      if (line.points.length < 2) continue;
      const color = line.style === "pattern" ? "#1E5AFF" : "#555555";
      let path = "M";
      line.points.forEach((p, i) => {
        const idx = p.index - sliceStartIndex;
        const x = mapXCoord(idx, coord);
        const y = mapYCoord(p.price, coord);
        path += i === 0 ? ` ${x},${y}` : ` L${x},${y}`;
      });
      svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
    }
  }
```

### 6. Vẽ `geometry.highlightCandles` (thêm mới, đặt sau đoạn vẽ candlesticks,
trước đoạn vẽ EMA21 — để nằm dưới EMA nhưng trên nến)

```ts
  if (geometry?.highlightCandles) {
    for (const h of geometry.highlightCandles) {
      const idx = h.index - sliceStartIndex;
      if (idx < 0 || idx >= candles.length) continue;
      const candle = candles[idx];
      const xCenter = mapXCoord(idx, coord);
      const yHigh = mapYCoord(candle.high, coord);
      const yLow = mapYCoord(candle.low, coord);
      svg += `<rect x="${xCenter - 8}" y="${yHigh - 4}" width="16" height="${
        yLow - yHigh + 8
      }" fill="none" stroke="#FFB300" stroke-width="1.5" rx="3"/>`;
    }
  }
```

### 7. Vẽ `geometry.patternLabel` (thêm mới, đặt sau đoạn vẽ Entry/SL/TP
lines, trước dòng vẽ Title cũ)

```ts
  if (geometry?.patternLabel) {
    const idx = geometry.patternLabel.index - sliceStartIndex;
    const x = mapXCoord(idx, coord);
    const y = mapYCoord(geometry.patternLabel.price, coord);
    const labelX = x + 20;
    const labelY = y - 30;
    svg += `<line x1="${labelX + 5}" y1="${labelY + 5}" x2="${x}" y2="${y}" stroke="#1E5AFF" stroke-width="1.5"/>`;
    svg += `<text x="${labelX}" y="${labelY}" font-size="16" font-weight="bold" font-style="italic" fill="#000000">${geometry.patternLabel.text}</text>`;
  }
```

### 8. Giữ nguyên phần vẽ `geometry.markers` (dòng 154-166) và Entry/SL/TP
lines (dòng 168-184) KHÔNG đổi — chỉ có thể đổi màu chữ label Entry/SL/TP
(dòng 183, thuộc tính `fill="${line.color}"`) nếu cần tăng độ tương phản với
nền xám mới, nhưng giữ nguyên 3 màu gốc (`#FFFF00` Entry, `#FF0000` SL,
`#00AA00` TP) vì đây là quy ước đã dùng.

### 9. Title góc trên trái (dòng 187): giữ nguyên nếu KHÔNG có
`geometry.patternLabel` (fallback cho setup không set field này); nếu ĐÃ vẽ
`patternLabel` ở bước 7 thì vẫn giữ luôn cả title góc trên trái (không phải
either/or) — 2 thứ phục vụ mục đích khác nhau (title = tên cặp/hướng, pattern
label = tên setup gần điểm breakout).

### 10. Kiểm tra build + verify

- Chạy `npm run build`.
- Viết 1 script/test tạm gọi `buildSetupChartSvg()` với input mẫu chứa đủ
  `boxes`, `markers`, `lines`, `highlightCandles`, `patternLabel` (dùng dữ
  liệu giả lập tối thiểu — không cần dữ liệu thị trường thật), sau đó assert
  SVG string trả về có chứa:
  - `fill="url(#bgGrad)"` (nền gradient)
  - `stroke="#000000"` xuất hiện (nến/EMA/box đen)
  - `stroke-dasharray="3,2"` (line pullback/pattern)
  - `stroke="#FFB300"` (highlight candle)
  - text tên setup từ `patternLabel.text` xuất hiện trong SVG output
- Lưu SVG output ra file tạm (vd
  `tasks/2026-07-14-chart-all-setups/05-renderer-restyle-and-draw-all/sample-output.svg`)
  để có thể mở bằng trình duyệt kiểm tra bằng mắt, đính kèm đường dẫn này vào
  `result.md`.

## Constraints
- CHỈ sửa `src/charts/setup-chart-renderer.ts` (và file test/script tạm nếu
  cần).
- KHÔNG đổi signature của `buildSetupChartSvg()`, `renderSetupChartPng()`,
  `renderSetupChartsBatch()`.
- KHÔNG đổi kích thước canvas (900x500), margin, hay cách tính `CoordMap`
  (`buildCoordMap`, `mapXCoord`, `mapYCoord`) — chỉ đổi phần vẽ (màu sắc,
  thêm phần tử mới).
- KHÔNG xóa phần vẽ `geometry.markers` hoặc Entry/SL/TP lines hiện có.
- Toàn bộ phần vẽ mới (`lines`, `highlightCandles`, `patternLabel`) PHẢI có
  guard `if (geometry?.xxx)` để không lỗi khi setup không set field đó (vd
  BB/RB/ARB/IRB chưa có `lines`/`highlightCandles` — vẫn phải render bình
  thường không lỗi).

## Acceptance Criteria
- [ ] `npm run build` pass không lỗi.
- [ ] Nền SVG dùng gradient xám thay vì trắng.
- [ ] Nến vẽ outline đen, thân trắng/đen theo up/down.
- [ ] EMA21 vẽ màu đen.
- [ ] Box (`geometry.boxes`) vẽ outline-only đen, không fill.
- [ ] `geometry.lines` (nếu có) được vẽ dạng nét đứt.
- [ ] `geometry.highlightCandles` (nếu có) được khoanh viền vàng cam quanh
      nến.
- [ ] `geometry.patternLabel` (nếu có) hiển thị text tên setup kèm đường chỉ
      nhỏ.
- [ ] Setup không có `lines`/`highlightCandles`/`patternLabel` (chưa update ở
      task 02-04, nếu có) vẫn render không lỗi (guard đầy đủ).
- [ ] Entry/SL/TP lines và markers cũ vẫn hoạt động như trước.
- [ ] Ghi vào `result.md`: diff đầy đủ của `setup-chart-renderer.ts`, kết quả
      build, và đường dẫn file SVG mẫu đã lưu để kiểm tra bằng mắt.

## Files to Touch
- `src/charts/setup-chart-renderer.ts` — restyle + vẽ geometry mới
- (tạm) file SVG mẫu để verify bằng mắt, lưu trong thư mục task này
