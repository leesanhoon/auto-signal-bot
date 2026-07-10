# Done — smc-backtest-fixes

Ngày: 2026-07-10
Lead: Claude (Fable 5)
Verdict: **APPROVED**

## Tóm tắt

Cả 3 subtasks hoàn thành đúng plan.md, không deviation của Worker:

1. **01-fix-lookahead-fill**: fill từ `triggerIndex + 1`; nến fill chỉ xét SL, TP xét từ nến sau. ✅
2. **02-max-hold-timeout**: outcome `expired_hold` (96 nến, đóng tại close), giải phóng slot trade treo; runner hiển thị đủ. ✅
3. **03-update-tests-and-rerun**: 6 test cũ sửa, 4 test mới; 749/749 pass. ✅

Lưu ý: bản review đầu ghi nhận thay đổi config pairs / package.json là deviation — đã rút lại, các thay đổi đó do user thực hiện. User cũng đã tự xoá các symbol không tồn tại (SAN/LNK/NER/ALG/AAV) và XMR (delisted); Lead verify config cuối cùng chỉ còn symbol hợp lệ trên Binance (AVA/USDT = Travala, giữ theo chủ đích user).

## Verify cuối (Lead tự chạy, 2026-07-10)

- `npm run build`: pass.
- `npm run test`: 749/749 pass.
- `npm run backtest:smc` (M15, 500 bars, 22 pairs, config mới):
  - signals 601, closed trades 280
  - **winRate 45.71%**, avgRR 0.39, avgBarsHeld 2.53
  - outcomes: 54 tp1 / 73 tp2 / 1 tp3 / 152 stop / 140 expired / 0 expiredHold / 2 openAtEnd

## Baseline chính thức

So với trước fix (84.54% WR / 1.68 RR / 1.2 bars — bị look-ahead bias thổi phồng), baseline trung thực hiện tại là **~46% WR, avgRR ~0.4**. Với RR trung bình 0.39 và win rate 46%, strategy hiện tại **chưa có expectancy dương rõ ràng** (chưa tính fee/slippage) — đây là điểm xuất phát cho công việc tối ưu signal tiếp theo.

## Đề xuất bước tiếp theo (ngoài scope task này)

1. Mô phỏng partial exit theo capital management TP1/TP2/TP3.
2. Thêm fee/slippage model (taker 0.1%/chiều Binance spot).
3. Backtest dài hơn (vài nghìn nến) và trên H4/D1 để mẫu đủ lớn.
4. Phân tích bySetup/byGrade để lọc setup có edge thật.
