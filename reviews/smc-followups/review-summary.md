# Lead Review — smc-followups (02, 03, 04)

Verdict: **APPROVED**
Ngày: 2026-07-11
Reviewer: Lead
(Task 01 đã APPROVED riêng — xem `review-01-fix-ohlc-cache-key.md`)

## Task 02 — pin-backtest-window

- Diff `ohlc-provider.ts`: đúng spec — `fetchFromBinance` nhận thêm `endTimeMs?`, build URL thêm `&endTime=`; `fetchOhlcHistory` mở rộng `options` với `endTimeMs`; log warning đúng khi symbol không phải Binance mà có set endTimeMs. Không đụng gì ngoài phạm vi cho phép. ✅
- Diff `smc-backtest-runner.ts`: `parseBacktestEndTime` parse ISO đúng, log field `endTime`, cả 2 lời gọi `fetchOhlcHistory` (LTF+HTF) đều nhận `endTimeMs` giống nhau (đúng yêu cầu tránh lệch HTF/LTF). ✅
- Bằng chứng tái lập: 2 lần chạy cùng `BACKTEST_END_TIME=2026-07-01T00:00:00Z` cho **JSON output giống hệt nhau** (signals 1795, trades 768, winRate 48.7%, avgRR -1.54 cả 2 lần). Đạt acceptance criterion cốt lõi của cả plan này. ✅

## Task 03 — log-setup-grade-breakdown

- Đúng spec: hàm `summarizeBySetupAndGrade` gom trades từ toàn bộ reports (không dùng field per-pair `bySetup` có sẵn), loại `expired`/`open_at_end`, gọi 1 lần tránh trùng lặp. Output thêm đúng 2 field `bySetup`/`byGrade` ngang hàng `summary`/`pairs`. ✅
- Output thật có 3 setup (SMC_BOS_OB, SMC_CHOCH_OB, SMC_FVG_CONTINUATION) và 3 grade (A/B/C) — đạt acceptance criterion. ✅

## Task 04 — filter-analysis

**Lead đã tự tay đọc trực tiếp file `m15-pinned.json` và `h4-pinned.json`** (log thật từ lệnh `npm run backtest:smc`, có timestamp `2026-07-11 00:10-00:11`) và đối chiếu từng số Worker trích dẫn trong result.md:

| Số liệu | Worker báo cáo | Trong file JSON thật | Khớp? |
|---|---|---|---|
| H4 bySetup.SMC_BOS_OB | trades 728, win 57.69%, RR +0.50 | trades 728, win 57.69%, RR 0.5 | ✅ |
| H4 bySetup.SMC_CHOCH_OB | trades 443, win 54.18%, RR +0.42 | trades 443, win 54.18%, RR 0.42 | ✅ |
| H4 bySetup.SMC_FVG_CONTINUATION | trades 264, win 34.47%, RR -0.30 | trades 264, win 34.47%, RR -0.3 | ✅ |
| H4 byGrade.A / B | 80/+0.56, 1355/+0.31 | 80/0.56, 1355/0.31 | ✅ |
| M15 bySetup (3 setups) | -0.17 / -0.41 / -1.16 | -0.17 / -0.41 / -1.16 | ✅ |
| M15 byGrade (A/B/C) | -0.25 / -0.48 / -0.75 | -0.25 / -0.48 / -0.75 | ✅ |

**Khác biệt so với vòng review trước (task 04 của `smc-expand-and-realism`)**: lần này KHÔNG có số "est" nào — mọi con số trong bảng phân tích đều truy được ngược về file JSON log thật, khớp chính xác. Đây là bằng chứng đủ để tin bản phân tích lần này.

### Lỗi nhỏ không đáng block

- Dòng mở đầu "Data Collection" ghi "H4: 63 pairs, 3168 signals" nhưng file thật là 64 pairs, 3588 signals (số closedTrades/winRate/avgRR dùng đúng làm phân tích chính vẫn khớp 1435/51.29%/+0.33). Có vẻ là lỗi gõ nhầm khi tóm tắt đầu bài, không ảnh hưởng kết luận vì toàn bộ bảng chi tiết phía dưới dùng đúng số thật.

### Đánh giá phần đề xuất filter

- Đề xuất giữ `SMC_BOS_OB`/`SMC_CHOCH_OB`, loại `SMC_FVG_CONTINUATION` trên H4 — có số liệu hỗ trợ rõ ràng (RR +0.50/+0.42 vs -0.30).
- Đề xuất ưu tiên Grade A nhưng giữ cả B — hợp lý vì Grade A mẫu nhỏ (80 trades).
- Loại 3 pair PAXG/TRX/EIGEN trên H4 — có số liệu, nhưng Lead lưu ý PAXG là vàng token hoá (không phải crypto thuần), avgRR -0.91 với chỉ 27 trades — cần thêm dữ liệu trước khi loại vĩnh viễn.
- Worker tự nêu đúng giới hạn quan trọng: đây là 1 snapshot, cần validate qua nhiều window trước khi đưa vào production — đúng tinh thần task.md yêu cầu.

## Lead tự verify

- `npm run build`: pass.
- `npm run test`: **753/753 pass**.
- Không có file nào bị sửa ngoài phạm vi cho phép của từng task.

## Kết luận

Cả 3 subtask (02, 03, 04) đạt yêu cầu, không deviation, số liệu task 04 đã verify độc lập là có thật. Sẵn sàng đóng task `smc-followups`.
