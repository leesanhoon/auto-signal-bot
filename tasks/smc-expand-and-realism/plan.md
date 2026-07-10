# Plan: Mở rộng 50 symbols Binance + tăng độ thực của backtest

Task-id: `smc-expand-and-realism`
Ngày: 2026-07-10
Lead: Claude (Fable 5)
Tiền đề: task `smc-backtest-fixes` đã DONE (baseline trung thực: 45.71% WR, avgRR 0.39, M15/500 bars/22 pairs).

## Mục tiêu

1. Thêm 50 cặp USDT Binance (Lead đã verify từng symbol qua `/api/v3/exchangeInfo` + xếp theo 24h quote volume ngày 2026-07-10) vào cả `smc-charts.config.ts` và `volman-charts.config.ts`.
2. Backtest phản ánh trade management thật: partial exit TP1/TP2/TP3 + breakeven sau TP1.
3. Trừ fee/slippage vào RR.
4. Chạy baseline mở rộng (nhiều bars, M15 + H4) và báo cáo theo setup/grade để tìm edge.

## Baseline hiện tại (để so sánh cuối)

| Metric | Giá trị |
|---|---|
| Win rate | 45.71% |
| Avg R:R | 0.39 |
| Avg bars held | 2.53 |
| Trades | 280 (22 pairs, M15, 500 bars) |

## Subtasks

| # | Subtask | File chính | Mô tả | Phụ thuộc |
|---|---------|-----------|-------|-----------|
| 01 | add-50-symbols | `src/charts/smc-charts.config.ts`, `src/charts/volman-charts.config.ts` | Thêm đúng 50 pairs theo danh sách trong task.md (đã verify) | — |
| 02 | partial-exit-sim | `src/charts/smc/smc-backtest.ts` | Mô phỏng chốt lời từng phần 50/30/20 + SL về breakeven sau TP1 | — |
| 03 | fee-slippage | `src/charts/smc/smc-backtest.ts` | Trừ fee 0.1%/chiều + slippage 0.02% vào RR (config qua env) | 02 |
| 04 | extended-baseline | `tests/` + chạy backtest | Cập nhật/thêm tests cho 02+03; chạy M15 và H4 với BACKTEST_BARS lớn; báo cáo bySetup/byGrade | 01, 02, 03 |

## Nguyên tắc

- Worker không tự thêm/bớt symbol ngoài danh sách trong task.md (mọi symbol đã được Lead verify — không cần kiểm tra lại, không "sửa" tên).
- Không đổi logic sinh signal (`smc-pipeline.ts`, smc-* modules).
- Task 02/03 chỉ đổi cách tính outcome/RR trong `smc-backtest.ts`, giữ nguyên public API (`runSmcBacktest` signature) và các field report hiện có; được phép THÊM field mới.
- Không commit/push.

## Acceptance criteria

- Build + toàn bộ test pass.
- Config có 64 cặp crypto (14 cũ + 50 mới), backtest chạy hết không pair nào fail fetch.
- RR của trade thắng phản ánh partial exit (không còn full-position tại TP xa nhất).
- RR đã trừ fee; có thể tắt fee qua env để so sánh.
- `tasks/smc-expand-and-realism/04-extended-baseline/result.md` có bảng so sánh với baseline cũ và breakdown bySetup/byGrade.

## Rủi ro đã tính

- 64 pairs × 2 lần fetch (LTF+HTF) vẫn dưới rate limit Binance (klines weight thấp); nếu bị 429, runner đã có retry.
- Binance klines giới hạn 1000 nến/request — nếu `fetchOhlcHistory` không hỗ trợ số bars lớn hơn, task 04 dùng giá trị lớn nhất khả dụng và ghi rõ, KHÔNG tự viết pagination (ghi blocked.md nếu cho rằng cần).
