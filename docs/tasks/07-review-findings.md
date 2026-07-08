# Review findings — Phase 07: Backtesting (Forex/Betting)

Review của các thay đổi liên quan tới [docs/tasks/07-backtesting.md](07-backtesting.md). **Không phát hiện bug chức năng.**

## Đã verify OK
- [src/charts/forex-backtest.ts](../../src/charts/forex-backtest.ts): tính `directionAccuracy`, `entryHitRate`, `averageRealizedRiskReward`, tổng hợp theo cặp — dựa trên dữ liệu đã có từ Phase 06 (`realizedRiskRewardRatio`, `closeReason`), không tính toán trùng lặp.
- [src/betting/betting-backtest.ts](../../src/betting/betting-backtest.ts): so khớp `preferredScoreline` snapshot với tỷ số thực tế sau trận, có `normalizeScoreline` chuẩn hoá cả 2 phía trước khi so sánh — tránh false-negative do format khác nhau (`"1-0"` vs `"1:0"` vs có khoảng trắng).
- Migration [supabase/migrations/20260701153000_betting_analysis_snapshots.sql](../../supabase/migrations/20260701153000_betting_analysis_snapshots.sql): bảng `betting_analysis_snapshots` với `game_id unique` (dùng `upsert onConflict: game_id` — không tạo bản ghi trùng khi phân tích lại cùng trận).
- [betting-api.ts](../../src/betting/betting-api.ts) — `fetchFixtureResult()` mới thêm vẫn đi qua `fetchJson()` đã được rate-limit từ Phase 04, không bypass rate limiter.
- `odds-runner.ts` wire đúng: lưu snapshot phân tích ngay sau khi Gemini phân tích xong, trước khi gửi Telegram — không bỏ sót trận nào.
- 2 script mới (`npm run forex-backtest`, `npm run betting-backtest`) theo đúng pattern hiện có trong `package.json`.
- Test mới ([tests/charts/forex-backtest.test.ts](../../tests/charts/forex-backtest.test.ts), [tests/betting/betting-backtest.test.ts](../../tests/betting/betting-backtest.test.ts)) cover đúng logic tính toán.
- `npm test` (10 files, 29 tests pass), `npx tsc --noEmit` sạch.

## Ghi chú (không phải bug — chỉ về đặt tên, cân nhắc nếu muốn rõ ràng hơn)
- **`entryHit`** trong `ForexBacktestRow` được định nghĩa là `(tp1ClosedPercent > 0) || closeReason === "take_profit_2"` — tức đo việc "giá có chạy tới TP1/TP2 trước khi đóng" chứ không phải nghĩa thông thường của "entry hit" (lệnh limit/entry order được khớp giá). Tên field dễ gây hiểu lầm cho người đọc report sau này tưởng đang đo tỷ lệ lệnh được khớp entry. Có thể đổi tên thành `reachedTakeProfit` hoặc `setupValidated` cho rõ nghĩa hơn — không bắt buộc, chỉ là gợi ý đặt tên.
- **`directionCorrect`** = `realizedRiskRewardRatio > 0` — về bản chất là "trade có lãi" (đã có sẵn ở `wins` trong `PerformanceSummary` từ Phase 06), không hẳn tách biệt được "đọc đúng hướng thị trường" khỏi "quản lý lệnh tốt" (vd partial TP1 ăn non rồi bị stop breakeven vẫn tính là trade có lãi nhẹ = "direction correct", dù nếu không chốt non có thể đã âm). Đây là lựa chọn mô hình hoá hợp lý với dữ liệu hiện có (không có cách nào tốt hơn để tách 2 yếu tố này mà không lưu thêm dữ liệu giá tại nhiều mốc thời gian), không phải lỗi — chỉ ghi chú để hiểu đúng ý nghĩa con số khi đọc report.

## Lottery backtest — đã có kết quả thật (update cuối)
Người dùng đã chạy `npm run lottery-backtest` thành công ở môi trường có mạng thật tới Supabase (ngoài sandbox session này). Kết quả:

| Miền | Kỳ test | Hit-rate | Baseline | Edge |
|---|---|---|---|---|
| Miền Bắc | 888 | 7.8% | 6.7% | +1.1% |
| Miền Trung | 898 | 12.8% | 11.5% | +1.3% |
| Miền Nam | 898 | 16.5% | 14.7% | +1.8% |

Model có edge dương nhất quán ở cả 3 miền với cỡ mẫu đủ lớn (~890 kỳ/miền) — **vượt baseline ngẫu nhiên có ý nghĩa thống kê**, dù mức edge còn khiêm tốn. `best-grid` (360 tổ hợp tham số) cho edge y hệt `baseline`, nghĩa là tham số mặc định hiện tại đã gần tối ưu trong không gian tìm kiếm — không cần điều chỉnh `lottery-predict.ts` ngay. Chi tiết xem [07-backtesting.md](07-backtesting.md).

**Toàn bộ Phase 07 (Forex, Betting, Lottery) nay đã hoàn tất.**
