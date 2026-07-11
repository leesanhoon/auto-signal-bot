# Kết quả — SMC M15: Cost Realism + Grade Rework (2026-07-11)

## Cấu hình "combo B" được validate

- Timeframe M15, 64 cặp, HTF bias H4 (rolling)
- Fee maker 0.02%/chiều + slippage 0.02%/chiều (`BACKTEST_FEE_RATE=0.0002 BACKTEST_SLIPPAGE_RATE=0.0002`)
- Min-risk filter 0.5% (`BACKTEST_MIN_RISK_PCT=0.5`)
- Grading factor-based mới (`smc-scoring.ts`)

## Matrix chính (M15, 3000 nến, cửa sổ hiện tại 11/07)

| Kịch bản | Trades | Win% | Avg R (net) |
|---|---|---|---|
| Taker fee 0.1% (giả định cũ) | 3917 | 49.8% | -0.46 |
| A: maker fee | 3920 | 49.8% | +0.17 |
| **B: maker fee + min-risk 0.5%** | 1330 | 53.8% | **+0.49** |
| C: maker fee + bỏ FVG | 3570 | 52.5% | +0.27 |

Kết luận matrix: phí là nguyên nhân chính khiến avg R âm (gross = +0.48). Min-risk 0.5% là filter hiệu quả nhất (loại ~70% tín hiệu stop quá hẹp). FVG không cần bỏ khi có min-risk (+0.38R trong combo B).

## Multi-window validation combo B (5 cửa sổ)

| Cửa sổ (end time) | Bars | Trades | Win% | Avg R | Grade A (trades / Avg R) | Grade B Avg R |
|---|---|---|---|---|---|---|
| 2026-05-13 | 1000 | 403 | 50.4% | +0.46 | 76 / +0.61 | +0.43 |
| 2026-05-27 | 1000 | 377 | 49.9% | +0.39 | 77 / +0.50 | +0.36 |
| 2026-06-10 | 1000 | 864 | 55.3% | +0.56 | 127 / +0.41 | +0.60 |
| 2026-06-24 | 1000 | 461 | 55.8% | +0.51 | 85 / +0.75 | +0.47 |
| 2026-07-11 (latest) | 3000 | 1330 | 53.8% | +0.49 | 291 / +0.69 | +0.44 |

### Kết luận validation

- **Edge dương ổn định trên cả 5/5 cửa sổ** (+0.39 → +0.56R), không có cửa sổ âm → combo B không phải overfit một giai đoạn.
- **Grade A > B ở 4/5 cửa sổ** (ngoại lệ 10/06); premium trung bình ~+0.15–0.3R. Grade A đáng dùng làm tiêu chí ưu tiên nhưng chưa đủ chắc để chỉ-trade-A.
- **Grade C mẫu quá nhỏ** (1–35 trades/cửa sổ) để kết luận; pooled thiên về âm. Giữ khuyến nghị loại C nhưng cần thêm dữ liệu.

## Thay đổi code (chưa commit)

- `src/charts/smc/smc-backtest.ts`: env `BACKTEST_EXCLUDE_SETUPS`, `BACKTEST_MIN_RISK_PCT` (backtest-only)
- `src/charts/smc/smc-scoring.ts` (mới): `computeSetupScore` factor-based
- `src/charts/smc/smc-pipeline.ts`: wire scoring vào 2 nhánh BOS/CHOCH + FVG; nhánh FVG bổ sung RVOL/rejection/P-D zone; `confidence` giữ nguyên logic cũ
- Tests: `tests/charts/smc/smc-scoring.test.ts` (mới, 6 test), cập nhật 5 test trong `smc-pipeline.test.ts`
- Build + 757 tests pass

## Bước tiếp theo đề xuất

1. Xác nhận venue thực tế có maker fee ≤ 0.02% (Binance Futures limit order).
2. Đưa min-risk 0.5% thành filter production trong `smc-pipeline.ts` (hiện chỉ ở backtest).
3. Theo dõi grade C thêm trước khi hard-filter.
