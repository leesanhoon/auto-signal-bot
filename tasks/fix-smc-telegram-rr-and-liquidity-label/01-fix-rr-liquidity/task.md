# Task: Fix SMC Telegram RR And Liquidity Label Rendering

## Objective
Sửa 2 lỗi đã được Lead review trong output Telegram của signal SMC:

1. `R:R` theo TP có thể render sai format.
2. Liquidity target có thể lặp giá trong message.

Sau khi làm xong, ghi kết quả vào `tasks/fix-smc-telegram-rr-and-liquidity-label/01-fix-rr-liquidity/result.md`.

## Instructions
1. Đọc và hiểu:
   - `tasks/fix-smc-telegram-rr-and-liquidity-label/plan.md`
   - `tasks/fix-smc-telegram-rr-and-liquidity-label/context.md`
   - `src/charts/smc/smc-signal-assembly.ts`
   - `src/shared/telegram.ts`
   - `tests/charts/smc/smc-signal-assembly.test.ts`
   - `tests/shared/telegram.test.ts`
2. Sửa bug `riskReward` để khi source là số, output cuối cùng vẫn có format đúng kiểu `x.y:1`.
3. Sửa contract hoặc formatter để liquidity target không bị lặp giá trong Telegram message.
4. Ưu tiên giải pháp bền vững:
   - Nếu `label` nên chỉ là mnemonic, hãy normalize ở assembly/test
   - Hoặc nếu formatter phải chịu được cả 2 loại input, hãy xử lý rõ ràng và có test
5. Bổ sung regression test thật sự bắt được 2 bug trên.
   - Ít nhất 1 test nên đi qua flow `SmcSignal -> buildTradeSetupFromSmcSignal -> buildSmcSignalMessage`
6. Chạy test liên quan.
7. Ghi `result.md` gồm:
   - Files đã sửa
   - Root cause
   - Cách sửa
   - Lệnh test đã chạy và kết quả
   - Còn rủi ro/gap nào không

## Acceptance Criteria
- [ ] Telegram SMC không còn render `R:R 5.1` thiếu hậu tố `:1`
- [ ] Telegram SMC không còn lặp giá kiểu `EQL 4056.11 4056.11`
- [ ] Có regression tests cover đúng 2 lỗi này
- [ ] Chỉ sửa những file liên quan trực tiếp
- [ ] Có `result.md` trong đúng thư mục task

## Files to Touch
- `src/charts/smc/smc-signal-assembly.ts`
- `src/charts/chart-types.ts` (nếu cần)
- `src/shared/telegram.ts`
- `tests/charts/smc/smc-signal-assembly.test.ts`
- `tests/shared/telegram.test.ts`
- `tasks/fix-smc-telegram-rr-and-liquidity-label/01-fix-rr-liquidity/result.md`

## Suggested Verification
- `npm test -- tests/charts/smc/smc-signal-assembly.test.ts`
- `npm test -- tests/shared/telegram.test.ts`

## If Blocked
Nếu không thể chốt contract hợp lý mà không có clarification, tạo `blocked.md` thay vì đoán.
