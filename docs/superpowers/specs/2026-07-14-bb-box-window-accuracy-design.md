# BB Box Window Accuracy — Design

## Vấn đề

Setup **BB (Block Break)** vẽ box (hỗ trợ/kháng cự nén sát EMA21) dựa trên
`detectCompression()` chạy trong vòng lặp `for (const w of windowSizes)` tại
`src/charts/setups/bb.ts:63-81`, dừng ngay khi tìm thấy window đầu tiên thỏa
`range <= kBlock * ATR14`.

`COMPRESSION_PARAMS.BB.windows` hiện là `[4, 5, 6]` (thứ tự tăng dần). Vì
window nhỏ (ít nến) luôn dễ thỏa điều kiện nén hơn window lớn, vòng lặp gần
như luôn dừng ở `w=4` — box chỉ phản ánh 4 nến gần nhất, không phản ánh vùng
hỗ trợ/kháng cự tích lũy qua nhiều nến hơn như kỳ vọng.

## Thay đổi

Chỉ sửa `src/charts/setups/compression-params.ts`, không đổi
`src/charts/setups/bb.ts` hay `src/charts/indicators.ts`:

- Đổi `BB.windows` từ `[4, 5, 6]` thành thứ tự **giảm dần**
  `[10, 8, 6, 5, 4]`.
- Vì vòng lặp trong `bb.ts` giữ nguyên logic "break ở match đầu tiên", đổi
  thứ tự mảng khiến nó tự động **ưu tiên window lớn nhất (nhiều nến nhất)
  thỏa mãn điều kiện nén trước**, fallback dần xuống window nhỏ hơn nếu
  không có vùng nén rộng hơn thỏa điều kiện.
- `kBlock` giữ nguyên `1.2` cho mọi window trong danh sách. Window lớn hơn
  tự nhiên khó pass hơn (range thực tế tăng theo số nến) — đúng tinh thần
  "nén chặt thật sự", không nới lỏng tiêu chuẩn chỉ để có box to.
- Cập nhật comment trong `compression-params.ts` giải thích thứ tự mới và
  lý do mở rộng thêm window 8, 10 (window gốc 4-6 đã backup-test, giữ
  nguyên; mở rộng thêm để bắt được vùng nén hình thành qua nhiều nến hơn).

## Không đổi

- `detectCompression()`, `classifyCompressionTightness()` trong
  `indicators.ts` — logic tính range/distanceToEma/tightness giữ nguyên.
- Cấu trúc và luồng xử lý của `bb.ts` — chỉ dữ liệu đầu vào (`windows`)
  thay đổi, code không cần sửa.
- `RB.windows`, `IRB_INNER`, `IRB_OUTER`, `ARB.windows` — các setup này
  đang bị tắt tạm thời trong `deterministic-pipeline.ts`, không thuộc
  phạm vi thay đổi này.
- Test hiện có (`tests/charts/setups.test.ts`) không gắn cứng vào window
  cụ thể (4/5/6), nên không cần sửa test song song với thay đổi này —
  nhưng cần bổ sung test mới xác nhận hành vi "ưu tiên window lớn nhất".

## Ngoài phạm vi

Tính năng trendline (nén giữa trendline chéo và EMA21) là một sub-project
riêng, sẽ được brainstorm và viết spec sau khi phần box BB này hoàn tất.

## Xác nhận với người dùng

- Cơ chế chọn window: **ưu tiên window lớn nhất thỏa mãn** (đã duyệt).
- Windows tối đa: mở rộng lên **[4, 5, 6, 8, 10]**, sắp theo thứ tự giảm
  dần khi duyệt: `[10, 8, 6, 5, 4]` (đã duyệt).
- `kBlock`: giữ cố định **1.2** cho mọi window (đã duyệt).
