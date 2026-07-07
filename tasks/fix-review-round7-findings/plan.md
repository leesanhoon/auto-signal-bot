# Plan — Fix deferred-signal entryIndex staleness (round 7)

## Context

Round 6 fix cho "SB + fresh signal trùng index" (dùng `deferredFreshSignals`
để không làm mất signal) tạo ra 1 bug con: khi signal bị hoãn cuối cùng cũng
được xử lý (có thể rất lâu sau, tùy SB trade "thắng" đóng lệnh khi nào), nó
bị ghi nhận `entryIndex` = vị trí walk-forward HIỆN TẠI (lúc đó) thay vì
`triggerIndex` THẬT của chính nó — trong khi `entryPrice`/`stopLoss` vẫn là
giá trị cũ tính từ lúc phát hiện gốc. Kết quả: 1 trade có entry price/stop
từ ngữ cảnh giá CŨ nhưng gắn nhãn thời điểm entry SAI (muộn hơn nhiều).

Nghiêm trọng hơn: 1 test ĐÃ CÓ (`"does not double-count a false-break signal
and its SB reversal"` trong `tests/charts/setup-backtest-queue.test.ts`)
đang ASSERT giá trị SAI (`entryIndex: 34` cho signal có `triggerIndex` thật
là 33) như thể đó là hành vi ĐÚNG — cần sửa lại test này cùng lúc.

## 1 subtask

- `01-fix-deferred-signal-entryindex/` — sửa code + sửa lại test đang assert
  sai + thêm test mới chứng minh đúng.

## Verification

```bash
npm run build
npm run test -- --run
```
