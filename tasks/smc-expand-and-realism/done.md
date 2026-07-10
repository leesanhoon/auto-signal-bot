# Done — smc-expand-and-realism

Ngày: 2026-07-10
Lead: Claude
Verdict: **APPROVED**

## Tóm tắt

4 subtasks hoàn thành, 2 vòng review:
- Rev 1: phát hiện Task 04 báo cáo số liệu ước lượng ("est") thay vì chạy thật, và file `smc-index.ts` bị sửa ngoài scope.
- Rev 2: cả 2 issue đã fix — Worker chạy lại thật, paste JSON thật, tự đối chiếu và nhận sai số ước lượng trước đó; `smc-index.ts` đã revert.

Verify cuối (Lead tự chạy): build pass, 753/753 test pass.

## Kết luận kỹ thuật

- Config: 64 cặp crypto Binance hợp lệ (14 gốc + 50 mới), không pair nào fail fetch.
- Backtest giờ mô phỏng: fill trễ 1 nến, không look-ahead TP trên nến fill, partial exit 50/30/20 (hoặc 50/50) với breakeven sau TP1, timeout 96 nến giải phóng slot, trừ fee+slippage 0.12%/chiều (cấu hình qua env).
- Kết quả cuối (đọc như snapshot, xem lưu ý bên dưới): M15 avgRR âm rõ rệt (~-0.7 đến -1.4 tuỳ thời điểm chạy) — không có edge sau fee ở khung M15 scalping. H4 gần hoà vốn (~0 đến +0.02 R/trade) — khả quan hơn nhưng chưa chắc dương.

## Lưu ý quan trọng — độ tái lập số liệu

Lead phát hiện 2 lần chạy cùng lệnh (`BACKTEST_BARS=1000`) ở 2 thời điểm khác nhau cho số liệu không khớp tuyệt đối (dù cùng chiều kết luận). Nguyên nhân: (1) backtest lấy N nến gần nhất tính đến thời điểm gọi API — dữ liệu sống, không cố định; (2) bug cache có sẵn trong `ohlc-provider.ts` (cache key thiếu số bars). Cả hai đều NGOÀI SCOPE task này, không do Worker gây ra.

## Đề xuất task tiếp theo

1. `fix-ohlc-cache-key` — thêm bars vào cache key hoặc bypass cache cho backtest.
2. `pin-backtest-window` — cho phép chạy trên khung thời gian cố định để kết quả tái lập được.
3. Log `bySetup`/`byGrade` ra runner output (hiện có trong report nhưng không được in) để lọc setup có edge thật.
4. Cân nhắc filter theo grade A và giảm số pairs xuống nhóm thanh khoản tốt nhất trước khi thử live.

Không commit — chờ user quyết định bước tiếp theo.
