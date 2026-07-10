# Task 04: candle-age-in-message

## Mục tiêu
Thêm dòng hiển thị tuổi nến (candle close time) vào message signal trên Telegram.
Giúp user tự đánh giá độ tươi của signal trước khi chấp nhận.

## Yêu cầu chức năng

### Format dòng tuổi nến
```
🕐 Nến gốc [M15] đóng: 12:30 10/07 UTC (45 phút trước)
```

**Template:**
```
🕐 Nến gốc [<TIMEFRAME>] đóng: <HH:mm dd/MM UTC> (<MINUTES> phút trước)
```

### Cách tính

**Input:**
- `timeframe`: "M15", "H4", "D1", v.v. từ setup (e.g., `setup.primaryTimeframe`)
- `candleCloseTime`: Thời điểm nến đóng (epoch ms hoặc ISO string)

**Output:**
- `HH:mm dd/MM UTC`: Thời gian nến đóng, format 24h, UTC
- `MINUTES phút trước`: Tính từ bây giờ

**Logic tính candleCloseTime:**
- Tìm trong setup object nếu có field lưu thời gian nến (e.g., `candleTime`, `candle.time`, v.v.)
- Hoặc tính từ OHLC candles (nếu available)
- Fallback: Dùng thời gian hiện tại trừ timeout (conservative - không hiển thị nếu không chắc)

### Vị trí thêm dòng này

**SMC:** `src/shared/telegram-smc.ts` → function build single setup message
- Nên thêm sau dòng entry/TP/SL
- Trước dòng confidence

**Volman:** `src/shared/telegram-volman.ts` (hoặc `src/shared/telegram.ts` nếu Volman dùng file khác)
- Same logic như SMC

### Cấu trúc Setup để lấy candle time

Từ plan, nến gốc đóng tại thời điểm signal được detect. Cần tìm field này trong TradeSetup:
- Kiểm tra các field có sẵn: `time`, `candleTime`, `closedAt`, v.v.
- Hoặc tính từ confidence (nếu setup chứa confidence candle index)

**Fallback approach:**
Nếu không tìm được thời gian nến chính xác:
- Không hiển thị dòng tuổi nến (để tránh nhầm lẫn)
- OR: Hiển thị với dấu "?" (uncertain)

### Không thay đổi

- Không thay đổi logic gửi signal
- Không thay đổi message format khác
- Chỉ thêm 1 dòng mới

## Tests

Tạo `tests/shared/telegram-smc-candle-age.test.ts`:

### Test case 1: Format dòng tuổi nến đúng
- Input: timeframe="M15", candleCloseTime=45 phút trước
- Output: Chứa "🕐 Nến gốc [M15] đóng:" và "45 phút trước"

### Test case 2: Tính phút chính xác
- Input: candleCloseTime = now - 120000ms (2 phút)
- Output: "2 phút trước"

### Test case 3: Ngày khác nhau
- Input: candleCloseTime = hôm qua 23:59
- Output: Ngày chính xác (dd/MM)

### Test case 4: UTC timezone
- Output: Phải có "UTC"

### Test case 5: Timeframe khác nhau
- "M15", "H4", "D1" → display đúng
- Output: [M15], [H4], [D1] tương ứng

### Test case 6: Edge case - 0 phút trước (signal vừa gửi)
- Output: "0 phút trước"

### Test case 7: Edge case - missing candle time (fallback)
- Input: candleCloseTime = null/undefined
- Output: Không có dòng tuổi nến (hoặc skip)

### Test case 8: Large time difference (>1 ngày trước)
- Input: candleCloseTime = 5 ngày trước
- Output: Vẫn format đúng, >= 1440 phút

## Dependencies

- `src/shared/telegram-smc.ts`: Chỉnh sửa message builder
- `src/shared/telegram-volman.ts`: Chỉnh sửa message builder (nếu khác file)
- `src/charts/chart-types-smc.ts` & `chart-types-volman.ts`: Kiểm tra TradeSetup fields

## Acceptance criteria

- `npm run build` pass
- `npm run test` pass (tất cả existing + new candle-age tests)
- Message có dòng tuổi nến với format đúng
- Tính phút chính xác (±1 phút OK)
- Timeframe & ngày/giờ display đúng UTC
- Fallback nếu không có candle time (không crash, không show sai)
- Không thay đổi message khác

## Notes

- Tuổi nến = thời gian từ lúc nến đóng đến bây giờ
- Dùng UTC để tránh confusion với timezone user
- Dòng này giúp user hiểu signal có bị trễ hay không
- Phối hợp với subtask 01-03 để hiểu flow
