# Context: Lead Review Findings

## Findings Summary

### 1. RR per target can render incorrectly
- File: `src/charts/smc/smc-signal-assembly.ts`
- Problem: `target.riskReward` number đang bị convert sang `"5.1"` thay vì `"5.1:1"`.
- Downstream `src/shared/telegram.ts` coi mọi string non-empty là hợp lệ và in nguyên xi.
- Kết quả: Telegram có thể hiện `R:R 5.1` thay vì `R:R 5.1:1`.

### 2. Liquidity label can duplicate price
- File: `src/shared/telegram.ts`
- Problem: formatter render `| ${liq.label} ${liq.price}`.
- Nhưng assembly/test hiện cho phép label chứa sẵn giá, ví dụ `"EQL 4056.11"`.
- Kết quả: message có thể thành `EQL 4056.11 4056.11`.

## Relevant Files
- `src/charts/smc/smc-signal-assembly.ts`
- `src/shared/telegram.ts`
- `src/charts/chart-types.ts`
- `tests/charts/smc/smc-signal-assembly.test.ts`
- `tests/shared/telegram.test.ts`

## Lead Expectation
- Worker sửa theo hướng bền vững, không hardcode cho một sample riêng.
- Cần có ít nhất một test đi từ `SmcSignal` thực tế qua assembly rồi sang Telegram formatter để bắt đúng bug production.
- Không đổi những phần không liên quan của Bob Volman flow.
