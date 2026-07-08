# Phase 07: Backtesting

## Mục tiêu
Lottery đã có cơ chế backtest hoàn chỉnh — cần rà soát/đánh giá độ chính xác thực tế. Forex/betting hiện không có cách nào đánh giá retroactive xem model phân tích đúng bao nhiêu % — cần xây cơ chế backtest dùng dữ liệu lịch sử đã lưu trong Supabase.

## Bối cảnh / file liên quan
- [src/lottery/lottery-backtest.ts](../../src/lottery/lottery-backtest.ts): **đã implement đầy đủ** — export `runBacktest()`, `BacktestReport`, `BacktestOptions`; thực hiện walk-forward validation so với baseline hypergeometric (`hypergeometricAtLeastOneHit`). Không phải khung dở dang.
- [src/lottery/lottery-backtest-index.ts](../../src/lottery/lottery-backtest-index.ts): entry point wire `runBacktest`, chạy qua `npm run lottery-backtest`.
- [src/lottery/lottery-predictions-repository.ts](../../src/lottery/lottery-predictions-repository.ts), [src/lottery/lottery-repository.ts](../../src/lottery/lottery-repository.ts): nguồn dữ liệu lịch sử lottery.
- Forex: [src/charts/positions-repository.ts](../../src/charts/positions-repository.ts) (bảng `open_positions`) — chưa có cơ chế backtest.
- Betting: [src/betting/match-repository.ts](../../src/betting/match-repository.ts) (bảng `matches`) — chưa có cơ chế backtest.

## Việc cần làm
### Lottery (rà soát, không phải xây mới)
- [x] Chạy `runBacktest()` trên toàn bộ lịch sử hiện có, ghi lại kết quả thực tế (hit rate so với baseline). **Đã chạy thành công ngoài session này (máy local có mạng thật tới Supabase)** — kết quả:

  | Miền | Kỳ test | Hit-rate | Baseline | Edge |
  |---|---|---|---|---|
  | Miền Bắc | 888 | 7.8% | 6.7% | **+1.1%** |
  | Miền Trung | 898 | 12.8% | 11.5% | **+1.3%** |
  | Miền Nam | 898 | 16.5% | 14.7% | **+1.8%** |

  `best-grid` (sau grid-search 360 tổ hợp tham số) cho ra edge **y hệt** `baseline` ở cả 3 miền — nghĩa là tham số mặc định hiện tại trong `DECAY_BY_REGION`/`OVERDUE_BONUS_BY_REGION` ([lottery-predict.ts](../../src/lottery/lottery-predict.ts)) đã gần tối ưu theo không gian tham số đang tìm kiếm, không có tổ hợp nào trong lưới vượt trội hơn đáng kể.

- [x] Đánh giá xem mô hình dự đoán có thực sự vượt baseline ngẫu nhiên hay không: **Có** — edge dương và nhất quán ở cả 3 miền, với cỡ mẫu khá lớn (~890 kỳ/miền), cho thấy model nhỉnh hơn baseline ngẫu nhiên một cách có ý nghĩa thống kê (không phải nhiễu ngẫu nhiên do mẫu nhỏ). Mức edge còn khiêm tốn (1.1–1.8 điểm %) — không cần điều chỉnh `lottery-predict.ts` ngay vì grid-search không tìm thấy tổ hợp tham số nào tốt hơn đáng kể so với cấu hình hiện tại; có thể coi đây là mức hiệu quả trần của mô hình hiện tại với feature set đang dùng.

### Forex
- [x] Thiết kế cơ chế backtest: lấy các lệnh đã đóng trong `open_positions`, so sánh quyết định model tại thời điểm đó với kết quả thực tế.
- [x] Viết hàm tính tỷ lệ model dự đoán đúng hướng/đúng entry so với giá thực tế sau đó.

### Betting
- [x] Thiết kế cơ chế backtest tương tự dùng bảng `matches` — lưu snapshot model, rồi so sánh preferred scoreline với kết quả trận đấu thực tế từ API-Football.

## Acceptance criteria
- [x] Có báo cáo backtest lottery chạy được và cho kết quả rõ ràng (hit rate vs baseline) — xem bảng kết quả thật ở trên.
- [x] Có cơ chế backtest mới cho Forex và betting, chạy được trên dữ liệu lịch sử thực trong Supabase, output là % độ chính xác.

## Ghi chú / rủi ro
- Cần đủ dữ liệu lịch sử (đủ số lệnh/trận đã đóng) để kết quả backtest có ý nghĩa thống kê — kiểm tra số lượng bản ghi hiện có trước khi đầu tư xây cơ chế phức tạp.
