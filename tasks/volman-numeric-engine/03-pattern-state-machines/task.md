# Task 03: Pattern State Machines (7 setup Volman)

## Bối cảnh
Đây là phần lõi của toàn bộ dự án. Đọc kỹ [context.md §2](../context.md) (định nghĩa chính
xác 7 setup: DD, FB, BB, RB, ARB, IRB, SB) và [context.md §3](../context.md) (công thức
confidence). Dùng các hàm từ subtask 02
([src/charts/indicators.ts](../../../src/charts/indicators.ts)): `calculateEma`,
`calculateAtr`, `classifyTrend`, `isDoji`, `detectCompression`, `isFalseBreak`.
KHÔNG tự sáng tạo thêm rule ngoài những gì context.md đã mô tả — nếu thấy rule nào mơ hồ/thiếu
thông tin để code, ghi vào `result.md` phần "giả định" thay vì tự đoán.

## Yêu cầu

### 1. Types chung
Tạo file mới `src/charts/setup-types.ts`:
```ts
export type SetupKind = "DD" | "FB" | "BB" | "RB" | "ARB" | "IRB" | "SB";

export type DetectedSignal = {
  setup: SetupKind;
  pair: string;
  timeframe: ChartTimeframe;
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  confidence: number; // 0-100, theo công thức context.md §3
  triggerIndex: number; // index trong mảng candles nơi tín hiệu kích hoạt
  ruleTrace: string[]; // danh sách điều kiện đã pass, theo đúng thứ tự state machine
};
```

### 2. Mỗi setup là 1 file riêng trong `src/charts/setups/`
Tạo thư mục `src/charts/setups/` với 7 file: `dd.ts`, `fb.ts`, `bb.ts`, `rb.ts`, `arb.ts`,
`irb.ts`, `sb.ts`. Mỗi file export 1 hàm cùng chữ ký:
```ts
export function detect<Ten>(
  candles: Candle[],
  index: number, // vị trí nến hiện tại đang xét (nến cuối = kích hoạt)
  context: { ema20: (number|null)[]; atr14: (number|null)[]; pair: string; timeframe: ChartTimeframe },
): DetectedSignal | null
```
Implement đúng logic Context/Trigger/Entry/Stop/Target/Invalidation mô tả trong
context.md §2.1 đến §2.7 cho từng setup tương ứng. Một số lưu ý quan trọng:

- **DD/FB/BB** cần `classifyTrend` trả `UPTREND`/`DOWNTREND` (không áp dụng khi `FLAT`).
- **RB/ARB/IRB** không yêu cầu trend rõ, dùng `detectCompression` trực tiếp.
- **FB** cần một counter `touchCount` — vì đây là pure function không giữ state giữa các lần
  gọi, hãy tính `touchCount` bằng cách quét ngược từ điểm EMA20 bắt đầu đổi hướng đến
  `index` hiện tại, đếm số lần giá cắt qua EMA20 (không lưu state ngoài, tính lại mỗi lần).
- **ARB** cần `edgeTestCount` — tương tự, quét trong cửa sổ range để đếm số lần giá chạm biên
  rồi bật ngược lại trước khi breakout thật.
- **IRB** cần detect 2 compression window lồng nhau (`detectCompression` với 2 `windowSize`
  khác nhau, kiểm tra RangeInner nằm trong RangeOuter về mặt vị trí index và biên giá).
- **SB** nhận input là 1 `DetectedSignal` khác đã bị đánh dấu false-break (qua
  `isFalseBreak`) — hàm `detectSb` nhận thêm tham số `failedSignal: DetectedSignal` thay vì
  tự dò từ đầu.
- Mọi bước pass/fail phải append 1 dòng string vào `ruleTrace`, ví dụ:
  `"EMA20 slope=0.32 -> UPTREND"`, `"2 doji lien tiep tai index 45-46, sat EMA20 (distance=0.18 ATR)"`,
  `"Nen 47 pha vo High cum doji (1.10234) -> entry LONG"`.
- `confidence` tính đúng công thức context.md §3 (base 50 + bonus/penalty). Volume bonus cần
  `candle.volume` — nếu `Candle` không có volume (fixture test không set), coi
  `volume = 0` và bỏ qua bonus đó (không lỗi).

### 3. Conflict resolution
Tạo hàm trong `src/charts/setup-types.ts` hoặc file mới `src/charts/setup-resolver.ts`:
```ts
export function resolveSetupConflicts(signals: DetectedSignal[]): DetectedSignal[]
```
- Nhóm theo `pair` (không theo timeframe — 1 pair chỉ nên có tối đa 1 tín hiệu active tại 1
  thời điểm để tránh gửi trùng).
- Trong mỗi nhóm, nếu có nhiều signal, giữ lại signal có `confidence` cao nhất; nếu bằng
  nhau, ưu tiên theo thứ tự: `ARB > IRB > RB > BB > FB > DD > SB` (điều kiện chặt hơn/đã qua
  nhiều lần xác nhận hơn thắng).

### 4. Session/Volatility filter (cross-cutting)
Tạo hàm `isTradableWindow(candleTime: number, atr14Now: number, atr14Avg20d: number): boolean`
trong `src/charts/indicators.ts` (bổ sung vào subtask 02's file, không tạo file mới) theo
context.md §1.6: giờ UTC nằm trong `[13,21)` VÀ `atr14Now >= 0.3 * atr14Avg20d`. Gọi hàm này
ở đầu mỗi detector — nếu `false`, trả `null` ngay (không tính toán tiếp).

### Unit test
Viết `tests/charts/setups/*.test.ts` (1 file/setup, mirror `src/charts/setups/`):
- Mỗi setup: 1 fixture "trigger đúng" (phải trả `DetectedSignal` không null, kiểm tra
  `direction`/`entry`/`stopLoss` đúng), 1 fixture "không đủ điều kiện" (phải trả `null`), 1
  fixture "false-break" nếu áp dụng (kiểm tra `ruleTrace` có ghi nhận false break).
- Test `resolveSetupConflicts` với input nhiều signal cùng pair, khác confidence.
- Test `isTradableWindow` với giờ trong/ngoài khung, ATR thấp/bình thường.

## Không cần làm
- Không cần gọi `fetchOhlcHistory` thật — dùng fixture `Candle[]` viết tay trong test.
- Không cần tích hợp vào `index.ts` — đó là subtask 06.
- Không cần sinh `TradeSetup`/`PairSummary` (field tiếng Việt cho Telegram) — đó là subtask 05,
  chỉ cần trả `DetectedSignal` với `ruleTrace` dạng string ngắn gọn (không cần văn phong đẹp).

## Kết quả mong đợi
Ghi vào `result.md`:
- Danh sách file đã tạo/sửa.
- Output `npm run build` và `npm run test -- --run` (pass toàn bộ).
- Với mỗi setup, liệt kê ngắn gọn: đã implement đúng theo context.md hay có điểm nào phải tự
  quyết định (ghi rõ để Lead review) — đặc biệt lưu ý FB's touchCount, ARB's edgeTestCount,
  IRB's nested window logic vì đây là phần dễ hiểu sai nhất.
