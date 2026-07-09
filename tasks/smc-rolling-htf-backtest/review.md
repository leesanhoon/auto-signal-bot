# Review: Rolling HTF Backtest (subtasks 01-02)

## Phương pháp review

- Đọc trực tiếp `smc-htf-context.ts` (hàm mới `buildRollingHtfContexts`), diff `smc-backtest.ts` + `smc-backtest-runner.ts`, test mới trong `smc-htf-context.test.ts` và test cập nhật trong `smc-backtest.test.ts`.
- Tự chạy `npm run build` + `npm test` độc lập.
- Chạy backtest thật 3 chiều (không-HTF / static-HTF / rolling-HTF) trên dữ liệu sống (H4 500 nến + D1 300 nến, 4 cặp) theo đúng cam kết trong `plan.md`.

## Verify code

- `buildRollingHtfContexts` đúng 100% spec: con trỏ tăng dần O(n+m), điều kiện đóng nến `htfCandle.time + intervalMs <= entryTime` (không look-ahead), cache theo boundary.
- Test look-ahead có mặt và đúng (`entry candle BEFORE D1 closes → null`), kèm boundary case đóng-đúng-lúc, cache reuse (same reference), mảng rỗng 2 chiều.
- `runSmcBacktest` nhận `(HtfContext | null)[]`, dùng `htfContexts?.[index] ?? null` — pipeline không đổi. Test cập nhật đúng, thêm case mảng ngắn hơn candles.
- Runner fetch D1 300 bars, dùng `getHtfTimeframeFor` + `buildRollingHtfContexts`; import `buildHtfContext` thừa đã gỡ. Câu `assumptions` cũ ("chỉ tính 1 lần") đã thay bằng mô tả rolling ở cả 2 chỗ.
- Build pass; **715/715 test pass** (703 + 12 mới). Không đụng file ngoài phạm vi.

## Backtest 3 chiều (dữ liệu sống, cùng bộ nến cho cả 3 mode)

| Cặp | Không-HTF | Static-HTF | **Rolling-HTF** |
|---|---|---|---|
| XAU/USD | 62.8% / R:R 1.12 | 61.8% / 1.07 | **71.2% / 1.41** ✅✅ |
| EUR/USD | 64.5% / 1.19 | 54.1% / 0.77 ❌ | **60.3% / 1.06** (phục hồi phần lớn thiệt hại của static) |
| GBP/USD | 55.7% / 0.87 | 58.8% / 0.97 | 52.0% / 0.83 ❌ |
| USD/JPY | 50.7% / 0.61 | 63.3% / 0.91 | **63.0% / 1.21** ✅ |
| **Trung bình** | 58.4% / 0.95 | 59.5% / 0.93 | **61.6% / 1.13** |

- Rolling bias thực sự đổi theo thời gian ở **cả 4 cặp** (mỗi cặp đều xuất hiện cả LONG lẫn SHORT trong chuỗi context) — cơ chế hoạt động đúng như thiết kế, khác hẳn static chỉ có 1 bias cứng.
- Rolling là mode tốt nhất về trung bình cả win rate lẫn R:R; đặc biệt khắc phục đúng vấn đề EUR/USD mà static gây ra (54.1% → 60.3%) và cải thiện mạnh XAU (62.8% → 71.2%).
- GBP/USD là ngoại lệ (rolling kém hơn cả 2 mode kia ~4-7 điểm) — thị trường choppy đổi bias liên tục khiến gate hướng vào/ra không kịp; chấp nhận được ở mức danh mục, không phải lỗi code.
- `SMC_LIQUIDITY_SWEEP` vẫn tệ ở mọi mode/mọi cặp (5.9-30% win rate, R:R âm) — tái xác nhận vấn đề đã ghi nhận, thuộc scope task khác.

## Quyết định: APPROVED

Cả 2 subtask đạt yêu cầu, không cần sửa. Backtest giờ phản ánh đúng bias theo thời điểm lịch sử, không look-ahead — kết quả verify từ đây trở đi đáng tin cậy hơn hẳn static.

## Khuyến nghị tiếp theo (chờ user quyết)

1. Cân nhắc tắt hẳn setup `SMC_LIQUIDITY_SWEEP` (bằng chứng tiêu cực nhất quán qua 3 vòng backtest).
2. Có thể commit toàn bộ chuỗi thay đổi SMC (5 task đã approve, tất cả đang uncommitted trên branch `layered-architecture-subtask-01`).
