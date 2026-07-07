# Task 01 — Redesign backtest pending-queue: chỉ hoãn SB, không hoãn 6 setup kia (CRITICAL)

## Vấn đề 1: Entry bị hoãn sai cho 6 setup không phải SB

`src/charts/setup-backtest.ts` hiện tại: MỌI signal (kể cả DD/FB/BB/RB/ARB/
IRB) đều bị đẩy vào `pendingSignals` (dòng ~178) và CHỈ được xác nhận (thêm
vào `confirmedSignals` → thành trade) khi `index >= triggerIndex + 2` (guard
ở dòng ~105). Nhưng 6 setup này KHÔNG cần chờ gì — entry/stopLoss/takeProfit
của chúng đã tính XONG ngay tại `triggerIndex` (xem `src/charts/setups/
bb.ts`, `dd.ts` — không có logic phụ thuộc dữ liệu tương lai). Chỉ có việc
XÁC ĐỊNH "đây có phải false-break hay không" (để quyết định có chạy SB hay
không) mới cần nhìn thêm tối đa 2 nến — và việc CHỜ đó không nên trì hoãn
việc VÀO LỆNH của tín hiệu gốc.

Hậu quả: `entryIndex` ghi nhận trong backtest cho TẤT CẢ trade (trừ SB) hiện
là `triggerIndex + 2` (hoặc muộn hơn) thay vì `triggerIndex` thật — sai lệch
timing/giá entry cho đa số lệnh trong báo cáo backtest, và khác hẳn hành vi
pipeline live (`src/charts/deterministic-pipeline.ts` + `setup-sb-runner.ts`
— vẫn vào lệnh ngay lập tức, không đổi).

## Vấn đề 2: `detectSb` không được bọc try/catch

Dòng ~97 và ~134 gọi `detectSb(candles, index, ctx, pending.signal)` trực
tiếp, không có try/catch — khác với 6 detector chuẩn ngay bên dưới (dòng
~174-183, có try/catch) và khác với `setup-sb-runner.ts` cũ (đã catch lỗi,
log rồi bỏ qua signal). Nếu `detectSb` throw, cả backtest cho 1 cặp tiền sẽ
crash thay vì chỉ mất 1 tín hiệu.

## Vấn đề 3: Pending signal bị rơi mất vĩnh viễn khi có lệnh active

Dòng ~93-95, ~130-132, ~141-143: khi 1 pending signal "chín" (đến lúc xác
nhận) nhưng lúc đó `index <= activeUntilIndex` (đang có lệnh khác mở), code
`continue` mà KHÔNG đẩy lại vào `nextPendingSignals`/`nextPendingFalseBreaks`
— tín hiệu biến mất vĩnh viễn, không có log, dù lệnh active có thể đóng ngay
sau đó và tín hiệu vẫn còn hợp lệ.

## Yêu cầu — thiết kế lại (khuyến nghị)

Nguyên tắc: **CHỈ signal có khả năng là false-break mới cần hoãn** (để chờ
xác nhận); signal KHÔNG false-break phải vào lệnh NGAY tại `triggerIndex`
của chính nó, giống hệt cách 6 setup này hoạt động trước round 3.

Thiết kế đề xuất:

1. Ở mỗi `index`, sau khi chạy 6 detector chuẩn ra `signals` MỚI tại chính
   `index` này:
   - Với mỗi signal: kiểm tra ngay `isFalseBreak(candles, index, levelHigh,
     levelLow, direction, maxLookahead)` — NHƯNG vì đang ở tại `index =
     triggerIndex` (vừa phát hiện), dữ liệu `index+1`, `index+2` CHƯA CÓ
     trong "hiện tại" của walk-forward — nên **không thể xác định false-break
     ngay lập tức mà không phạm invariant walk-forward**.
   - Do đó: signal MỚI PHÁT HIỆN LUÔN được coi là "provisionally valid" và
     VÀO LỆNH NGAY tại `triggerIndex` (thêm vào `confirmedSignals` ngay trong
     iteration này, giống hệt code TRƯỚC round 3) — điều này khớp với cách
     live pipeline hoạt động (không chờ xác nhận false-break trước khi báo
     tín hiệu).
   - ĐỒNG THỜI, đẩy signal vào `pendingFalseBreaks` để theo dõi RIÊNG xem sau
     này nó CÓ trở thành false-break hay không — việc này KHÔNG ảnh hưởng gì
     đến trade đã ghi nhận (trade đã entry ngay từ đầu), CHỈ dùng để: nếu xác
     nhận là false-break ở `index >= triggerIndex + 2`, thì sau đó tìm SB
     (`index >= triggerIndex + 3`) và có thể tạo thêm 1 trade SB RIÊNG BIỆT
     (không thay thế trade gốc đã vào lệnh).

2. Việc "trade gốc hóa ra là false-break" — có ảnh hưởng gì đến trade ĐÃ ghi
   nhận không? Đọc kỹ code gốc TRƯỚC round 3 (dùng `runSbDetection`, comment
   "Do NOT keep the original failed signal (fix #16)") — ý định gốc là: nếu
   xác nhận false-break, trade GỐC không được tính là 1 lệnh riêng (chỉ SB
   mới được tính). Điều này MÂU THUẪN với việc "vào lệnh ngay" ở bước 1.
   **Đây là điểm cần bạn tự cân nhắc kỹ và quyết định** — 2 lựa chọn:

   **Lựa chọn A (ưu tiên khớp live pipeline):** Vào lệnh ngay tại
   `triggerIndex` cho MỌI signal (kể cả sau này hóa ra false-break) — vì đây
   là cách live pipeline THỰC SỰ hoạt động (gửi tín hiệu ngay, không rút lại
   nếu sau đó hóa ra sai). Nếu sau đó phát hiện false-break, KHÔNG hủy trade
   đã mở — chỉ THÊM 1 trade SB riêng nếu SB confirm được. Ưu điểm: backtest
   khớp chính xác hành vi live. Nhược điểm: có thể double-count (1 lệnh gốc
   thua + 1 lệnh SB thắng cho cùng 1 sự kiện thị trường) — nhưng đây CHÍNH
   XÁC là những gì user thực sự trải nghiệm nếu dùng bot live (nhận cả 2 tín
   hiệu).

   **Lựa chọn B (giữ logic "không tính trade gốc nếu false-break", chấp
   nhận trade gốc phải hoãn 2 nến):** Giữ thiết kế hiện tại (hoãn TẤT CẢ),
   NHƯNG chỉ giới hạn phạm vi ảnh hưởng: rõ ràng ghi trong `result.md` rằng
   backtest KHÔNG khớp 100% với live cho 6 setup kia (có bù trừ giả định
   "không tính trade nào hóa ra false-break"), và đây là đánh đổi có chủ ý.

   **Khuyến nghị: chọn Lựa chọn A** — vì mục đích của backtest là dự đoán
   hiệu suất live, và live không hề hoãn/hủy tín hiệu. Nhưng đưa ra quyết
   định cuối cùng của bạn kèm lý do rõ ràng trong `result.md`.

3. Sửa vấn đề 2 (try/catch): bọc `detectSb(...)` trong try/catch, log lỗi
   (dùng `logger` có sẵn hoặc `console` nếu file chưa import logger — kiểm
   tra file hiện tại) rồi bỏ qua signal đó, giống pattern của 6 detector
   chuẩn.

4. Sửa vấn đề 3 (rơi mất pending): khi 1 pending item "chín" nhưng
   `index <= activeUntilIndex`, PHẢI đẩy lại vào `nextPendingFalseBreaks`
   (không drop) để thử lại ở `index` kế tiếp — hoặc quyết định 1 giới hạn số
   lần thử lại hợp lý (ví dụ tối đa 5 nến) rồi mới drop hẳn kèm log debug rõ
   lý do. KHÔNG được drop âm thầm không log.

## KHÔNG làm

- Không đổi `src/charts/setup-sb-runner.ts`/`deterministic-pipeline.ts` (live
  pipeline không cần đổi).
- Không đổi logic bên trong `detectSb`, `isFalseBreak`, hay 6 detector chuẩn.

## Verification

```bash
npm run build
npm run test -- --run
```

**BẮT BUỘC** viết/sửa test trong `tests/charts/setup-backtest.test.ts`:
1. Test xác nhận: 1 signal KHÔNG phải false-break → `entryIndex` TRONG
   BÁO CÁO khớp ĐÚNG với `triggerIndex` gốc (không lệch +2) — test này PHẢI
   FAIL trên code hiện tại (trước khi sửa) và PASS sau khi sửa, để chứng
   minh fix có tác dụng thật.
2. Giữ lại/cập nhật test cho lookahead bias (từ round 3) — vẫn phải pass:
   entry/stop của SB không phụ thuộc dữ liệu sau `entryIndex` của chính lệnh
   đó.
3. Test cho try/catch: mock/tạo tình huống `detectSb` throw — xác nhận
   `runSetupBacktest` KHÔNG crash, chỉ bỏ qua tín hiệu đó.
4. Test cho pending không bị rơi mất: dựng tình huống pending signal "chín"
   đúng lúc có lệnh active — xác nhận nó được xử lý lại sau khi lệnh active
   đóng (không biến mất).

## Ghi kết quả

`result.md`: quyết định Lựa chọn A hay B (kèm lý do), thiết kế cụ thể đã cài
đặt, 4 test mới, kết quả build + test.
