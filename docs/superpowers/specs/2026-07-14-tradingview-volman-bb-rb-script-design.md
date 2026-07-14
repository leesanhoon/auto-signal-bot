# TradingView Pine Script — Volman BB/RB (Indicator + Strategy)

## Mục tiêu

Port 2 setup cốt lõi của hệ thống Volman hiện có trong bot (`src/charts/setups/bb.ts`, `src/charts/setups/rb.ts`) sang Pine Script v6 cho TradingView, để user có thể quan sát/backtest trực quan trên chart mà không cần chạy bot.

Phạm vi: chỉ **BB (Block Break)** và **RB (Range Break)**. Không port SB, IRB, ARB, DDB, FB (có thể làm sau nếu cần). Không port session filter (London/NY overlap), không port ATR floor, không port confidence score.

## Deliverables

Hai file Pine Script v6 độc lập, dùng chung logic core được viết lại trùng lặp trong mỗi file (Pine không có cơ chế import module dùng chung giữa indicator/strategy dễ dàng ở dạng publish-once):

1. `pinescript/volman-bb-rb-indicator.pine`
   - `indicator()`, overlay=true
   - Vẽ EMA21, đánh dấu compression box (BB/RB), plot mũi tên/label tại điểm entry, vẽ SL/TP dự kiến bằng `line`/`label`
   - `alertcondition()` riêng cho: BB Long, BB Short, RB Long, RB Short

2. `pinescript/volman-bb-rb-strategy.pine`
   - `strategy()`, dùng `strategy.entry` / `strategy.exit` để backtest trong Strategy Tester
   - Áp dụng cùng entry/exit logic để so kết quả với indicator

Cả hai chạy trên bất kỳ timeframe/symbol nào user đang mở chart trên TradingView (không hardcode timeframe hay symbol).

## Chỉ số & bộ lọc dùng chung (áp dụng cho cả BB và RB)

- **EMA21**: EMA chuẩn (SMA-seeded), period là input, mặc định 21. Tương đương `indicators.ts:29-55`.
- **ATR14**: EMA của True Range, period là input, mặc định 14. Tương đương `indicators.ts:66-91`.
- **Trend Slope Classifier**:
  - `slope = (EMA21 - EMA21[5]) / ATR14`
  - UPTREND nếu `slope > 0.15` VÀ ≥6/10 nến gần nhất đóng cửa trên EMA21
  - DOWNTREND nếu `slope < -0.15` VÀ ≥6/10 nến gần nhất đóng cửa dưới EMA21
  - Ngược lại là FLAT
  - Ngưỡng 0.15 và cửa sổ 6/10 là input có thể chỉnh.
- **Compression/Block detector** (sliding window):
  - `range = highest(high, window) - lowest(low, window)`
  - Block hợp lệ nếu `range <= kBlock * ATR14`
  - BB: `window` mặc định trong khoảng 4–6 nến (input, mặc định 5), `kBlock` mặc định 1.2
  - RB: `window` mặc định trong khoảng 6–10 nến (input, mặc định 8), `kBlock` mặc định 2.0

## Entry logic

### BB (Block Break)
1. Trend hiện tại phải là UPTREND hoặc DOWNTREND (không phải FLAT)
2. Một block chặt (compression window thỏa điều kiện `kBlock`) hình thành gần EMA21 (giá trong block gần EMA21, khoảng cách kiểm tra bằng ATR)
3. Nến đóng cửa phá vỡ biên trên/dưới của block theo đúng hướng trend
   - UPTREND + đóng cửa trên biên trên block → LONG
   - DOWNTREND + đóng cửa dưới biên dưới block → SHORT

### RB (Range Break)
1. EMA21 phải FLAT trước breakout (`|slope| <= 0.15` tại các nến trước điểm breakout, kiểm tra trong window)
2. Trong window compression, giá phải chạm biên (trên hoặc dưới) tối thiểu 2 lần (đếm số nến có high/low chạm sát biên trong ngưỡng ATR)
3. Nến đóng cửa phá vỡ biên thật (đóng cửa vượt biên, không chỉ high/low chạm) và ngay sau đó EMA21 bắt đầu nghiêng theo hướng breakout
   - Phá biên trên + slope bắt đầu dương → LONG
   - Phá biên dưới + slope bắt đầu âm → SHORT

Chỉ 1 tín hiệu tại 1 thời điểm (không entry chồng lệnh); nếu cả BB và RB cùng trigger trên 1 nến, ưu tiên theo thứ tự input (mặc định BB trước).

## Exit logic

- **Stop Loss**: đặt tại biên đối diện của compression box tại thời điểm entry (biên dưới cho LONG, biên trên cho SHORT)
- **Take Profit**: `entry ± TP_R_MULTIPLE * risk`, với `risk = |entry - SL|`. `TP_R_MULTIPLE` là input, mặc định 2 (2R), khớp với `TP_R_MULTIPLE` mặc định của bot hiện tại.
- **Breakeven**: khi giá đạt mốc 1R theo hướng lệnh (`oneRLevel = entry + risk` cho LONG, `entry - risk` cho SHORT), di SL về entry.
  - Ở bản indicator: chỉ vẽ lại đường SL đã di chuyển bằng `line`, kèm label thông báo trực quan (không tự động gửi lệnh).
  - Ở bản strategy: cập nhật lại `stop=` trong `strategy.exit` bằng biến `var float` lưu SL hiện tại của lệnh đang mở, gọi lại `strategy.exit` mỗi khi điều kiện breakeven kích hoạt.
- **EMA Exit**: nếu nến đóng cửa cắt ngược EMA21 (đóng dưới EMA21 với LONG, đóng trên EMA21 với SHORT) → đóng lệnh ngay, bất kể đã chạm breakeven hay chưa. Input bật/tắt (`EMA_EXIT_ENABLED`, mặc định true), dùng chung EMA21 period ở trên (mặc định 21).

## Inputs (tổng hợp)

| Input | Mặc định | Ghi chú |
|---|---|---|
| `emaPeriod` | 21 | Dùng cho trend + EMA exit |
| `atrPeriod` | 14 | |
| `trendSlopeThreshold` | 0.15 | Ngưỡng UPTREND/DOWNTREND |
| `trendCandleWindow` | 10 | Cửa sổ đếm nến đóng trên/dưới EMA |
| `trendCandleMinCount` | 6 | Số nến tối thiểu trong window |
| `bbWindow` | 5 | Cửa sổ compression cho BB |
| `bbKBlock` | 1.2 | Hệ số ATR cho BB |
| `rbWindow` | 8 | Cửa sổ compression cho RB |
| `rbKBlock` | 2.0 | Hệ số ATR cho RB |
| `rbMinTouches` | 2 | Số lần chạm biên tối thiểu trước breakout thật |
| `tpRMultiple` | 2.0 | Take profit theo R |
| `emaExitEnabled` | true | Bật/tắt EMA exit |
| `enableBB` / `enableRB` | true / true | Bật/tắt từng setup |

## Không nằm trong phạm vi

- Session filter (London/NY overlap 13:00–21:00 UTC)
- ATR floor (so với ATR trung bình 20 ngày)
- Confidence score / entry-distance guard
- 5 setup còn lại: SB, IRB, ARB, DDB, FB
- Gửi webhook JSON tự động ra bot (chỉ dùng `alertcondition()` để user tự cấu hình alert trên TradingView UI)

## Testing / Verification

- Không có test framework tự động cho Pine Script trên TradingView. Verification thực hiện thủ công:
  - Mở chart TradingView, add cả 2 script, so sánh tín hiệu BB/RB trên vài symbol/timeframe khác nhau bằng mắt với logic mô tả ở trên.
  - Dùng Strategy Tester (bản strategy) để xem log các lệnh entry/exit, đối chiếu SL/TP/breakeven/EMA-exit có khớp mô tả không.
  - Không cần đối chiếu số học chính xác với bot Node.js (khác nền tảng, khác cách tính nến real-time vs. closed-bar), chỉ cần logic tương đương về mặt điều kiện.
