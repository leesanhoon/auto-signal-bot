# Context: Bob Volman Setup Playbook (lượng hóa)

Tài liệu này là nguồn tham chiếu domain-knowledge dùng chung cho subtask 02 (indicator
primitives) và 03 (pattern state machines). Mọi ngưỡng số (Z, k, N...) là điểm khởi đầu —
subtask 04 (backtest replay) sẽ tinh chỉnh lại bằng dữ liệu thật.

## 1. Building blocks dùng chung

### 1.1 EMA20 + Trend Slope Classifier
- `EMA20[i]` tính chuẩn trên giá đóng cửa.
- `slope = (EMA20[i] - EMA20[i-5]) / ATR14[i]` (chuẩn hóa theo ATR để so sánh được giữa
  các pair).
- Phân loại:
  - `UPTREND` nếu `slope > 0.15` và giá đóng cửa đa số nến trong 10 nến gần nhất nằm trên
    EMA20.
  - `DOWNTREND` nếu `slope < -0.15` và giá đóng cửa đa số nến nằm dưới EMA20.
  - `FLAT` nếu `|slope| ≤ 0.15` — không giao dịch theo hướng trend, chỉ setup dạng
    range/breakout (RB/ARB/IRB) mới áp dụng.

### 1.2 ATR14
`ATR14[i] = EMA(TrueRange, 14)` — dùng làm mẫu số chuẩn hóa mọi ngưỡng pip-based, tránh
hard-code pips cố định (khác biệt lớn giữa XAU/USD và EUR/USD).

### 1.3 Doji Detector
Nến `i` là Doji nếu:
- `|Close[i] - Open[i]| ≤ Zdoji · ATR14[i]` (khởi điểm `Zdoji = 0.15`)
- `bodyRatio = |Close[i]-Open[i]| / (High[i]-Low[i]) ≤ 0.25` (thân nến chiếm tối đa 25%
  biên độ)

### 1.4 Compression/Block Detector (sliding window)
Trên cửa sổ W nến gần nhất (W = 4..6):
- `range = Max(High[w]) - Min(Low[w])`
- Đánh dấu là **Block** nếu `range ≤ Kblock · ATR14[i]` (khởi điểm `Kblock = 1.2`)
- Vị trí Block so với EMA20: `distanceToEma = |mean(Close[w]) - EMA20[i]| / ATR14[i]` —
  dùng để phân biệt Block nằm sát EMA (phục vụ BB) hay nằm xa EMA giữa 2 vùng breakout
  (phục vụ RB/ARB/IRB).

### 1.5 Rejection/False-break Filter (áp dụng mọi setup)
Một breakout bị coi là **false** nếu nến breakout đóng cửa quay trở lại bên trong
range/block trong vòng ≤ 2 nến sau đó. Khi phát hiện false break → không hủy hoàn toàn tín
hiệu mà chuyển trạng thái sang chờ **SB (Second Break)**.

### 1.6 Session & Volatility Floor
- Chỉ phát tín hiệu trong khung giờ London/NY overlap (khởi điểm 13:00–21:00 UTC), có thể
  cấu hình theo pair.
- Bỏ qua nến có `ATR14 < 0.3 · ATR14_20dayAverage` (thị trường quá "chết", buildup không có
  ý nghĩa) — lọc noise giờ châu Á thấp điểm.
- (Stretch, không bắt buộc ở MVP) blackout N phút quanh lịch tin tức tier-1.

## 2. Bảy setup — Context / Trigger / Entry / Stop / Target / Invalidation

### 2.1 DD — Double Doji Break
- **Context**: `UPTREND` hoặc `DOWNTREND` rõ ràng (theo 1.1).
- **Trigger**:
  1. Giá pullback và `distance(Close, EMA20) ≤ 0.3 · ATR14` (chạm/sát EMA20).
  2. Phát hiện ≥2 Doji liên tiếp (theo 1.3) ngay tại vùng chạm EMA20.
- **Entry**: Buy-stop trên `High` của cụm Doji (uptrend) / Sell-stop dưới `Low` của cụm
  Doji (downtrend), kích hoạt khi nến kế tiếp phá vỡ.
- **Stop**: bên kia cụm Doji ± `0.1 · ATR14` đệm.
- **Target**: TP1 = `1.5R`, TP2 = `2.5R` (R = khoảng cách entry-stop).
- **Invalidation**: nếu nến phá vỡ đóng cửa yếu (bodyRatio < 0.3) → giảm confidence, không
  loại bỏ hoàn toàn.

### 2.2 FB — First Break
- **Context**: Trend mới hình thành — EMA20 vừa chuyển từ `FLAT`/ngược hướng sang
  `UPTREND`/`DOWNTREND` trong ≤ N nến gần nhất (N=10, dùng counter).
- **Trigger**:
  1. Đây là lần đầu tiên giá quay lại chạm/cắt EMA20 kể từ khi trend mới hình thành (dùng
     biến đếm `touchCount`, chỉ nhận `touchCount == 1`).
  2. Signal bar: nến đóng cửa thuận theo trend chính ngay sau lần chạm đó (`bodyRatio ≥ 0.5`
     theo đúng hướng trend).
- **Entry**: phá vỡ `High`/`Low` của signal bar.
- **Stop**: bên kia signal bar ± đệm ATR nhỏ.
- **Target**: TP1 `1.5R`, TP2 theo swing high/low gần nhất ngược trend trước đó.
- **Invalidation**: nếu `touchCount > 1` trước khi entry trigger → không còn là FB, chuyển
  sang theo dõi setup khác (loại khỏi state machine FB).

### 2.3 BB — Block Break
- **Context**: `UPTREND`/`DOWNTREND` với EMA20 đang dốc rõ (`|slope| > 0.2`, chặt hơn DD).
- **Trigger**: Block (theo 1.4) hình thành sát EMA20 (`distanceToEma ≤ 0.25 · ATR14`).
- **Entry**: `Close` vượt biên trên/dưới Block theo đúng hướng trend.
- **Stop**: biên đối diện của Block.
- **Target**: TP1 `1.5R`, TP2 `2.5R`.
- **Invalidation**: false-break filter (1.5) áp dụng — nếu breakout thất bại, chuyển state
  sang chờ SB tại chính Block đó.

### 2.4 RB — Range Break
- **Context**: không cần trend rõ — range đi ngang độc lập.
- **Trigger**: Block/range (1.4) với `range` lớn hơn BB (không giới hạn sát EMA), tồn tại
  ≥ 6 nến, EMA20 bắt đầu chuyển từ `FLAT` sang có `slope` cùng hướng breakout ngay khi giá
  thoát range.
- **Entry**: `Close` vượt biên range.
- **Stop**: biên đối diện range.
- **Target**: TP1 = độ rộng range đo từ điểm breakout (đo lường theo range height, chuẩn
  Volman: TP1 ≈ range height, TP2 ≈ 1.5× range height).
- **Invalidation**: false-break → chuyển ARB hoặc SB tùy số lần test biên trước đó.

### 2.5 ARB — Advanced Range Break
- **Context**: Range lớn (giống RB) nhưng đã có **≥2 lần test biên thất bại** (false break
  đếm bằng counter `edgeTestCount`) trước khi breakout thật.
- **Trigger**: `edgeTestCount ≥ 2` và breakout hiện tại không bị false-break filter (1.5)
  loại — tức là breakout lần này "trụ" được.
- **Entry/Stop/Target**: giống RB nhưng confidence cộng thêm theo số lần test biên (nhiều
  lần test = breakout đáng tin hơn).
- **Invalidation**: nếu breakout lần thứ 3 vẫn fail → hạ confidence toàn bộ range, đánh dấu
  range là "hết hiệu lực", không tiếp tục theo dõi.

### 2.6 IRB — Inside Range Break
- **Context**: Đã xác định 1 range lớn (RangeOuter, theo 1.4 với W lớn hơn, ví dụ W=10-15).
- **Trigger**: Bên trong RangeOuter, phát hiện 1 range nhỏ hơn (RangeInner, W=4-6) nằm sát
  biên của RangeOuter. Breakout của RangeInner đồng thời làm giá vượt luôn biên
  RangeOuter (`Close` vượt cả 2 biên trong cùng 1 nến hoặc 2 nến liên tiếp).
- **Entry**: tại điểm breakout RangeInner (entry sớm hơn RB thường vì RangeInner nhỏ hơn).
- **Stop**: biên đối diện RangeInner.
- **Target**: TP1 = range height của RangeOuter (mục tiêu lớn hơn vì phá luôn range lớn).
- **Invalidation**: nếu breakout RangeInner không kéo phá RangeOuter trong ≤2 nến → không
  phải IRB, hạ về RB thường (theo dõi RangeInner độc lập).

### 2.7 SB — Second Break (false-break reversal)
- **Context**: Xảy ra sau bất kỳ setup nào ở trên khi breakout lần 1 bị false-break filter
  (1.5) đánh dấu fail.
- **Trigger**: Sau false-break, giá quay lại buildup (Block mới, theo 1.4) trong phạm vi
  range/block cũ, rồi breakout lần 2 theo **hướng ngược lại** với lần breakout thất bại đầu
  tiên.
- **Entry**: phá vỡ biên buildup lần 2, theo hướng ngược false-break ban đầu.
- **Stop**: bên kia buildup lần 2.
- **Target**: TP1 `1.5R`, TP2 theo swing gần nhất cùng hướng.
- **Invalidation**: nếu breakout lần 2 cũng false → không tiếp tục dò SB lần 3 (dừng theo
  dõi setup này, tránh overtrade một range đã "hỏng").

## 3. Confidence scoring chung (thay thế % AI tự đoán)

`confidence = clamp(base + Σ bonus - Σ penalty, 0, 100)`, gợi ý:
- `base = 50`
- `+15` nếu trend rõ (`|slope| > 0.3`)
- `+10` nếu volume tại nến breakout > trung bình 10 nến gần nhất (đặc biệt quan trọng cho
  BB/RB/FB — cần OHLC có volume thật, xem quyết định dùng OANDA ở phần data provider)
- `+10` mỗi lần `edgeTestCount` tăng thêm (tối đa +20, áp dụng ARB)
- `-15` nếu bodyRatio nến breakout < 0.3 (breakout yếu)
- `-10` nếu ngoài session London/NY overlap
- `-20` nếu ATR14 hiện tại < 0.3 × ATR14 trung bình 20 ngày (thị trường quá im ắng)

## 4. Ghi chú triển khai
- Mọi field `reasons`/`risks`/`summary` trong `TradeSetup` (xem
  [chart-types.ts](../../src/charts/chart-types.ts)) sẽ được sinh từ `ruleTrace` — danh sách
  các điều kiện đã pass/fail theo đúng thứ tự state machine, KHÔNG do AI viết tự do.
- Volume thật (mục 3) là lý do bổ sung khẳng định chọn **OANDA v20** làm data provider
  chính (đã quyết ở bước trước) — Yahoo Finance không có volume forex đáng tin cậy.
