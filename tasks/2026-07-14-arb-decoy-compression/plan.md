# Plan — ARB price values in signal + Advanced Range Break pattern cho toàn bộ setup

## Bối cảnh

User yêu cầu 2 việc, làm rõ qua Q&A với Lead (2026-07-14):

1. **Việc làm ngay được**: ARB hiện tại (`src/charts/setups/arb.ts`) cần thêm **giá trị giá cụ thể**
   (mức "mồi" bị phá vỡ = biên range, giá các lần edge-test, gap) vào nội dung signal gửi Telegram.
   Đây KHÔNG phải redefine lại logic detect ARB — giữ nguyên thuật toán, chỉ bổ sung dữ liệu giá vào
   `ruleTrace` → `reasons` (pipeline có sẵn ở `src/charts/signal-assembly.ts`).

2. **Việc BỊ BLOCK, chưa làm được**: Áp dụng pattern "phá vỡ mồi để lại khoảng trống → nén lại trong
   vùng → phá vỡ lần nữa" cho **toàn bộ setup khác** (BB, RB, IRB, DDB, FB, SB), không chỉ ARB.
   User xác nhận: *"tôi sẽ cấp document cho từng setup"* để định nghĩa chính xác biên "vùng mồi" và
   "vùng nén" — hiện CHƯA có document này. Không được đoán ngưỡng/công thức khi chưa có tài liệu.

## Subtasks

| # | Subtask | Trạng thái | Ghi chú |
|---|---------|-----------|---------|
| 01 | Thêm giá trị giá (mồi/edge-test/gap) vào ARB `ruleTrace` + Telegram message | ✅ Có thể làm ngay (chưa chạy Worker) | `01-arb-price-values-in-signal/task.md` |
| 02 | Thêm giá trị giá hành vi (đáy/đỉnh cụm doji, hộp nén) vào DDB/BB/RB `ruleTrace` | ✅ Có thể làm ngay | Xem `02-ddb-bb-rb-price-values-in-signal/task.md`. SB/IRB đã log đủ, không cần sửa (xem phân tích bên dưới). |

## Cập nhật 2026-07-14: đã nhận document `bob_volman_setups.pdf`

User cấp tài liệu "Bảy Setup Bob Volman" — đây là tài liệu mô tả nghiệp vụ gốc của 7 setup (không phải
bảng số liệu ngưỡng cụ thể như "vùng giá 50" / "30-40" nêu ở lần hỏi trước — đó chỉ là ví dụ minh hoạ
của user). Yêu cầu thực tế: **thêm các giá trị giá hành vi** (mức giá cụ thể mà tài liệu mô tả — đáy/đỉnh
cụm doji, đáy/đỉnh hộp nén, biên vùng phạm vi...) vào nội dung signal gửi Telegram cho **tất cả** setup,
không chỉ ARB. Đây KHÔNG phải thay đổi thuật toán detect (logic hiện tại đã khớp tài liệu), chỉ là lộ rõ
dữ liệu giá đã tính sẵn trong code ra `ruleTrace` → `reasons` → Telegram.

Rà lại 6 file setup còn lại (`ddb.ts`, `fb.ts`, `sb.ts`, `bb.ts`, `rb.ts`, `irb.ts`):

| Setup | Giá trị hành vi theo tài liệu | Đã có trong `ruleTrace`? |
|---|---|---|
| DDB | Đáy/đỉnh cụm doji (dùng làm entry + stop) | ❌ Biến `dojiHigh`/`dojiLow` đã tính (dòng 75-76) nhưng không push vào trace |
| FB | Đáy/đỉnh sóng kéo ngược (dùng làm stop) | ✅ Đã có: `Entry ... tai X, Stop=Y` (dòng 140) |
| SB | Đáy/đỉnh thứ 2 của mô hình W/M | ✅ Đã có: `Pattern W: low1=X @ index i, low2=Y @ index j` (dòng 83/227) |
| BB | Đáy/đỉnh hộp nén (block) | ❌ Chỉ có `range=X` (độ rộng), thiếu `block.high`/`block.low` tường minh |
| RB | Đáy nến phá vỡ / đáy hộp | ❌ Chỉ có `range=X`, thiếu `range.high`/`range.low` tường minh |
| IRB | Đáy/đỉnh hộp nhỏ + biên vùng phạm vi lớn (target) | ✅ Đã có: `RangeOuter ... high=X, low=Y` (dòng 99) và `Entry ... Stop=Y` |
| ARB | Mức mồi bị phá + gap | ✅ Đã xử lý ở subtask 01 |

→ Chỉ DDB, BB, RB cần sửa. Việc y hệt pattern đã áp dụng cho ARB ở subtask 01 (thêm 1 dòng trace nêu
rõ high/low + template dịch tương ứng) — KHÔNG phải "generalize decoy-break pattern" như dự kiến ban
đầu, vì tài liệu không mô tả decoy-break là 1 filter áp cho tất cả setup — nó CHỈ thuộc về Range context
(RB/IRB/ARB), và cụ thể được định nghĩa RIÊNG trong ARB (mục 7). BB/RB/DDB/FB/SB không có bước
"phá mồi" trong định nghĩa của tài liệu.

## Phạm vi subtask 01 (chi tiết trong task.md)

- `range.high` / `range.low` (biên bị phá vỡ = mức "mồi") hiện đã được dùng làm entry/stopLoss nhưng
  **không xuất hiện tường minh** trong `ruleTrace` — chỉ có `range.range` (độ rộng). Cần thêm 1 dòng
  trace nêu rõ high/low.
- Edge-test entries (`Edge test #N at index i: high=X, close=Y`) đã có giá trị giá — giữ nguyên, chỉ
  cần đảm bảo hiển thị đúng qua `REASON_TEMPLATES`.
- Không đổi entry/stopLoss/takeProfit hiện có trong `codeBlock` của `telegram-volman.ts` (đã có giá
  trị rồi) — chỉ bổ sung phần "Lý do vào lệnh" (`reasons`) để show rõ mức mồi bị phá + vùng nén.

## Việc KHÔNG làm trong subtask 01

- Không sửa thuật toán detect (điều kiện breakout, edge test count, confidence...).
- Không tạo setup kind mới.
- Không đụng vào BB/RB/IRB/DDB/FB/SB.

## Khi nào mở subtask 02

Chỉ mở khi user gửi document mô tả cho từng setup:
- Vị trí/định nghĩa kỹ thuật của "mức mồi" bị phá vỡ (ví dụ: biên block nén trước đó, hay swing
  high/low N nến gần nhất).
- Cách tính biên trên/dưới của "vùng nén" sau mồi break (dùng lại `detectCompression()`, hay theo
  tỷ lệ retrace của gap).
- Xác nhận rõ: áp dụng như 1 setup kind độc lập mới, hay sửa/thêm filter vào cả 6 file setup hiện có.

Lead sẽ viết `plan.md` bổ sung + `task.md` riêng cho subtask 02 sau khi nhận document, không đoán trước.
