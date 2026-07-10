# Done — smc-followups

Ngày: 2026-07-11
Lead: Claude
Verdict: **APPROVED**

## Tóm tắt

4 subtasks hoàn thành, không deviation:

1. **01-fix-ohlc-cache-key**: `bypassCache` option cho `fetchOhlcHistory`, backward compatible với luồng live. Verify: đổi `BACKTEST_BARS` trong cùng phiên nay cho kết quả khác nhau (trước đây bị cache trộn).
2. **02-pin-backtest-window**: `BACKTEST_END_TIME` (ISO) pin dữ liệu Binance qua Binance klines `endTime`. Verify: 2 lần chạy cùng end time cho **JSON giống hệt nhau** — backtest giờ tái lập được.
3. **03-log-setup-grade-breakdown**: runner in thêm `bySetup`/`byGrade` gộp toàn bộ pairs.
4. **04-filter-analysis**: chạy pinned window `2026-07-08T00:00:00Z`, M15 + H4, 1000 bars. Lead đã tự đọc trực tiếp file JSON log thật (`m15-pinned.json`, `h4-pinned.json`) và đối chiếu từng số trong result.md — khớp chính xác, không có số bịa (khác hẳn lần review trước).

Verify cuối (Lead tự chạy): build pass, 753/753 test pass.

## Kết luận phân tích filter (snapshot 2026-07-08, chưa validate đa window)

- **H4 có edge dương tổng thể** (+0.33 avgRR, 51.29% WR). Setup `SMC_BOS_OB` (+0.50) và `SMC_CHOCH_OB` (+0.42) đóng góp chính; `SMC_FVG_CONTINUATION` âm (-0.30) trên cả 2 khung — ứng viên loại rõ ràng.
- **M15 không có edge** (-0.47 avgRR) ở mọi setup/grade — không nên dùng cho live tại thời điểm này.
- Grade A trên H4 vượt trội (+0.56 RR, 60% WR) nhưng mẫu nhỏ (80 trades) — cần thêm dữ liệu.
- Đề xuất loại pair PAXG/TRX/EIGEN trên H4 — Lead lưu ý PAXG (vàng token hoá) cần thêm window trước khi loại vĩnh viễn.

## Giới hạn quan trọng (Worker đã tự nêu, Lead đồng ý)

Đây là 1 snapshot tại 1 thời điểm — cần chạy thêm 3-5 pinned window khác nhau (ngày khác, market regime khác) trước khi áp dụng filter vào production. Không nên coi số liệu này là kết luận cuối cùng.

## Đề xuất task tiếp theo (nếu muốn tiếp tục)

1. `multi-window-validation`: chạy filter-analysis trên 4-5 `BACKTEST_END_TIME` khác nhau, chỉ giữ setup/pair dương ở đa số window (voting).
2. Nếu multi-window xác nhận H4 + BOS_OB/CHOCH_OB có edge ổn định: cân nhắc áp filter vào `smc-config-env.ts` / pipeline thật (cần task riêng, có review kỹ vì đụng luồng live).

Không commit — chờ quyết định của user.
