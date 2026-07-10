# Plan: Fix look-ahead bias trong SMC backtest

Task-id: `smc-backtest-fixes`
Ngày: 2026-07-10
Lead: Claude (Fable 5)

## Bối cảnh

Chạy `npm run backtest:smc` (M15, 500 bars, 22 pairs) cho kết quả 84.5% win rate, avg R:R 1.68, avgBarsHeld ~1.2 nến. Review code xác nhận kết quả bị thổi phồng do look-ahead bias trong `src/charts/smc/smc-backtest.ts`:

1. **Fill trên chính nến sinh signal** (`fillSignal`, line ~191): signal sinh tại nến `triggerIndex` (dựa trên dữ liệu nến đó đã đóng) nhưng fill được quét từ chính `triggerIndex` — thực tế phải từ nến sau.
2. **TP check bằng full high/low của nến fill** (`scanOutcome`, line ~157): nến chạm entry rồi backtest cho chạm luôn TP trong cùng nến, kèm ưu tiên TP3 > TP2 > TP1 (lạc quan nhất). Đây là lý do avgBarsHeld ≈ 0.
3. **Trade `open_at_end` khoá vĩnh viễn** (line ~307): `openTradeUntilIndex = candles.length - 1` chặn mọi signal còn lại (SHIB: 11/12 signals bị skip).

## Mục tiêu

Backtest phản ánh đúng thực tế thực thi lệnh (không look-ahead), sau đó chạy lại để có baseline trung thực. KHÔNG thay đổi logic sinh signal (`smc-pipeline.ts` và các module smc-* khác), KHÔNG thêm fee/slippage model (ngoài scope, sẽ làm task riêng).

## Nguyên tắc thiết kế

- Fill chỉ được xét từ `triggerIndex + 1` trở đi (giữ maxLookahead = 5 nến kể từ nến đầu tiên được phép fill).
- Trên nến fill: chỉ được kết luận **stop** (conservative). TP chỉ được xét từ nến `fillIndex + 1` trở đi.
- Trong một nến vừa chạm SL vừa chạm TP: kết luận **stop** (conservative, giữ hành vi hiện tại — SL check trước).
- Trade không đóng sau `maxHoldBars = 96` nến (~1 ngày M15) kể từ fill → outcome `expired_hold`, exit tại close của nến đó, RR tính theo close; giải phóng slot cho signal sau.
- Cập nhật mảng `assumptions` trong report cho khớp hành vi mới.

## Subtasks

| # | Subtask | File chính | Mô tả | Phụ thuộc |
|---|---------|-----------|-------|-----------|
| 01 | fix-lookahead-fill | `src/charts/smc/smc-backtest.ts` | Fill từ `triggerIndex + 1`; nến fill chỉ được xét SL; TP xét từ nến sau fill | — |
| 02 | max-hold-timeout | `src/charts/smc/smc-backtest.ts` | Thêm outcome `expired_hold` với `maxHoldBars = 96`, giải phóng slot, RR theo close | 01 |
| 03 | update-tests-and-rerun | `tests/charts/smc/smc-backtest.test.ts` | Cập nhật/bổ sung test cho hành vi mới, chạy full test + backtest, ghi lại kết quả so sánh | 01, 02 |

## Acceptance criteria

- `npm run build` và `npm run test` pass.
- Không còn trade nào có `exitIndex === entryIndex` với outcome tp1/tp2/tp3.
- Không còn trade nào fill tại `triggerIndex`.
- SHIB không còn bị skip 11/12 signals do 1 trade treo.
- `npm run backtest:smc` chạy xong, kết quả mới (dự kiến win rate giảm đáng kể) được ghi vào `tasks/smc-backtest-fixes/03-update-tests-and-rerun/result.md` kèm so sánh trước/sau.

## Out of scope

- Fee/slippage model.
- Partial exit theo capital management (TP1/TP2/TP3 split) — cân nhắc task tiếp theo sau khi có baseline sạch.
- Thay đổi logic sinh signal, HTF context, config pairs.
- Commit/push (theo runtime rules: không auto-commit).
