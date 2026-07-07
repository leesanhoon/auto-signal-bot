# Plan — Fix 3 findings từ review vòng 6

## Context

Round 5 redesign `setup-backtest.ts` (lần thứ 3) đã fix ĐÚNG cả 4 vấn đề cốt
lõi từ round 4 (không chồng lệnh, double-counting, entry delay, SB retry
lệch live) — xác nhận qua đọc code trực tiếp + agent verify độc lập, KHÔNG
còn regression nghiêm trọng như 2 lần trước. Còn lại 3 vấn đề nhỏ hơn, không
cần redesign lại, chỉ cần vá đúng chỗ.

## 3 vấn đề

- `01-fix-open-at-end-lockout/` — **HIGH**: trade "open_at_end" khóa vĩnh
  viễn slot `openTrade`, chặn mọi tín hiệu sau đó cho cả phần còn lại của
  backtest (dù không liên quan gì tới trade đó)
- `02-fix-sb-fresh-signal-collision/` — **MEDIUM**: hiếm khi SB signal chín
  và fresh signal trùng đúng 1 index → 1 trong 2 bị âm thầm loại bỏ
- `03-properly-test-irb-fallback-case-a/` — **LOW**: câu hỏi treo từ round 4
  vẫn CHƯA thực sự được trả lời (worker trước chỉ test 1/2 case yêu cầu,
  đúng case KHÔNG đáng lo, bỏ qua case đáng lo)

## Thứ tự

Cả 3 độc lập, có thể giao song song cho 3 worker khác nhau — không như các
round trước (không cần làm 1 mình / tuần tự) vì đây là các fix cục bộ, không
đụng chạm cùng 1 khối logic phức tạp.

## Verification chung

```bash
npm run build
npm run test -- --run
```
