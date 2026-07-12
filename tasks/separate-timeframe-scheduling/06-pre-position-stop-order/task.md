# Task 06: Pre-position STOP order trước breakout (BB setup)

**Prerequisite**: Không có (subtask này không phụ thuộc vào schema change từ task 01-02).

**Objective**: Khi Bob Volman phát hiện **BB setup** (Bollinger Band breakout), đặt lệnh STOP LIMIT lên Binance **trước khi giá breakout** — thay vì chờ MARKET order sau khi giá đã breakout.

## Background
- Hạ tầng để poll pending entry orders **đã tồn tại**: `binance_entry_order_status` column trong `open_positions_volman` + `pollPendingEntryOrders()` trong `binance-execution-shared.ts` đã chạy mỗi lần `npm run analyze`.
- Vấn đề gốc: detector phát tín hiệu **quá trễ** (sau khi giá đã breakout) — cần phát tín hiệu sớm hơn (khi band mới hình thành, trước breakout).
- **Task này chỉ tập trung vào BB setup** — RB/ARB/IRB cần OCO (2 lệnh cùng lúc, huỷ thua), ngoài scope task này.

## Implementation

### File: `src/charts/setups/bb.ts`
Thêm hàm `prePositionStopOrder()` hoặc logic trong signal detection để:

1. **Khi BB setup được phát hiện** (band đang hình thành, candle chưa breakout hoàn toàn):
   - Tính entry level = breakout target (ví dụ upper band + 1 tick cho LONG).
   - Tính stop level = opposite band hoặc safe level dựa RSI/MACD.
   - Tính TP (TP1/TP2) dựa Risk:Reward.

2. **Đặt STOP LIMIT order lên Binance**:
   - Dùng `binance.createOrder()` hoặc wrapper tương tự trong `binance-execution-shared.ts`.
   - Order type: `STOP` (Binance futures STOP — giá hit thì LIMIT tự động active).
   - Lưu order ID + status vào `binance_entry_order_status` khi tạo.
   - **Không** dùng MARKET — phải là STOP để chờ breakout xảy ra.

3. **OCO chỉ cho LONG/SHORT một chiều**:
   - Entry STOP: khi giá hit breakout → khớp entry.
   - SL STOP: khi giá hit stop level → close (hoặc giảm).
   - TP LIMIT: không cần OCO vì chỉ BB (không RB/ARB/IRB).

### Validation
- Kiểm tra BB setup detector có chính xác không: `npx vitest run tests/charts/`. Nếu có test BB setup, chạy xem pass/fail.
- Sau implementation, log "Pre-positioned STOP order for [pair] at [entry level]" khi đặt lệnh.
- Chạy `npx tsc --noEmit` — không có TypeScript error.

### Notes
- **RB/ARB/IRB scope ngoài task**: Nếu future cần pre-position cho nhóm này, cần OCO (2 lệnh), là separate feature.
- Giữ nguyên hành vi hiện tại của MARKET entry cho các setup khác nếu chúng không phải BB.
- **Không thay đổi `.env` live-trading flag** — chỉ add logic, user quyết định enable/disable.

## Acceptance Criteria
- ✅ BB detector phát tín hiệu **trước** breakout (band hình thành, candle có body < band width).
- ✅ Pre-position STOP order được đặt lên Binance (check log + `binance_entry_order_status` column).
- ✅ Order status tracked: `"pending"` → `"filled"` khi breakout khớp.
- ✅ TypeScript strict mode pass: `npx tsc --noEmit`.
- ✅ Existing tests không break: `npx vitest run`.

## Result File
Ghi result tại `tasks/separate-timeframe-scheduling/06-pre-position-stop-order/result.md` với:
- Changes made (files modified, new functions).
- Evidence: log output hoặc screenshot khi đặt pre-position order.
- Test output: `npx tsc --noEmit` + `npx vitest run` results.
