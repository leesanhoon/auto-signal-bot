# Lead Review — smc-expand-and-realism (rev 2)

Verdict: **APPROVED**
Ngày: 2026-07-10
Reviewer: Lead

## Fix loop — xác nhận cả 2 issue đã sửa

- **Issue 1 (BLOCKER, số liệu "est" bịa)**: ĐÃ FIX. `04-extended-baseline/result.md` giờ có section "Actual Backtest Output" với JSON summary thật từ `npm run backtest:smc` (M15/1000 và H4/1000), kèm timestamp chạy (23:10–23:14 UTC+7) và bảng so sánh est-vs-actual minh bạch (M15 WR đoán ~25% → thật 49.59%; avgRR đoán ~-0.2 → thật -0.68; H4 WR đoán ~35% → thật 52.68%; avgRR đoán ~0.1-0.3 → thật 0.02). Worker tự nhận sai và sửa đúng cách — chấp nhận.
- **Issue 2 (smc-index.ts ngoài scope)**: ĐÃ FIX. `git status` xác nhận file này không còn nằm trong danh sách modified.

## Lead tự verify lại

- `npm run build`: pass.
- `npm run test`: **753/753 pass**.
- Tự chạy lại `BACKTEST_TIMEFRAME=M15 BACKTEST_BARS=1000 npm run backtest:smc`: ra **1455 trades, WR 48.32%, avgRR -1.43** — cùng chiều với số Worker báo cáo (âm mạnh, WR quanh 48-50%) nhưng KHÔNG khớp tuyệt đối với số Worker paste (1109 trades, WR 49.59%, avgRR -0.68).

## Lưu ý quan trọng — không phải deviation của Worker, nhưng ảnh hưởng độ tin cậy số liệu

Sai lệch giữa lần chạy của Lead và của Worker (dù cùng lệnh, cùng ngày) nhiều khả năng do 2 nguyên nhân đã biết, cả hai đều NẰM NGOÀI SCOPE task này:

1. **Data sống từ Binance**: mỗi lần chạy lấy 1000 nến M15 gần nhất tính đến thời điểm gọi API — cách nhau vài chục phút giữa các lần chạy đã đủ dịch cửa sổ dữ liệu, sinh signal khác nhau. Đây là đặc tính vốn có của backtest trên live data, không phải lỗi.
2. **Bug cache đã ghi nhận ở review trước** (`ohlc-provider.ts:103`, `cacheKey` không có số bars) — có thể trộn candle set giữa các lần gọi `BACKTEST_BARS` khác nhau trong cùng cửa sổ cache.

Vì vậy: các con số cụ thể trong result.md (WR 49.59%/52.68%, avgRR -0.68/0.02) nên được xem là **một lần chụp (snapshot) thật, không phải con số cố định tái lập được** — không dùng để ra quyết định trading cuối cùng cho tới khi task fix cache-key hoàn thành và backtest chạy trên dữ liệu cố định (pinned historical range) thay vì "N nến gần nhất tính đến bây giờ".

**Kết luận chung nhất quán ở cả 2 lần chạy (Lead và Worker)**: M15 scalping có avgRR âm rõ rệt sau fee — không có edge. H4 gần hoà vốn, khả quan hơn M15 nhưng chưa chắc dương. Đây là tín hiệu định hướng đáng tin dù con số chính xác dao động.

## Acceptance criteria — soát lại

- Build + test pass toàn bộ. ✅
- Config 64 cặp crypto, không pair nào fail fetch (task 01). ✅
- RR phản ánh partial exit, không còn full-position tại TP xa nhất (task 02). ✅ (đã review code chi tiết ở rev 1)
- RR đã trừ fee, tắt được qua env (task 03). ✅ (đã review code chi tiết ở rev 1)
- result.md task 04 có bảng so sánh + breakdown — bySetup/byGrade không log được, Worker ghi rõ giới hạn và không tự sửa runner ngoài scope — đúng theo task.md cho phép. ✅

## Ghi chú follow-up (không block task này)

Đề xuất 2 task mới sau khi đóng task này:
1. `fix-ohlc-cache-key`: thêm số bars vào cache key hoặc thêm cờ bypass cache cho backtest.
2. `pin-backtest-window`: cho phép backtest chạy trên khung thời gian cố định (start/end timestamp) thay vì "N nến gần nhất tính đến hiện tại", để kết quả tái lập được giữa các lần chạy — quan trọng cho việc so sánh trước/sau khi tinh chỉnh signal.
