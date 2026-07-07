# Plan — Fix 7 findings từ review vòng 4 (redesign backtest walk-forward)

## Context

Round 3's fix cho SB lookahead bias (`tasks/fix-review-round3-findings/01-*`)
đã đúng hướng (dùng pending-queue để hoãn xác nhận SB) nhưng áp dụng NHẦM độ
trễ 2 nến cho **cả 6 setup không phải SB** (DD/FB/BB/RB/ARB/IRB) — vốn không
cần chờ gì cả vì entry/stop/target của chúng tính xong ngay tại thời điểm
phát hiện. Đây là regression MỚI, nghiêm trọng hơn bug cũ, vì ảnh hưởng đa số
lệnh backtest (SB hiếm, 6 setup kia là phần lớn tín hiệu) thay vì chỉ 1 setup.

Ngoài ra review phát hiện thêm 2 bug liên quan trực tiếp tới cùng khối code
(try/catch thiếu, pending signal bị rơi mất vĩnh viễn) và vài vấn đề
cleanup/architecture mức thấp hơn.

## Subtasks

- `01-redesign-backtest-pending-queue/` — **CRITICAL**: sửa lại toàn bộ cơ
  chế pending-queue trong `setup-backtest.ts` — gộp cả 3 vấn đề liên quan
  chặt chẽ (entry delay sai cho non-SB, thiếu try/catch quanh detectSb,
  pending signal bị rơi mất khi có lệnh active) vì cùng nằm trong 1 khối code
  ~90 dòng, tách task sẽ gây xung đột merge.
- `02-verify-irb-fallback-window-change/` — **MEDIUM**: xác nhận thay đổi
  logic (không chỉ dedup) trong `checkShiftedFallback` là chủ đích
- `03-consolidate-sb-duplication/` — **LOW**: giảm rủi ro lệch nhau giữa 2
  bản logic SB (backtest vs live)
- `04-complete-fetchjson-dedup/` — **LOW**: hoàn thiện dedup fetch+parse còn
  dang dở
- `05-clean-irb-dead-branch/` — **LOW**: xóa if/else thừa trong `detectIrb`

## Thứ tự khuyến nghị

**01 làm TRƯỚC TIÊN VÀ RIÊNG LẺ** — đây lại là 1 redesign, không giao song
song với việc khác trên cùng file. Sau khi 01 xong và Lead review OK, mới
giao 02-05 (độc lập, có thể song song).

## Verification chung

Sau khi TẤT CẢ subtask xong:
```bash
npm run build
npm run test -- --run
```
Sau đó Lead tự chạy `npm run backtest:setups` (H4 + M15) để so sánh số liệu
trước/sau — kỳ vọng: entryIndex của các trade non-SB khớp đúng candle phát
hiện gốc (không lệch +2), SB vẫn xuất hiện với entry hợp lý (không lookahead
bias), không có trade nào biến mất bất thường so với version trước round 3.
