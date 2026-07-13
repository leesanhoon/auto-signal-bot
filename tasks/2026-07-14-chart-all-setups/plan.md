# Plan: Chart phải vẽ đủ cả 7 setup Bob Volman + đổi style theo ảnh mẫu

## Overview
User cung cấp `bob_volman_setups.pdf` (quy trình 4 bước: bối cảnh → yếu tố
thuận lợi → 7 setup → entry) và 1 ảnh chart mẫu (nền xám gradient, nến
đen/trắng viền đen, EMA đen, box range chỉ viền không fill, label pattern +
đường chỉ nhỏ). Yêu cầu: chart do bot tự vẽ (`setup-chart-renderer.ts`) phải
thể hiện đúng **tất cả 7 setup** đang chạy, đúng tinh thần tài liệu, và theo
style ảnh mẫu.

## Hiện trạng (đã audit bằng Explore agent + đọc trực tiếp code)

| Setup | File detector | `geometry` hiện có | Cái cần vẽ theo tài liệu |
|---|---|---|---|
| DDB (Double Doji Break) | `src/charts/setups/ddb.ts` | **Không có** | Cụm ≥2 nến doji gần EMA21 + sóng kéo ngược (pullback) dẫn tới cụm doji |
| FB (First Break) | `src/charts/setups/fb.ts` | **Không có** | Sóng kéo ngược hài hòa từ điểm bắt đầu trend tới nến chạm EMA21 (nến tín hiệu) |
| SB (Second Break) | `src/charts/setups/sb.ts` | **Không có** | Mô hình W (LONG) / M (SHORT): 2 đáy/đỉnh + sóng dẫn tới đáy/đỉnh 1 |
| BB (Block Break) | `src/charts/setups/bb.ts` | `boxes:[block]` | Đã có, chỉ cần đổi style vẽ (outline, không fill) |
| RB (Range Break) | `src/charts/setups/rb.ts` | `boxes:[range]` | Đã có, đổi style |
| IRB (Inside Range Break) | `src/charts/setups/irb.ts` | `boxes:[inner,outer]` | Đã có, đổi style (2 box lồng nhau) |
| ARB (Advanced Range Break) | `src/charts/setups/arb.ts` | `boxes:[range], markers:edgeTestMarkers` | Đã có, đổi style |

`src/charts/setup-types.ts:6-17` hiện chỉ định nghĩa `SetupChartGeometry =
{ boxes, markers }` — không có chỗ chứa "đường sóng pullback" (line/polyline)
hay "cụm nến cần highlight" (ví dụ cụm doji). Đây là gap về TYPE cần mở rộng
trước, vì DDB/FB/SB không có cách nào truyền dữ liệu hình học sang renderer
nếu không mở rộng type này.

`setup-chart-renderer.ts:79-192` hiện chỉ đọc `geometry.boxes` (vẽ fill xanh
mờ) và `geometry.markers` (chấm hồng) — không có style giống ảnh mẫu (nền
trắng, nến xanh/đỏ, EMA cam).

## Approach — chia theo lớp, tránh 1 task quá lớn

1. **Mở rộng type geometry** (`setup-types.ts`) để hỗ trợ thêm 2 trường mới,
   giữ nguyên `boxes`/`markers` (không phá BB/RB/ARB/IRB đang chạy):
   - `lines?: Array<{ points: Array<{ index: number; price: number }>; label?: string; style?: "pullback" | "pattern" }>`
     — dùng cho sóng pullback (DDB/FB) và đường nối W/M (SB).
   - `highlightCandles?: Array<{ index: number; label?: string }>`
     — dùng để tô đậm cụm doji (DDB) hoặc điểm đáy/đỉnh W-M (SB).
   - `patternLabel?: { index: number; price: number; text: string }`
     — vị trí đặt label tên setup + đường chỉ nhỏ giống ảnh mẫu, dùng chung
     cho cả 7 setup (thay cho chỉ ghi title góc trái như hiện tại).

2. **Bổ sung geometry cho 3 detector chưa có** (DDB, FB, SB) — dùng chính các
   biến đã có sẵn trong logic detect (không đổi rule/logic phát hiện tín
   hiệu, chỉ thêm bước build + trả `geometry` ở cuối, giống cách BB/RB/ARB/IRB
   đang làm).

3. **Restyle + mở rộng renderer** (`setup-chart-renderer.ts`) để:
   - Đổi bảng màu theo ảnh mẫu: nền xám gradient, nến outline đen (thân
     trắng/đen theo up/down thay vì xanh/đỏ), EMA21 màu đen.
   - Box (`boxes`) vẽ outline-only màu đen, bỏ fill xanh mờ.
   - Vẽ thêm `lines` (sóng pullback / W-M) — nét mảnh, màu riêng dễ phân biệt
     với EMA.
   - Vẽ thêm `highlightCandles` (khoanh nhẹ candle liên quan, ví dụ viền vàng
     quanh cụm doji).
   - Vẽ `patternLabel` — text tên setup (vd "BB", "DDB") kèm đường chỉ nhỏ
     trỏ vào điểm breakout, đặt gần góc trên của box/pattern giống ảnh mẫu.
   - GIỮ NGUYÊN 3 đường Entry/SL/TP hiện có (vẫn cần cho việc thực thi lệnh)
     nhưng đổi màu cho hợp nền xám mới (giữ đỏ=SL, xanh lá=TP, vàng=Entry vì
     đây là quy ước phổ biến, dễ đọc trên nền xám).

## Testing Strategy
- `npm run build` pass sau mỗi subtask.
- Với subtask 02-04 (DDB/FB/SB geometry): Worker viết 1 script/test nhỏ chạy
  detector trên dữ liệu nến mẫu có sẵn trong `tests/` (nếu có fixture) hoặc
  tạo input giả lập tối thiểu, in ra `geometry` để verify field đúng hình
  dạng, không cần verify chính xác giá trị số (vì đó là việc của detector
  logic, đã có sẵn, không đổi).
- Với subtask 05 (renderer): Worker chạy `buildSetupChartSvg()` với input mẫu
  cho từng loại geometry (box, line, highlightCandles, patternLabel) và lưu
  SVG output ra file tạm để kiểm tra bằng mắt (không cần headless screenshot
  thật, chỉ cần SVG string hợp lệ + chứa đúng phần tử mong đợi qua string
  match, vd `svg.includes("<line")`).
- Không cần chạy Playwright thật trong môi trường Worker nếu không có sẵn
  Chromium — verify qua SVG string là đủ cho subtask này.

## Subtasks
| Subtask ID | Description | Owner | Files to Modify | Dependencies | Expected Output |
|------------|-------------|-------|-----------------|--------------|-----------------|
| 01-extend-geometry-types | Thêm `lines`, `highlightCandles`, `patternLabel` vào `SetupChartGeometry` | worker | src/charts/setup-types.ts | None | Type mới, build pass, không phá geometry cũ của BB/RB/ARB/IRB |
| 02-ddb-geometry | Build + trả `geometry` (cụm doji + sóng pullback) cho DDB | worker | src/charts/setups/ddb.ts | 01 | DDB trả `geometry.highlightCandles` (cụm doji) + `geometry.lines` (sóng pullback) + `geometry.patternLabel` |
| 03-fb-geometry | Build + trả `geometry` (sóng pullback tới nến chạm EMA) cho FB | worker | src/charts/setups/fb.ts | 01 | FB trả `geometry.lines` (pullback) + `geometry.patternLabel` |
| 04-sb-geometry | Build + trả `geometry` (2 đáy/đỉnh W-M + sóng dẫn) cho SB (cả 2 nhánh LONG/SHORT) | worker | src/charts/setups/sb.ts | 01 | SB trả `geometry.highlightCandles` (2 điểm đáy/đỉnh) + `geometry.lines` (nối W/M + sóng dẫn) + `geometry.patternLabel` cho cả LONG và SHORT |
| 05-renderer-restyle-and-draw-all | Đổi bảng màu theo ảnh mẫu + vẽ đủ `boxes`/`markers`/`lines`/`highlightCandles`/`patternLabel` cho cả 7 setup | worker | src/charts/setup-chart-renderer.ts | 01, 02, 03, 04 | Chart SVG vẽ đúng style ảnh mẫu, hiển thị đủ hình học cho tất cả 7 setup, build pass |

## Ghi chú tham chiếu tài liệu (để Worker không suy đoán sai khi implement 02-04)
Trích tóm tắt từ `bob_volman_setups.pdf` (đầy đủ hơn trong task.md từng subtask):
- DDB: pullback đơn lẻ (không nằm ngang) → cụm ≥2 doji gần EMA21 → entry phá
  vỡ khỏi cụm doji, SL ở đáy/đỉnh cụm doji.
- FB: pullback hài hòa đầu tiên của trend mới, chạm EMA21 lần đầu → entry
  ngay khi giá quay lại, SL ở đáy/đỉnh sóng pullback.
- SB: pullback hài hòa về EMA21 → phá vỡ lần 1 thất bại → tạo W (LONG)/M
  (SHORT) quanh EMA21 → entry ở lần phá vỡ thứ 2, SL ở đáy/đỉnh thứ 2 của
  W/M.
- Tất cả 7 setup áp dụng đối xứng cho cả 2 chiều LONG/SHORT.
