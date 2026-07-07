# Plan — Fix 6 findings từ review vòng 3

## Context

Fix SB boundary vòng trước (`tasks/fix-review-round2-findings/01-*`) đã tự sửa
được lỗi "SB không bao giờ ra tín hiệu trong backtest", nhưng theo cách gây ra
**lookahead bias** — nghiêm trọng hơn bug cũ. Review vòng 3 (8-angle, medium
effort, 7/8 agent đồng thuận) xác nhận chi tiết cơ chế lỗi. Đây là ưu tiên số
1 cần fix trước khi tin bất kỳ số liệu backtest SB nào.

## Subtasks

- `01-fix-sb-lookahead-bias/` — **CRITICAL**: redesign SB backtest để tôn
  trọng walk-forward invariant (không dùng dữ liệu tương lai), kèm test
  chứng minh không còn lookahead
- `02-fix-uncaught-timeframe-throws/` — **MEDIUM**: 2 hàm throw không được
  catch, vi phạm quy ước "return Error, không throw"
- `03-dedupe-timeframe-switches/` — **LOW**: 4 hàm switch lặp lại trên cùng
  `ChartTimeframe`
- `04-dedupe-fetch-retry-pattern/` — **LOW**: 3 bản fetch+retry+parse gần
  giống nhau trong `ohlc-provider.ts`
- `05-dedupe-irb-fallback-scaffolding/` — **LOW**: 2 nhánh LONG/SHORT IRB vẫn
  copy-paste phần bao quanh `checkShiftedFallback`

## Thứ tự khuyến nghị

**01 làm TRƯỚC TIÊN VÀ RIÊNG LẺ** — đây là redesign, không phải fix 1 dòng,
cần suy nghĩ kỹ, không nên giao song song với việc khác để tránh xung đột
merge trên cùng file (`setup-backtest.ts`, `setup-sb-runner.ts`). Sau khi 01
xong và review OK, mới giao 02-05 (có thể song song, không phụ thuộc 01 hay
lẫn nhau).

## Verification chung

Sau khi TẤT CẢ subtask xong:
```bash
npm run build
npm run test -- --run
```
Sau đó Lead tự chạy `npm run backtest:setups` (H4 + M15) với Twelve Data key
thật để xác nhận SB ra số liệu hợp lý (không phải 0 lệnh, không phải win-rate
bất thường cao do lookahead).
