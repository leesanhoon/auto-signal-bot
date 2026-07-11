# Task: Backtest Pending Order Simulation — DONE

Tất cả 5 subtask đã APPROVED (mỗi thư mục con đều có `done.md`):
- `01-pending-order-engine`
- `02-runner-cli-flags`
- `03-compare-runner`
- `04-tests`
- `05-run-comparison-and-report`

## Tóm tắt A/B thực nghiệm (immediate fill vs pending order fill)

Dữ liệu thật lấy từ `npm run backtest:compare`, 64 cặp tiền, exit mode fixed,
pending expiry 2 bars. Chạy 2 cấu hình (cả hai đều là timeframe M15, khác số
bars — xem ghi chú deviation bên dưới):

### Cấu hình A — M15 / 500 bars

| Metric | Immediate | Pending | Delta |
|---|---|---|---|
| Trades | 573 | 859 | +286 (+50.0%) |
| Win Rate | 76.6% | 62.2% | -14.4 pp |
| Avg R | 0.72R | 0.38R | -0.33R |

By setup (immediate → pending):
- RB: 311→555 trades, 81.7%→62.5% win, 0.75R→0.33R
- ARB: 157→146 trades, 74.5%→74.0% win, 0.57R→0.57R (ổn định nhất)
- IRB: 85→136 trades, 63.5%→47.1% win, 0.81R→0.32R
- BB: 20→22 trades, 70.0%→68.2% win, 0.95R→0.93R

Pending order stats: 881 signal, filled 871 (98.9%), cancelled trước fill 9
(1.0%), expired 0 (0.0%).

### Cấu hình B — M15 / 1000 bars

| Metric | Immediate | Pending | Delta |
|---|---|---|---|
| Trades | 1231 | 1779 | +548 (+44.5%) |
| Win Rate | 77.3% | 64.9% | -12.4 pp |
| Avg R | 0.72R | 0.44R | -0.28R |

By setup (immediate → pending):
- RB: 666→1149 trades, 80.2%→63.0% win, 0.72R→0.34R
- ARB: 350→319 trades, 78.9%→79.9% win, 0.67R→0.70R (nhích lên, ổn định nhất)
- IRB: 180→268 trades, 65.0%→55.2% win, 0.82R→0.52R
- BB: 35→43 trades, 71.4%→65.1% win, 0.93R→0.77R

Pending order stats: 1826 signal, filled 1791 (98.08%), cancelled trước fill
33 (1.81%), expired 1 (0.05%).

## Nhận xét

- Pending mode tăng số trade **44-50%** — bắt được các entry mà immediate
  mode bỏ qua (chờ giá thực sự chạm entry ở nến sau).
- Win rate giảm **12.4-14.4 pp** và avg R giảm **~30-40%** (đặc biệt RB:
  0.72-0.75R → 0.33-0.34R) — vì pending order có rủi ro bị SL trước khi
  chạm entry.
- **ARB (reversal-based) là setup duy nhất pending mode không làm giảm
  hiệu quả** — win rate và avg R giữ nguyên hoặc nhích lên nhẹ ở cả 2 lần
  chạy. RB (retracement-based) bị ảnh hưởng nặng nhất.
- Fill rate của pending order engine rất cao (98-99%), cancel/expiry thấp
  — engine hoạt động đúng thiết kế, không phải nguyên nhân gây lệch số liệu.

## Khuyến nghị

**Không nên bật pending mode toàn bộ (global) trong production** dựa trên
dữ liệu này — tổng thể avg R và win rate giảm đáng kể dù trade count tăng,
tức lợi nhuận kỳ vọng trên mỗi trade giảm mạnh hơn mức bù lại từ số lượng
trade tăng thêm (avg R giảm 30-40% > trade tăng 44-50%, cần tính kỹ expectancy
tổng nhưng xu hướng chung là bất lợi cho RB/IRB).

Có thể cân nhắc **bật pending mode có chọn lọc chỉ cho setup ARB** — đây là
setup duy nhất pending mode không làm giảm avg R/win rate (thậm chí nhích
nhẹ ở cấu hình 1000 bars), phù hợp về mặt logic (ARB là reversal setup, cần
xác nhận giá chạm đúng entry trước khi vào, khác với RB cần vào nhanh theo
retracement).

Trước khi quyết định cuối, nên chạy thêm ít nhất 1 lần backtest thật trên
timeframe H4 (khắc phục giới hạn `.env` `CHART_PRIMARY_TIMEFRAME=M15` hiện
tại) để xác nhận xu hướng có giữ nguyên ở timeframe khác, vì toàn bộ dữ liệu
hiện có đều chỉ chạy trên M15.

## Deviation đã ghi nhận (không blocking)

Cấu hình A ban đầu dự định chạy H4/500 bars theo default của repo nhưng do
`.env` có `CHART_PRIMARY_TIMEFRAME=M15` khiến không override được
`BACKTEST_TIMEFRAME`, nên thực tế cả 2 cấu hình đều chạy trên M15 (chỉ khác
số bars 500 vs 1000). Điều này đã được Worker ghi chú minh bạch trong
`result.md`, và Lead xác nhận đây vẫn là phép so sánh A/B hợp lệ giữa
immediate vs pending fill mode — chỉ thiếu góc nhìn thật trên H4 (xem
khuyến nghị ở trên).

## File liên quan

- `tasks/backtest-pending-order-simulation/05-run-comparison-and-report/result.md`
- `tasks/backtest-pending-order-simulation/results/h4-fixed.json` (thực chất M15/500)
- `tasks/backtest-pending-order-simulation/results/m15-fixed.json` (M15/1000)
