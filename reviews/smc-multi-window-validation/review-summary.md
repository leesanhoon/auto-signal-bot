# Lead Review — smc-multi-window-validation (rev 2)

Verdict: **APPROVED**
Ngày: 2026-07-11
Reviewer: Lead

## Fix loop — xác nhận

Worker làm lại Task 02 hoàn toàn, trích số trực tiếp từ 10 file JSON. Lead verify độc lập bằng cách tự đọc field `bySetup`/`byGrade` trong nhiều file (không chỉ tin result.md):

| Window | Đối tượng | result.md (rev 2) | JSON thật | |
|---|---|---|---|---|
| M15 07-08 | BOS_OB / CHOCH_OB / FVG | -0.17 / -0.41 / -1.16 | -0.17 / -0.41 / -1.16 | ✅ |
| M15 07-08 | Grade A/B/C | -0.25 / -0.48 / -0.75 | -0.25 / -0.48 / -0.75 | ✅ |
| H4 07-08 | BOS_OB / CHOCH_OB / FVG | 0.50 / 0.42 / -0.30 | 0.50 / 0.42 / -0.30 | ✅ |
| H4 07-08 | Grade A/B | 0.56 / 0.31 | 0.56 / 0.31 | ✅ |
| M15 06-24 | BOS_OB / CHOCH_OB / FVG / Grade C | -0.23 / -0.27 / -0.95 / -1.36 | -0.23 / -0.27 / -0.95 / -1.36 | ✅ |
| H4 06-10 | BOS_OB / CHOCH_OB / Grade A | 0.55 / 0.40 / 0.50 | 0.55 / 0.40 / 0.50 | ✅ |
| M15 05-27 | BOS_OB / CHOCH_OB / FVG | -0.24 / -0.36 / -1.11 | -0.24 / -0.36 / -1.11 | ✅ |
| H4 05-13 | BOS_OB / CHOCH_OB / FVG | 0.53 / 0.51 / -0.30 | 0.53 / 0.51 / -0.30 | ✅ |

Toàn bộ 8 điểm kiểm tra ở cả 5 window đều khớp chính xác — đối lập hoàn toàn với rev 1.

**Kiểm tra thêm pair-level (aggregate, khó fake hơn vì phải tính đúng trung bình 5 số)**: LINK/USDT trên H4 — Lead tự lấy `avgRiskReward` từng window (0.85, 0.84, 1.14, 0.84, 0.90) và tính trung bình tay: `(0.85+0.84+1.14+0.84+0.90)/5 = 0.914` — khớp chính xác với số Worker báo cáo (0.914). Bảng pair-level đáng tin.

## Đánh giá nội dung

- Voting rule áp dụng đúng ngưỡng đã định (15 trades setup/grade, 8 trades pair; qualify >50% positive trong >=3 valid votes).
- Kết luận: H4 có edge dương nhất quán ở SMC_BOS_OB (0.48-0.55) và SMC_CHOCH_OB (0.39-0.51) qua cả 5 window; SMC_FVG_CONTINUATION loại rõ ràng ở cả 2 timeframe. M15 không có setup/grade nào qualify.
- Phần "Giới hạn" (mục 5) giữ nguyên từ rev 1 — nội dung đúng, đã cảnh báo rõ H4 overlap dữ liệu giữa các window (166 ngày lịch sử, window cách nhau 2 tuần) nên "5 window H4" không phải 5 mẫu độc lập thật; M15 độc lập hơn (10.4 ngày/window). Đề xuất paper-trading/forward-test trước khi đưa vào production — hợp lý, không quá tự tin vào kết quả backtest.

## Lead tự verify

- `npm run build`: pass.
- `npm run test`: 753/753 pass.
- Không có file src nào bị đổi.

## Kết luận

Task 01 + Task 02 đều APPROVED. Sẵn sàng ghi done.md.
