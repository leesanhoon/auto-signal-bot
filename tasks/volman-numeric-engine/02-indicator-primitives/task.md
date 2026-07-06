# Task 02: Indicator Primitives

## Bối cảnh
Xem [plan.md](../plan.md) và đặc biệt [context.md §1](../context.md) — tài liệu đã định
nghĩa công thức chính xác cho từng indicator. Task này CHỈ implement đúng các công thức đó
thành pure function, KHÔNG tự sáng tạo thêm công thức khác. Input là `Candle[]` từ
`fetchOhlcHistory` (subtask 01, xem [src/charts/ohlc-provider.ts](../../../src/charts/ohlc-provider.ts)).

## Yêu cầu

Tạo file mới `src/charts/indicators.ts`. Toàn bộ hàm là pure function (không side-effect,
không gọi API/DB), nhận `Candle[]` (đã sắp xếp tăng dần theo `time`) và trả mảng cùng độ dài
(dùng `NaN` hoặc `null` cho các index chưa đủ dữ liệu tính, không throw).

### 1. EMA
```ts
export function calculateEma(candles: Candle[], period: number): (number | null)[]
```
- Công thức EMA chuẩn: `EMA[i] = Close[i] * k + EMA[i-1] * (1-k)`, `k = 2/(period+1)`.
- SMA của `period` nến đầu làm seed cho `EMA[period-1]`; các index trước đó trả `null`.

### 2. ATR
```ts
export function calculateAtr(candles: Candle[], period = 14): (number | null)[]
```
- `TrueRange[i] = Max(High[i]-Low[i], |High[i]-Close[i-1]|, |Low[i]-Close[i-1]|)`
  (với `i=0`, `TrueRange[0] = High[0]-Low[0]`).
- `ATR[i] = EMA(TrueRange, period)[i]` (dùng lại `calculateEma` trên mảng TrueRange, hoặc
  Wilder smoothing — chọn EMA chuẩn cho đơn giản, ghi rõ lựa chọn trong `result.md`).

### 3. Trend Slope Classifier
```ts
export type TrendState = "UPTREND" | "DOWNTREND" | "FLAT";
export function classifyTrend(
  candles: Candle[],
  ema20: (number | null)[],
  atr14: (number | null)[],
  index: number,
): TrendState
```
- Đúng công thức context.md §1.1: `slope = (EMA20[i] - EMA20[i-5]) / ATR14[i]`.
- `slope > 0.15` → `UPTREND` (thêm điều kiện: đa số 10 nến gần nhất có `Close > EMA20`).
- `slope < -0.15` → `DOWNTREND` (đa số `Close < EMA20`).
- Còn lại → `FLAT`.
- Trả `"FLAT"` nếu chưa đủ dữ liệu (index < 5, hoặc EMA20/ATR14 tại các vị trí liên quan là
  `null`).

### 4. Doji Detector
```ts
export function isDoji(candle: Candle, atr: number, zDoji = 0.15): boolean
```
- `|Close-Open| ≤ zDoji * atr` VÀ `|Close-Open| / (High-Low) ≤ 0.25`.
- Nếu `High === Low` (range 0), trả `false` (tránh chia cho 0).

### 5. Compression/Block Detector
```ts
export type CompressionWindow = {
  startIndex: number;
  endIndex: number;
  high: number;
  low: number;
  range: number;
  distanceToEma: number; // |mean(Close) - EMA20[endIndex]| / ATR14[endIndex]
};
export function detectCompression(
  candles: Candle[],
  ema20: (number | null)[],
  atr14: (number | null)[],
  endIndex: number,
  windowSize: number,
  kBlock = 1.2,
): CompressionWindow | null
```
- Cửa sổ `[endIndex - windowSize + 1, endIndex]`.
- `range = Max(High trong cửa sổ) - Min(Low trong cửa sổ)`.
- Trả về object nếu `range ≤ kBlock * ATR14[endIndex]`, ngược lại trả `null`.
- Trả `null` nếu thiếu dữ liệu (EMA20/ATR14 tại `endIndex` là `null`, hoặc cửa sổ vượt quá
  biên mảng).

### 6. False-break Filter
```ts
export function isFalseBreak(
  candles: Candle[],
  breakoutIndex: number,
  levelHigh: number,
  levelLow: number,
  direction: "LONG" | "SHORT",
  lookahead = 2,
): boolean
```
- Theo context.md §1.5: kiểm tra `lookahead` nến sau `breakoutIndex` — nếu có nến đóng cửa
  quay lại trong khoảng `[levelLow, levelHigh]` thì trả `true` (false break).
- Nếu không đủ nến để lookahead (gần cuối mảng), trả `false` (chưa thể kết luận, coi như
  chưa fail).

### Unit test
Viết `tests/charts/indicators.test.ts` (Vitest), với input là fixture `Candle[]` viết tay
(không cần mock API vì đây là pure function):
- `calculateEma`: so khớp với giá trị tính tay trên 1 chuỗi nến đơn giản (ví dụ giá tăng đều
  từng bước 1 đơn vị, kiểm tra công thức EMA đúng theo tay tính).
- `calculateAtr`: test với nến có gap (High/Low nhảy vọt so với Close trước) để đảm bảo dùng
  đúng True Range, không chỉ High-Low.
- `classifyTrend`: fixture rõ ràng cho cả 3 case UPTREND/DOWNTREND/FLAT.
- `isDoji`: test nến thân rất nhỏ → true, nến thân lớn → false, test edge case High===Low.
- `detectCompression`: fixture 5-6 nến dao động hẹp → trả compression window đúng; fixture
  nến dao động rộng → trả `null`.
- `isFalseBreak`: fixture breakout rồi quay đầu trong 2 nến → true; breakout rồi tiếp tục đi
  đúng hướng → false.

## Không cần làm
- Không cần các setup state machine (DD/FB/BB/RB/ARB/IRB/SB) — đó là subtask 03, dùng lại
  các hàm ở đây làm building block.
- Không cần session/volatility filter (context.md §1.6) — để subtask 03 xử lý vì nó cần biết
  giờ hiện tại của candle, không thuộc phạm vi "indicator thuần túy" của task này.
- Không cần tích hợp với OANDA provider thật — dùng fixture tay trong test.

## Kết quả mong đợi
Ghi vào `result.md` trong cùng thư mục:
- Danh sách file đã tạo/sửa.
- Output của `npm run build` và `npm run test -- --run` (phải pass toàn bộ, không phá test
  cũ).
- Nếu có sai khác nào so với công thức trong context.md (ví dụ chọn Wilder smoothing thay vì
  EMA chuẩn cho ATR), nêu rõ lý do để Lead review — không tự ý đổi công thức mà không ghi
  chú.
