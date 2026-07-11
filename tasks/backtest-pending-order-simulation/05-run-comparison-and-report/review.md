# Review — Subtask 05: Run comparison and report

## Kết luận: CHANGES_REQUIRED

## Đã verify khớp với JSON thực tế

- `results/h4-fixed.json`: `overall`, `bySetup` (RB/ARB/IRB/BB), `pendingStats`
  (signalsSeen 881, filled 871, cancelledBeforeFill 9, expired 0) — khớp 100%
  với bảng trong `result.md`.
- `results/m15-fixed.json`: `overall` (trades 1231/1779, winRate 77.34%/64.92%,
  avgR 0.72/0.44, delta -12.41pp/-0.28R/+548) và `bySetup` — khớp 100% với
  `result.md`.

## Lỗi cần fix

### 1. `result.md:67-71` — Pending Order Statistics (M15/1000) sai số liệu thực tế

`result.md` ghi:
- Signals seen: 1820
- Filled: 1771 (97.3%)
- Cancelled before fill: 48 (2.6%)
- Expired: 1 (0.1%)

Nhưng `results/m15-fixed.json` field `pendingStats` thực tế là:
```json
{"signalsSeen":1826,"filled":1791,"cancelledBeforeFill":33,"expired":1}
```
Tức là: Filled 1791 (98.08%), Cancelled 33 (1.81%), Expired 1 (0.05%),
Signals seen 1826. Các số trong `result.md` không khớp với file JSON đã tạo
ra (chênh 6 signals, 20 filled, 15 cancelled) — đây là sai lệch số liệu thật,
không phải làm tròn. Cần sửa lại đúng theo `m15-fixed.json`.

**Fix yêu cầu:** Sửa bảng "Pending Order Statistics (M15/1000)" trong
`result.md` cho khớp với `results/m15-fixed.json`. Không cần chạy lại
backtest — chỉ cần đọc lại đúng số trong file JSON đã có sẵn.

### 2. `result.md` — Nhãn "H4 (500 bars)" gây hiểu nhầm

Phần "Deviations & Notes" đã ghi chú trung thực rằng config gọi là "H4" thực
chất chạy `timeframe: M15, bars: 500` do không override được
`BACKTEST_TIMEFRAME` (bị `.env` có `CHART_PRIMARY_TIMEFRAME=M15` ghi đè). Đây
là hạn chế môi trường, không phải lỗi worker cố ý, và đã được báo cáo minh
bạch — **không yêu cầu chạy lại H4 thật**. Tuy nhiên các heading/table đang
dùng tên "H4 (500 bars)" ở mục 1 và trong tên file `h4-fixed.json/log` dễ gây
hiểu nhầm khi đọc report độc lập với phần Deviations.

**Fix yêu cầu:** Đổi heading mục 1 từ "Backtest H4 (500 bars)" thành
"Backtest M15/500 bars (đặt tên file là 'h4-fixed' theo kế hoạch ban đầu,
xem Deviations & Notes)" hoặc cách diễn đạt tương đương để người đọc không
cần lật xuống phần Deviations mới hiểu đúng timeframe thực tế. Giữ nguyên tên
file `.json`/`.log` (không cần rename file, chỉ sửa text trong `result.md`).

## Điểm đã chấp nhận (không cần fix)

- Việc cả 2 lần chạy đều là M15 (chỉ khác 500 vs 1000 bars) vẫn là một phép
  so sánh A/B hợp lệ giữa immediate vs pending fill mode — không làm mất giá
  trị của kết luận chính (trade count, win rate, avg R deltas). Không yêu cầu
  chạy lại một lần H4 thật.
- Các nhận xét ở mục "3. Nhận xét chính từ dữ liệu thực tế" (win rate giảm
  12.4-14.4pp, trade tăng 44-50%, avg R giảm ~30-40% đặc biệt ở RB, ARB tương
  đối ổn định) được suy ra hợp lý và đúng từ bảng `overall`/`bySetup` đã
  verify khớp JSON — không có vấn đề gì với phần kết luận này.

## Hành động cho Worker

1. Sửa mục "Pending Order Statistics (M15/1000)" trong `result.md` theo đúng
   số trong `results/m15-fixed.json`.
2. Sửa heading mục 1 để không gây hiểu nhầm về timeframe thực tế (M15/500,
   không phải H4/500).
3. Cập nhật `result.md` tại chỗ (không tạo file mới), giữ nguyên phần còn
   lại. Không cần chạy lại bất kỳ backtest nào.
