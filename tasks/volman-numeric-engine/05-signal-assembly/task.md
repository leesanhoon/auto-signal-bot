# Task 05: Signal Assembly (thay thế AI hoàn toàn)

## Bối cảnh
Đây là bước ghép `DetectedSignal` (subtask 03) thành đúng `TradeSetup`/`PairSummary` mà
downstream đang dùng ([positions-repository.ts](../../../src/charts/positions-repository.ts),
[position-engine.ts](../../../src/charts/position-engine.ts),
[telegram.ts](../../../src/shared/telegram.ts)) — KHÔNG được đổi field nào trong
`TradeSetup`/`PairSummary` mà downstream đang đọc, chỉ được **thêm** field mới. Đọc
[chart-types.ts](../../../src/charts/chart-types.ts) và
[telegram.ts:263-301](../../../src/shared/telegram.ts) trước khi code để biết chính xác
field nào bắt buộc phải có giá trị hợp lệ (không rỗng).

## Yêu cầu

### 1. Mở rộng type
Trong `src/charts/chart-types.ts`, thêm field mới vào `TradeSetup` (không xóa/đổi field cũ):
```ts
export type TradeSetup = {
  // ...giữ nguyên toàn bộ field hiện có...
  ruleTrace?: string[];
  detectionSource?: "deterministic" | "ai";
};
```
Tương tự thêm `ruleTrace?: string[]` và `detectionSource?: "deterministic" | "ai"` vào
`PairSummary`.

### 2. Template sinh text tiếng Việt
Tạo file mới `src/charts/signal-assembly.ts`:
```ts
export function buildTradeSetupFromSignal(
  signal: DetectedSignal,
  ohlcContext: { lastPrice: number | null },
): TradeSetup
```
- `pair`, `direction`, `primaryTimeframe` lấy trực tiếp từ `signal`.
- `setup`: map `SetupKind` → tên hiển thị đúng như prompt AI cũ đang dùng, để tương thích
  ngược với `getPatternInfo` trong `telegram.ts` (đọc hàm này trước — nó match theo string
  `setup.setup`, phải trả đúng format nó đang parse, ví dụ `"DD"`, `"FB"`, `"BB"` v.v., không
  đổi tên).
- `entry`/`stopLoss`/`takeProfit1`/`takeProfit2`: format số về string bằng cùng logic
  `formatPrice` đã có trong `analyzer.ts` (tái sử dụng hoặc export hàm đó ra dùng chung, không
  copy-paste lại logic).
- `riskReward`: tính từ entry/stop/tp1 theo cùng công thức `calculateRiskRewardPlan` trong
  `position-engine.ts` (tái sử dụng, không tự viết công thức mới).
- `orderType`: `"MARKET_NOW"` nếu `signal.triggerIndex` là nến cuối cùng (tín hiệu vừa kích
  hoạt ngay); các trường hợp khác dùng `BUY_STOP`/`SELL_STOP` theo `direction`.
- `entryCondition`: câu tiếng Việt ngắn mô tả điều kiện vào lệnh, sinh từ dòng cuối
  `ruleTrace` (dòng ghi nhận breakout).
- `reasons`: map toàn bộ `ruleTrace` thành câu tiếng Việt tự nhiên hơn (không cần dịch từng
  ký tự — viết hàm dịch các pattern cố định, ví dụ `"EMA20 slope=X -> UPTREND"` →
  `"EMA20 đang dốc lên rõ ràng"`). Liệt kê rõ bảng mapping bạn dùng trong `result.md`.
- `risks`: nếu `confidence < 70`, thêm câu cảnh báo tương ứng lý do trừ điểm (đọc lại phần
  penalty trong context.md §3 để biết lý do gì gây giảm confidence, map ngược lại thành risk
  text).
- `summary`: 1 câu tổng hợp ngắn (pair, hướng, setup, confidence).
- `confidence`: lấy trực tiếp từ `signal.confidence`.
- `ruleTrace`: giữ nguyên mảng gốc (dùng cho debug/audit, không hiển thị lên Telegram).
- `detectionSource`: luôn `"deterministic"`.
- `lastPrice`: từ `ohlcContext.lastPrice`.
- Áp dụng lại `applyPriceSanityChecks` từ `analyzer.ts` (export hàm đó ra dùng chung, không
  copy logic) để đảm bảo tính nhất quán về sanity-check giá thật so với entry/stop.

### 3. PairSummary
```ts
export function buildPairSummaryFromContext(
  pair: string,
  trend: TrendState,
  emaDistanceAtr: number,
  hasActiveSignal: boolean,
): PairSummary
```
- `trend`: map `TrendState` → chuỗi tiếng Việt (`"UPTREND"` → `"Tăng"`,
  `"DOWNTREND"` → `"Giảm"`, `"FLAT"` → `"Đi ngang"`).
- `emaProximity`: `"tại"` nếu `emaDistanceAtr ≤ 0.3`, `"gần"` nếu `≤ 1`, ngược lại `"xa"`.
- `status`/`confidence`: câu tiếng Việt ngắn tùy `hasActiveSignal`.

### Unit test
Viết `tests/charts/signal-assembly.test.ts`:
- Fixture `DetectedSignal` mẫu cho ít nhất 2 setup khác nhau (ví dụ DD và RB), kiểm tra
  `buildTradeSetupFromSignal` trả đủ field bắt buộc mà `telegram.ts` cần (không rỗng/undefined
  ở field bắt buộc).
- Test `orderType` đúng logic MARKET_NOW vs STOP.
- Test `buildPairSummaryFromContext` map đúng `emaProximity` theo các mốc ATR khác nhau.
- Test `applyPriceSanityChecks` (tái sử dụng) vẫn hoạt động đúng khi gọi qua
  `buildTradeSetupFromSignal` (ví dụ giá thật đã vượt qua stop loss → setup bị loại, hàm trả
  giá trị phản ánh đúng, không giả lập gọi AI).

## Không cần làm
- Không cần sửa `telegram.ts`/`positions-repository.ts` — chúng đã tương thích sẵn vì chỉ đọc
  field cũ, field mới (`ruleTrace`, `detectionSource`) là optional.
- Không cần nối với `index.ts` — đó là subtask 06.
- Không cần xóa `analyzer.ts` — chỉ export thêm các hàm cần tái sử dụng
  (`formatPrice`, `applyPriceSanityChecks`) nếu chúng chưa được export.

## Kết quả mong đợi
Ghi vào `result.md`:
- Danh sách file đã tạo/sửa.
- Output `npm run build` và `npm run test -- --run` (pass toàn bộ).
- Bảng mapping `ruleTrace` → câu tiếng Việt bạn đã dùng trong `reasons`.
- Xác nhận đã kiểm tra `getPatternInfo` trong `telegram.ts` và tên `setup.setup` sinh ra khớp
  đúng format nó parse (dán đoạn code liên quan nếu cần Lead xác minh nhanh).
