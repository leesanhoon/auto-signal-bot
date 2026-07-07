# Plan — Fix 7 findings từ review vòng 5 (redesign backtest engine LẦN 3)

## Context — ĐỌC KỸ TRƯỚC KHI LÀM

Đây là lần thứ 3 `setup-backtest.ts` được redesign để xử lý SB, và LẦN THỨ 2
liên tiếp bản fix tạo ra regression MỚI NGHIÊM TRỌNG HƠN bug cũ:

- Round 3: fix lookahead bias cho SB → vô tình hoãn entry 2 nến cho CẢ 6
  setup không phải SB.
- Round 4: fix hoãn entry sai → xóa mất invariant "không chồng lệnh"
  (`activeUntilIndex`) hoàn toàn, VÀ tạo ra double-counting (1 sự kiện thị
  trường được tính thành 2 trade), VÀ logic retry SB lệch hẳn so với live.

**Do đã fail 2 lần liên tiếp với thiết kế để worker tự quyết định, task này
viết THUẬT TOÁN CỤ THỂ, không để mở nhiều lựa chọn.** Worker cần làm ĐÚNG
theo đặc tả dưới đây, không tự sáng tạo thiết kế khác.

## 7 vấn đề cần fix

- `01-redesign-backtest-engine-v3/` — **CRITICAL**: gộp cả 4 vấn đề cốt lõi
  (không chồng lệnh, double-counting, resolveSetupConflicts sai phạm vi, SB
  retry lệch live) vì đều nằm trong cùng 1 state machine, sửa riêng lẻ sẽ
  tiếp tục xung đột nhau như 2 lần trước.
- `02-resolve-irb-fallback-window-question/` — **MEDIUM**: câu hỏi còn treo
  từ round 4 (chưa ai trả lời)
- `03-fix-test-file-location/` — **LOW**

## Thứ tự bắt buộc

**01 làm MỘT MÌNH, KHÔNG song song với gì khác.** Sau khi 01 xong, Lead sẽ tự
review kỹ (đọc code, không chỉ đọc `result.md`) trước khi cho phép chạy backtest
thật hoặc giao thêm việc khác trên file này.

## Verification chung

```bash
npm run build
npm run test -- --run
```
Sau đó Lead tự chạy `npm run backtest:setups` để so sánh. **Lead sẽ KHÔNG
tự động tin `result.md` — sẽ tự đọc lại toàn bộ `runSetupBacktest` sau khi
worker báo xong**, vì 2 lần trước worker tự báo "đã sửa đúng" nhưng vẫn có
bug mới.
