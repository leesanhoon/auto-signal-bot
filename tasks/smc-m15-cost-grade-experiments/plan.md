# Plan — SMC M15: Cost Realism + Grade Rework Experiments

## Bối cảnh

Backtest M15 (3000 nến, 64 cặp) cho thấy:
- Gross avg R = **+0.48** nhưng net (fee 0.1% + slippage 0.02%/chiều) = **-0.46** → phí ăn ~0.94R/lệnh do stop M15 quá hẹp so với notional.
- Grade hiện tại không phân tách chất lượng: A (+0.40 gross) ≈ B (+0.50 gross), vì score gần như cố định theo setup (BOS=80, CHOCH=72, FVG=74) và chỉ có 2 cờ phạt.
- `expired` = 37% tín hiệu không khớp lệnh trong 5 nến (không phải thua lỗ).

## Mục tiêu

1. Đo kịch bản phí thực tế hơn (maker 0.02%/chiều — Binance Futures limit order).
2. Thêm filter risk tối thiểu (`BACKTEST_MIN_RISK_PCT`) để loại lệnh có stop quá hẹp (phí quy R quá lớn).
3. Rework scoring: điểm cộng dồn từ các yếu tố dự báo (setup, P/D zone, session, RVOL, rejection wick, HTF bias) thay cho base score cố định; áp thống nhất cho cả backtest lẫn production. `confidence` giữ nguyên logic cũ (không đổi hành vi gate/min-confidence ở production).

## Subtasks

| # | Subtask | Files | Ghi chú |
|---|---|---|---|
| 01 | Min-risk filter cho backtest | `src/charts/smc/smc-backtest.ts` | Env `BACKTEST_MIN_RISK_PCT` (%, ví dụ 0.5); lọc signal có `|entry−SL|/entry*100 <` ngưỡng. Chỉ ảnh hưởng backtest. |
| 02 | Factor-based scoring module | `src/charts/smc/smc-scoring.ts` (mới), `tests/charts/smc/smc-scoring.test.ts` (mới) | `computeSetupScore`: base 40; BOS +15 / CHOCH +8 / FVG +8; P/D CORRECT +15 / UNKNOWN +5 / WRONG −10; session OVERLAP +10 / LONDON, NY +8 / ASIA +3 / OFF 0; RVOL ≥1.5 +10, ≥1.0 +5; rejection wick +5; HTF aligned +10; clamp 0–100. Ngưỡng grade giữ nguyên (A≥80, B≥50, C≥35). |
| 03 | Wire scoring vào pipeline | `src/charts/smc/smc-pipeline.ts` | Cả nhánh BOS/CHOCH lẫn FVG; FVG bổ sung tính RVOL/rejection/P/D zone. `confidence` giữ nguyên. |
| 04 | Chạy matrix backtest & báo cáo | — | M15/3000 nến: (a) maker fee, (b) maker fee + minRisk, (c) maker fee + bỏ FVG; xem byGrade có tách bạch không. |

## Ràng buộc

- Không auto-commit.
- Không đổi `confidence` (production gate `SMC_MIN_SIGNAL_CONFIDENCE=65` giữ nguyên hành vi).
- Build + test pass (`npm run build`, `npm run test`).
