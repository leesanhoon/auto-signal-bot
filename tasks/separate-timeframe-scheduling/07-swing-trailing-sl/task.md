# Task 07: Swing trailing SL sau khi TP1 khớp (thay vì breakeven khoá cứng)

**Prerequisite**: Không chặn — **schedule trước task 01-02 để tránh schema conflict**, nhưng code logic có thể phụ thuộc cột schema khi task 01-02 hoàn thành.

**Objective**: Khi TP1 khớp (lợi nhuận đã lock một phần), thay vì khoá SL ở breakeven cứng, hãy để SL **trailing động theo swing support** (nâng dần khi giá tăng, giữ mức cao nhất để protect profit).

## Background
- Hiện tại: khi TP1 khớp → SL được set cứng ở breakeven (entry price). Đây là strategy bảo thủ nhưng mất opportunity khi trend còn mạnh.
- Mục tiêu: sau TP1 khớp, **SL trailing động** theo swing support gần nhất (ví dụ swing low của 1h trước) — vừa protect profit, vừa cho trend tiếp tục.

## Implementation

### File: `src/charts/binance-execution-shared.ts`
Thêm/update hàm `updateTrailingSLAfterTP1()` hoặc logic trong hàm xử lý TP1 khớp:

1. **Trigger**: Khi `pollPendingEntryOrders()` detect TP1 đã khớp:
   - Status vị thế từ `"open"` → `"tp1_hit"` hoặc tương tự (cần check schema hiện tại).
   - Lấy `position.entry_price` + `position.entry_qty` từ DB.

2. **Tính Swing Support**:
   - Fetch OHLC data của **timeframe cao hơn một bậc** (ví dụ nếu trading M15 thì lấy H1; nếu H1 thì H4).
   - Tìm swing low gần nhất (lowest low trong 3-5 candle trước entry).
   - Hoặc dùng Fibonacci level: entry + (entry - swing_low) = SL target.

3. **Cập nhật SL trên Binance**:
   - Dùng `binance.cancelOrder()` + `binance.createOrder()` hoặc `editOrder()` (nếu Binance API support).
   - New SL level = swing support (hoặc Fib level).
   - Log: "Updated SL to [new_sl_price] after TP1 hit for [pair]".

4. **Lưu vào DB**:
   - Cập nhật `open_positions_volman` với `current_sl` = new level (nếu có column này).
   - Hoặc track trong `binance_entry_order_status` metadata.

### Timeframe Awareness
- **Dùng `CHART_PRIMARY_TIMEFRAME` env variable** để biết timeframe hiện tại của lần chạy.
- Khi tính swing support, fetch timeframe **cao hơn một bậc**: M15 → H1, H1 → H4, H4 → D1.
- **Nếu timeframe = D1**: tính swap support từ D1 candle (không có timeframe cao hơn trong scope task này).

### Validation
- Kiểm tra swing support calculation logic: `npx vitest run tests/charts/`.
- Log "Updated SL to [price]" khi SL được nâng (check terminal output).
- Chạy `npx tsc --noEmit` — không có TypeScript error.
- **Schema check** (chạy sau task 01 hoàn thành): nếu `primary_timeframe` column chưa tồn tại, hãy handle gracefully (log warning, không crash).

### Notes
- **Không bắt buộc dùng OCO** — chỉ cần huỷ old SL order + tạo new SL order (2 bước, không atomic nhưng acceptable).
- Nếu position đã close hoàn toàn (TP2 khớp) trước khi task này chạy → skip (check status trước cập nhật).
- Giữ nguyên hành vi **nếu TP1 chưa khớp** — SL vẫn ở breakeven như hiện tại.

## Acceptance Criteria
- ✅ Swing support calculation chính xác (test với known data: ví dụ swing low = 100, entry = 110 → SL nâng lên ~105 sau TP1 khớp).
- ✅ SL order được cập nhật trên Binance (check `binance_entry_order_status` history, log output).
- ✅ TypeScript strict mode pass: `npx tsc --noEmit`.
- ✅ Existing tests không break: `npx vitest run`.
- ✅ Handle gracefully nếu schema chưa có `primary_timeframe` (task 01 chưa xong).

## Result File
Ghi result tại `tasks/separate-timeframe-scheduling/07-swing-trailing-sl/result.md` với:
- Changes made (files modified, swing calculation method).
- Evidence: log "Updated SL to..." + screenshot binance_entry_order_status update.
- Test output: `npx tsc --noEmit` + `npx vitest run` results.
