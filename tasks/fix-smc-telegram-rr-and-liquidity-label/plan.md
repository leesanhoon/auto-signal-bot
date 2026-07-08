# Task Plan: Fix SMC Telegram RR And Liquidity Label Rendering

## Overview
Task này xử lý 2 lỗi hành vi đã được Lead review trong luồng render signal SMC gửi Telegram:

1. `R:R` theo từng TP có thể bị in sai format khi upstream truyền `riskReward` dạng number.
2. Liquidity target có thể bị lặp giá trong message nếu `label` đã chứa sẵn giá và formatter vẫn nối thêm `price`.

Mục tiêu là sửa tận gốc ở mapping/formatting và thêm test end-to-end để các lỗi này không quay lại.

## Findings To Address
- `src/charts/smc/smc-signal-assembly.ts` đang map `target.riskReward` number thành string kiểu `"5.1"` thay vì `"5.1:1"`.
- `src/shared/telegram.ts` đang render liquidity target bằng `${label} ${price}`, nên với label kiểu `"EQL 4056.11"` sẽ thành `"EQL 4056.11 4056.11"`.
- `tests/shared/telegram.test.ts` hiện pass nhưng chưa cover đúng dữ liệu end-to-end từ SMC assembly.

## Architecture Decisions
- Ưu tiên chuẩn hóa dữ liệu từ assembly hơn là vá text cục bộ trong formatter.
- Giữ `buildSmcSignalMessage` là điểm render duy nhất cho signal SMC Telegram.
- Nếu cần, chuẩn hóa contract của `TradeSetup.liquidityTargets` để `label` chỉ là mnemonic (`EQL`, `PWL`) còn `price` là field riêng.
- Thêm test integration nhỏ theo luồng `SmcSignal -> TradeSetup -> buildSmcSignalMessage`.

## File Changes
- `src/charts/smc/smc-signal-assembly.ts` - Sửa mapping `riskReward` và/hoặc normalize liquidity target label
- `src/charts/chart-types.ts` - Update type nếu contract cần rõ hơn
- `src/shared/telegram.ts` - Chỉnh formatter để không lặp giá và render RR đúng
- `tests/charts/smc/smc-signal-assembly.test.ts` - Update expected contract cho assembly
- `tests/shared/telegram.test.ts` - Bổ sung coverage end-to-end cho SMC Telegram formatting

## Testing Strategy
- Chạy `npm test -- tests/charts/smc/smc-signal-assembly.test.ts`
- Chạy `npm test -- tests/shared/telegram.test.ts`
- Nếu cần, chạy thêm các test SMC liên quan bị ảnh hưởng

## Subtasks
| Subtask ID | Description | Owner | Files to Modify | Dependencies | Expected Output |
|------------|-------------|-------|-----------------|--------------|-----------------|
| 01-fix-rr-liquidity | Sửa RR từng TP và render liquidity target không lặp giá, kèm test regression | worker | `src/charts/smc/smc-signal-assembly.ts`, `src/charts/chart-types.ts`, `src/shared/telegram.ts`, `tests/charts/smc/smc-signal-assembly.test.ts`, `tests/shared/telegram.test.ts` | None | Output Telegram SMC đúng dữ liệu và test cover được 2 bug |
