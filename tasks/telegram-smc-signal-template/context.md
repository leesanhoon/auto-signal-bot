# Context: Desired Telegram SMC Signal

## User Target Format

```text
[SIGNAL] XAUTUSDT - SELL | Grade: B | Score: 51/100

━━━━━━━━━━━━━━━━━━━━━━━

Timeframe: M15 | Session: LONDON (Khung giờ vàng)

Market: Binance Spot XAUTUSDT

━━━━━━━━━━━━━━━━━━━━━━━

[ENTRY] 4128.37

Entry Zone: 4128.37 - 4131.83

[SL] 4142.51 | SL Distance: $14.14

[TP1] 4085.95 | R:R 3:1 | Chốt 50%

[TP2] 4056.61 | R:R 5.1:1 | Chốt 30% | EQL 4056.11

[TP3] 3945.50 | R:R 12.9:1 | Chốt 20% | PWL 3945.00

━━━━━━━━━━━━━━━━━━━━━━━

NHẬN ĐỊNH:

- Đa khung đồng thuận: H1 & M30 đều bearish, hỗ trợ xu hướng giảm.

- Setup chất lượng B: CHOCH Bearish + buy-side sweep tại 4126.38 + retest Bearish OB [4128.37-4131.83] tại vùng premium (53% range). Xác nhận rejection_wick (RVOL 0.86) cho thấy áp lực bán mạnh.

- Lưu ý: PDL 4122.63 nằm trước TP1, có thể gây nhiễu. SL tight $14.14, phù hợp risk nhỏ.

QUẢN LÝ VỐN:

- Risk 1-2% tài khoản cho lệnh này.

- Chiến lược chốt lời: 50% tại TP1, 30% tại TP2, 20% tại TP3.

- Kéo SL về entry (breakeven) ngay khi chạm TP1 để bảo toàn vốn.

THẬN TRỌNG: Thanh khoản thấp ngoài khung giờ London có thể gây biến động bất ngờ.
```

## Current Code Path
- `src/charts/index.ts` gọi `sendAllAnalyses(...)`
- `src/shared/telegram.ts` route SMC qua `buildSmcSignalMessage(setup)`
- `src/charts/smc/smc-signal-assembly.ts` build `TradeSetup` từ `SmcSignal`

## Important Existing Facts
- `TradeSetup` đã có các field SMC như `grade`, `score`, `market`, `sessionLabel`, `entryZone`, `stopLossDistance`, `takeProfit3`, `takeProfitAllocations`, `liquidityTargets`, `capitalManagement`
- `tests/shared/telegram.test.ts` đã có test `buildSmcSignalMessage renders SMC format and defaults`
- Formatter hiện khá gần mẫu user, nhưng có thể chưa phản ánh đúng `R:R` riêng cho từng TP

## Constraints For Worker
- Không sửa file ngoài phạm vi task nếu không thật sự cần
- Không đổi luồng Bob Volman nếu không liên quan SMC
- Nếu phát hiện data source chưa đủ để render đúng template, bổ sung field type + mapping tối thiểu
- Ưu tiên giữ thay đổi nhỏ, rõ, và có test chứng minh
