# Review: Task 06 — pre-position-stop-entry (BB)

## Verdict: CHANGES_REQUIRED — ĐÃ ĐƯỢC LEAD FIX (2026-07-12, theo yêu cầu user)

User xác nhận: revert 2 thay đổi ngoài scope (slope, window size), giữ đúng phần pre-position.
Đã áp dụng trong `src/charts/setups/bb.ts`:
- Slope: khôi phục `<= 0.15` (từ `0.2`).
- Window: khôi phục multi-window `[4, 5, 6]` (từ cố định `5`).
- Bỏ dead-code check `index !== block.endIndex + 1` (không có tác dụng thật, xem finding dưới) —
  dựa vào `resolveSetupConflicts` để dedup theo pair (đã hoạt động đúng từ trước).

Backtest sau khi revert (H4, pending fill): BB 46 trades, 47.8% win rate, 0.17R avg — so với BB
gốc trước Task 06 (post-breakout, 20 trades, 70% win rate, 0.74R avg). Kết luận: riêng việc đổi
thời điểm phát tín hiệu (pre-position, không tính 2 threshold đã revert) khiến chất lượng BB giảm
đáng kể — nhiều lệnh hơn nhưng win rate và avg R đều tệ hơn nhiều. User đã được thông báo con số
này; quyết định giữ pre-position (đổi lấy giảm trượt giá) hay cân nhắc lại là của user.

`npx tsc --noEmit` sạch, `npx vitest run` 907/907 pass sau khi revert.

## Nội dung review gốc (trước khi fix)

## Việc đúng

- `triggerIndex = block.endIndex` thay vì candle breakout — đúng ý đồ pre-position.
- Bỏ điều kiện `breaksUp`/`breaksDown` — đúng, không còn chờ breakout mới trả tín hiệu.
- `direction` lấy từ `trend` (biết trước breakout) — đúng, khớp lý do BB pre-position được còn
  RB/ARB/IRB thì không (đã ghi rõ trong `plan.md`).
- Công thức entry/SL/TP1/TP2 KHÔNG đổi — đúng yêu cầu.
- `npx tsc --noEmit` sạch, test suite hiện tại pass (verify lại: 900/900 trên working tree, đã bao
  gồm 2 test Lead thêm ở review Task 02).
- Đã verify thật `-2021` không còn xảy ra cho setup BB khi test M15/H4 trong phiên làm việc trước
  (trước khi Task 07 code thêm nữa) — đúng mục tiêu gốc của task.

## Bug logic nghiêm trọng — cơ chế "chống trùng lặp tín hiệu" tự nhận là KHÔNG có tác dụng gì

`result.md` khẳng định: *"Added signal timing constraint (line 72): Only signal when `index ===
block.endIndex + 1`... preventing duplicate signals for the same block on subsequent candles."*

Đây là khẳng định SAI. Đọc `detectCompression()` trong `indicators.ts:175-218`: giá trị `endIndex`
trả về trong object kết quả **CHÍNH LÀ tham số `endIndex` truyền vào, không đổi**
(`return { startIndex, endIndex, ... }` — dòng 217). Trong `bb.ts:43`, lời gọi là
`detectCompression(candles, ctx.ema20, ctx.atr14, index - 1, 5, 1.2)` — tức LUÔN LUÔN truyền
`index - 1` làm `endIndex`. Vậy `block.endIndex` **luôn luôn bằng `index - 1`** theo đúng cấu trúc
lời gọi, không phụ thuộc dữ liệu candle nào cả.

Hệ quả: điều kiện `if (index !== block.endIndex + 1) return null;` (dòng 65) tương đương
`if (index !== (index - 1) + 1)` = `if (index !== index)` — **KHÔNG BAO GIỜ đúng, tức nhánh
return null này không thể nào được thực thi**. Đây là dead code hoàn toàn, không hề "chống trùng
lặp" như mô tả.

**Test không bắt được bug này** vì `tests/charts/setups.test.ts` (dòng 135-174) chỉ gọi
`detectBb(candles, last, ctx)` đúng 1 lần tại candle breakout (index 28) — không test xem detector
có tiếp tục trả tín hiệu (sai) tại index 26, 27... (các candle bên trong chính block đó) hay không.
Nếu test thử ở nhiều index liên tiếp trong block, sẽ thấy `detectBb` trả tín hiệu hợp lệ ở TẤT CẢ
các index đó, không chỉ 1 lần.

### Mức độ ảnh hưởng thực tế — bị giảm nhẹ bởi 1 cơ chế khác (không phải do task 06)

`resolveSetupConflicts()` (`setup-resolver.ts:36-`) đã tự gom nhóm theo `pair` và chỉ giữ lại
**1 tín hiệu/pair** (ưu tiên confidence cao nhất, rồi priority, rồi `triggerIndex` gần nhất) —
nên dù BB phát ra nhiều tín hiệu "giả trùng lặp" trong cùng 1 lần quét (`deterministic-pipeline.ts`
quét index từ `lastIndex-5` đến `lastIndex` mỗi lần chạy), hệ thống production vẫn chỉ hành động
trên đúng 1 tín hiệu/pair/lần chạy — **không tạo lệnh Binance trùng lặp thật**.

Tuy nhiên, đây vẫn là lỗi cần sửa vì 2 lý do:
1. `result.md` báo cáo sai về cơ chế đã implement — cần Worker hiểu đúng để không lặp lại kiểu bug
   này (viết code tưởng đúng nhưng chưa verify logic bằng cách chạy thử nhiều index).
2. Vì cửa sổ block trượt dần theo từng candle (`startIndex = endIndex - 5 + 1`), **mức entry/SL
   thực tế bị dùng có thể không phải là mức của block "đầu tiên" mà là bất kỳ block nào trong chuỗi
   trùng lặp được `resolveSetupConflicts` chọn** (theo confidence/triggerIndex gần nhất) — tức
   entry có thể lệch khỏi đúng thời điểm "block vừa sẵn sàng" như ý đồ ban đầu của task.

### Yêu cầu sửa

Chọn 1 trong 2 hướng:
- **(a) Sửa logic cho đúng như mô tả**: cần 1 cách thật để biết "block này đã từng được báo tín
  hiệu chưa" — ví dụ so sánh `block.startIndex`/`block.high`/`block.low` với lần detect gần nhất
  đã lưu (cần state giữa các lần gọi `detectBb`, hiện hàm này là pure function không giữ state —
  cần bàn thiết kế lại nếu muốn làm đúng).
- **(b) Đơn giản hơn, chấp nhận được**: bỏ hẳn dòng check vô dụng + comment sai (dòng 63-68), dựa
  hoàn toàn vào `resolveSetupConflicts` (đã hoạt động đúng) để dedup theo pair — ghi chú lại trong
  code là "không cần dedup tại đây, xử lý ở tầng resolver" thay vì tự nhận có cơ chế riêng không
  tồn tại.

Khuyến nghị (b) vì đơn giản, không thêm state phức tạp, và thực tế hệ thống đã an toàn nhờ resolver.

## Scope creep — 2 thay đổi KHÔNG có trong task.md

Task.md chỉ yêu cầu đổi THỜI ĐIỂM phát tín hiệu, không yêu cầu đổi ngưỡng số hay chiến lược window:

1. **Ngưỡng slope đổi từ `<= 0.15` thành `<= 0.2`** — thay đổi này làm BB khó kích hoạt hơn (yêu
   cầu trend dốc hơn), ảnh hưởng trực tiếp tần suất/win-rate của setup BB trong cả backtest lẫn
   live, không nằm trong yêu cầu task 06.
   - Ghi chú thêm: đây tình cờ khớp với chính docstring gốc của file (dòng 8: *"|EMA20 slope| >
     0.2"*) vốn đã SAI LỆCH với code cũ (code cũ dùng 0.15, docstring luôn ghi 0.2) — nên xét theo
     khía cạnh "sửa cho khớp doc gốc" thì hợp lý, nhưng Worker tự quyết định thay đổi ngưỡng số
     (ảnh hưởng hành vi giao dịch thật) mà không hỏi lại là vi phạm nguyên tắc "không deviation"
     của Worker.
2. **Đổi từ dò nhiều window size `[4, 5, 6]` sang cố định window size `5`** — cũng là quyết định
   tự ý, ảnh hưởng khả năng phát hiện block ở nhiều độ dài khác nhau, không có trong task.md.

**Yêu cầu**: Lead cần user xác nhận có chấp nhận 2 thay đổi ngưỡng số này không, hoặc revert về
đúng giá trị gốc (0.15, multi-window `[4,5,6]`) và CHỈ giữ lại phần đổi thời điểm phát tín hiệu —
đây là quyết định ảnh hưởng hiệu suất giao dịch thật, không phải quyết định kỹ thuật thuần tuý Lead
có thể tự chốt.

## Trạng thái

Chưa nên coi Task 06 là "hoàn thành" cho tới khi:
1. Xử lý dead code / claim sai ở phần dedup (chọn hướng a hoặc b ở trên).
2. User xác nhận giữ hay revert 2 thay đổi ngưỡng số (slope, window size).
