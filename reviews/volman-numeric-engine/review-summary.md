# Review Summary: Volman Numeric Detection Engine

Kết quả code review (8 finding đã verify) trên toàn bộ diff hiện tại (`git diff HEAD` +
untracked files trong `src/charts/`, `tests/charts/`). Xếp theo mức độ nghiêm trọng, correctness
trước, cleanup/hiệu năng sau. Đánh dấu `[ ]` khi chưa fix, `[x]` khi đã fix.

---

# Round 1 (đã fix toàn bộ)

---

## 1. [x] Price-sanity reject bị âm thầm bỏ qua — nghiêm trọng nhất
**File**: `src/charts/signal-assembly.ts:150`
**Verdict**: CONFIRMED

```ts
const checked = applyPriceSanityChecks(tradeSetup, ohlcContext.lastPrice);
return checked.setup ?? tradeSetup; // BUG: fallback về setup CHƯA validate khi bị reject
```

`applyPriceSanityChecks` (trong `analyzer.ts`) trả `{ setup: null, note }` khi cố ý muốn loại bỏ
setup (giá đã vượt qua stop-loss, hoặc MARKET_NOW lệch quá xa giá thật). Nhưng
`checked.setup ?? tradeSetup` dùng `??` nên khi `checked.setup === null`, nó fallback về
`tradeSetup` gốc — nghĩa là setup đã bị đánh dấu invalid vẫn được trả về và đẩy tiếp vào
`setups[]` trong `deterministic-pipeline.ts`.

**Cách fix đúng** (theo đúng pattern đã có trong `analyzer.ts:372-377`):
- Đổi chữ ký `buildTradeSetupFromSignal` để có thể trả `null`, hoặc
- Ở `deterministic-pipeline.ts`, sau khi gọi `buildTradeSetupFromSignal`, filter bỏ những setup
  có dấu hiệu đã bị reject (ví dụ hàm trả kèm `rejected: boolean`/`rejectionNote`), tương tự cách
  `parseAnalysisResponse` dùng `.filter(Boolean)`.

**Failure scenario**: 1 tín hiệu LONG có `lastPrice` đã tụt xuống dưới `stopLoss` vẫn được gửi
Telegram / auto-track làm lệnh mở, dù bản thân hệ thống đã biết nó invalid.

---

## 2. [x] Bộ lọc session/volatility bị import nhưng không bao giờ gọi
**File**: `src/charts/deterministic-pipeline.ts:4` (import), định nghĩa tại `src/charts/indicators.ts`
**Verdict**: CONFIRMED

`isTradableWindow` và `averageAtr` được import vào `deterministic-pipeline.ts` nhưng grep toàn bộ
`src/` không có lệnh gọi nào tới 2 hàm này (không trong pipeline, không trong `setups/*.ts`,
không trong `setup-backtest.ts`). Đây là filter session London/NY + ATR floor mà
[context.md §1.6](../../tasks/volman-numeric-engine/context.md) yêu cầu áp dụng ở đầu mỗi detector.

**Cách fix**: Gọi `isTradableWindow(candleTime, atr14Now, atr14Avg20d)` ở đầu mỗi hàm `detect*`
trong `src/charts/setups/*.ts` (hoặc 1 lần trong vòng lặp chính của `deterministic-pipeline.ts`
trước khi chạy 6 detector), trả `null`/skip ngay nếu `false` — đúng như task 03 đã yêu cầu.

**Failure scenario**: Tín hiệu vẫn có thể bắn ra ngoài giờ London/NY overlap hoặc khi ATR quá
thấp (thị trường "chết"), điều mà thiết kế ban đầu chủ đích muốn chặn.

---

## 3. [x] Cache không phân biệt engine mode — đổi mode giữa chừng bị trả nhầm kết quả cũ
**File**: `src/charts/index.ts:48`
**Verdict**: CONFIRMED

```ts
const cached = await loadChartAnalysisCache(candleKey);
if (cached) { result = cached as any; }          // <- check trước khi biết engineMode
else if (isWithinCandleCloseWindow(...)) { ... }  // <- rẽ nhánh theo mode ở đây
```

Cache được lưu bởi cả 3 mode (`ai`/`deterministic`/`shadow`) dưới cùng `candleKey`, và payload
không có field nào đánh dấu nó được sinh ra bởi mode nào (`chart-cache-repository.ts` chỉ
serialize `summaries/setups/noSetupReason/screenshots`).

**Cách fix**: Thêm field `engineMode`/`detectionSource` vào payload lưu cache, và khi đọc cache
so sánh với `getConfiguredChartEngineMode()` hiện tại — nếu khác, coi như cache miss (fetch lại).

**Failure scenario**: Chạy `CHART_ENGINE_MODE=deterministic` 1 lần trong 1 candle H4, rồi đổi về
`ai`/`shadow` trước khi candle đó đóng lại — lần chạy sau vẫn trả kết quả deterministic cũ
(`screenshots: []`), không hề gọi lại AI như người vận hành mong đợi.

---

## 4. [x] Lỗi ở shadow-mode chỉ log warn, không cảnh báo qua Telegram
**File**: `src/charts/index.ts:127`
**Verdict**: CONFIRMED

```ts
try {
  // gọi analyzeAllChartsDeterministic trong shadow mode
} catch (detErr) {
  logger.warn("SHADOW: Deterministic engine comparison failed", { error: detErr });
  // KHÔNG gọi notifyError, KHÔNG re-throw
}
```

Mọi lỗi khác trong file này (nhánh `ai`, nhánh `deterministic`) đều propagate lên
`main().catch()` ở cuối file, nơi gọi `notifyError(...)` (cảnh báo Telegram) trước khi
`process.exit(1)`. Riêng nhánh shadow bị catch cục bộ và chỉ log — nếu OANDA token hết hạn
hoặc API đổi schema, deterministic engine có thể fail âm thầm vô thời hạn mà không ai biết.

**Cách fix**: Sau khi log warn, vẫn gọi `notifyError` (không cần `process.exit`, vì đây chỉ là
nhánh so sánh phụ) — hoặc dùng 1 kênh cảnh báo riêng (ví dụ đếm số lần fail liên tiếp, cảnh báo
sau N lần) để tránh spam Telegram nhưng vẫn đảm bảo có tín hiệu.

---

## 5. [x] `detectSb` (setup thứ 7 — Second Break) không được đưa vào detector list
**File**: `src/charts/deterministic-pipeline.ts:70` và `src/charts/setup-backtest.ts:58`
**Verdict**: CONFIRMED (có lý do kỹ thuật rõ ràng, không phải copy-paste sót)

```ts
const detectors = [detectDd, detectFb, detectBb, detectRb, detectArb, detectIrb]; // thiếu detectSb
```

`detectSb` có chữ ký khác 6 hàm còn lại — nó cần thêm tham số `failedSignal: DetectedSignal`
(tín hiệu đã bị false-break trước đó), không khớp với vòng lặp per-index dùng chung chữ ký
`(candles, index, ctx)`. Đây là lý do nó chưa được "cắm" vào, nhưng hiện tại toàn bộ file
`setups/sb.ts` là dead code — setup SB không bao giờ được sinh ra dù `setup-resolver.ts` (priority
list) và `telegram.ts` (`getPatternInfo`) vẫn coi nó là 1 trong 7 setup hợp lệ.

**Cách fix**: Thêm 1 bước riêng sau vòng lặp chính: với mỗi `DetectedSignal` bị đánh dấu
false-break (qua `isFalseBreak`), gọi `detectSb(candles, index, ctx, failedSignal)` để dò tín
hiệu đảo chiều — đúng như thiết kế ban đầu trong [context.md §2.7](../../tasks/volman-numeric-engine/context.md).

---

## 6. [x] Fetch OHLC tuần tự — có thể chậm ~5-10s mỗi lần chạy
**File**: `src/charts/deterministic-pipeline.ts:40`
**Verdict**: CONFIRMED

```ts
for (const { pair, symbol } of pairs) {
  const h4Candles = await fetchOhlcHistory(symbol, "H4", 200);
  ...
  const d1Candles = await fetchOhlcHistory(symbol, "D1", 200);
  const m15Candles = await fetchOhlcHistory(symbol, "M15", 200);
}
```

9 pairs × 3 timeframe = 27 lệnh `await` tuần tự tới OANDA, trong khi `analyzer.ts` (code cũ)
đã dùng `Promise.all(groups.map(...))` cho đúng loại công việc độc lập này.

**Cách fix**: Bọc vòng lặp ngoài bằng `Promise.all(pairs.map(async ({pair, symbol}) => {...}))`,
và bên trong mỗi pair dùng `Promise.all([fetchOhlcHistory(H4), fetchOhlcHistory(D1), fetchOhlcHistory(M15)])`.

**Failure scenario**: Ở mode `shadow`, thời gian chạy cộng dồn thêm cả AI path lẫn 27 lệnh gọi
tuần tự này — có thể cộng thêm 5-10 giây mỗi lần chạy định kỳ.

---

## 7. [x] Logic slope/bodyRatio/confidence lặp lại y hệt ở cả 7 file setup
**File**: `src/charts/setups/shared.ts` (chỉ export `baseConfidence = 50`, nên bổ sung vào đây)
**Verdict**: CONFIRMED

Biểu thức tính slope và bodyRatio, cùng pattern `+15`/`-15` confidence với ngưỡng `0.3` hardcode,
lặp lại gần như y hệt trong `dd.ts`, `bb.ts`, `fb.ts`, `arb.ts`, `rb.ts`, `irb.ts` (45 match khi
grep toàn bộ `setups/*.ts`).

**Cách fix**: Thêm vào `shared.ts`:
```ts
export function computeSlope(ctx, index, atr): number { ... }
export function computeBodyRatio(candle): number { ... }
export function applyStandardConfidenceAdjustments(confidence, slope, bodyRatio, trace): number { ... }
```
rồi thay logic inline trong 7 file bằng lệnh gọi hàm chung.

**Failure scenario**: Giai đoạn backtest tinh chỉnh ngưỡng (subtask 04) sẽ cần đổi số `0.3`/`15`
— nếu chỉ sửa 1-2 file mà quên các file còn lại, các setup sẽ lặng lẽ lệch nhau về cách chấm
điểm confidence mà không có test nào bắt được.

---

## 8. [x] `fetchOhlcHistory` không dùng retry/backoff có sẵn
**File**: `src/charts/ohlc-provider.ts:883`
**Verdict**: PLAUSIBLE

Gọi `fetch()` 1 lần duy nhất, không có retry — trong khi `src/shared/retry.ts` đã có sẵn
`withRetry`/`isRetryableError` (xử lý 429/5xx/network error) mà `analyzer.ts` đang dùng cho
OpenRouter.

**Cách fix**: Bọc lệnh `fetch` trong `fetchOhlcHistory` bằng `withRetry(...)` giống cách
`analyzer.ts` dùng cho OpenRouter, thay vì trả `Error` ngay sau 1 lần fail.

**Failure scenario**: OANDA rate-limit thoáng qua (429) hoặc lỗi mạng tạm thời khiến cả pair đó
bị skip hoàn toàn cho lần chạy đó, dù chỉ cần retry là qua.

---

## Ghi chú (Round 1)
- Finding #5 (`detectSb`) nên fix cùng lúc với việc hoàn thiện luồng false-break → SB, vì đây là
  thay đổi kiến trúc nhỏ (cần truyền thêm `failedSignal`), không chỉ là thêm 1 dòng vào mảng.
- Nên fix theo đúng thứ tự trên: #1-#4 là correctness/an toàn vận hành, bắt buộc fix trước khi
  cân nhắc bật `CHART_ENGINE_MODE=deterministic` thật; #5-#8 có thể làm sau.

---

# Round 2 (re-review sau khi fix Round 1 — phát hiện thêm)

Sau khi verify code thật sự đã sửa (không chỉ tick checkbox), chạy lại review đầy đủ. 4/8
finding Round 1 fix sạch, không phát sinh vấn đề mới (#1 price-sanity, #3 cache key, #4 shadow
notifyError wiring, #6 parallel fetch). Nhưng 3 finding khác **fix chưa trọn vẹn** hoặc **bản
thân fix có bug mới** — xem chi tiết dưới đây.

---

## 9. [ ] Filter session/volatility tự vô hiệu hóa khi thiếu dữ liệu ATR — fail-open thay vì fail-safe
**File**: `src/charts/deterministic-pipeline.ts:59`
**Verdict**: CONFIRMED

```ts
if (atrLast !== null && atrAvg20d !== null) {
  if (!isTradableWindow(lastCandle.time, atrLast, atrAvg20d)) { /* skip */ }
}
// Khi atrLast/atrAvg20d là null -> filter bị bỏ qua HOÀN TOÀN, không skip pair
```

Đây là fix một phần của finding Round 1 #2 (đã gọi `isTradableWindow` đúng chỗ), nhưng cách
guard bằng `if (atrLast !== null && atrAvg20d !== null)` khiến pair thiếu lịch sử (mới thêm,
gap dữ liệu, ATR chưa đủ 20 nến) **bỏ qua toàn bộ filter** thay vì bị coi là "chưa đủ điều kiện
giao dịch". Đây chính xác là nhóm pair dễ sinh tín hiệu nhiễu nhất — lại là nhóm được miễn kiểm
tra.

**Cách fix**: Đảo logic — khi `atrLast === null || atrAvg20d === null`, coi pair đó là
**không tradable** (skip), không phải "bỏ qua kiểm tra":
```ts
if (atrLast === null || atrAvg20d === null || !isTradableWindow(lastCandle.time, atrLast, atrAvg20d)) {
  // skip pair
}
```

**Failure scenario**: Pair mới/thiếu dữ liệu sinh tín hiệu ngoài giờ London/NY hoặc lúc thị
trường "chết" — đúng điều kiện mà filter được thêm vào để chặn.

---

## 10. [ ] Backtest engine vẫn thiếu `detectSb` — không phản ánh đúng production
**File**: `src/charts/setup-backtest.ts:58`
**Verdict**: CONFIRMED

```ts
const detectors = [detectDd, detectFb, detectBb, detectRb, detectArb, detectIrb]; // vẫn thiếu detectSb
```

Round 1 #5 đã cắm `detectSb` vào `deterministic-pipeline.ts` (production), nhưng
`setup-backtest.ts` (dùng bởi `npm run backtest:setups`) chưa được cập nhật theo — 2 nơi chạy
2 bộ rule khác nhau. Điều này phá vỡ mục đích chính của backtest: **gate bắt buộc** trước khi
bật `CHART_ENGINE_MODE=deterministic` (xem [plan.md](../../tasks/volman-numeric-engine/plan.md)).
Nếu SB có win rate âm trong thực tế, backtest sẽ không bao giờ phát hiện ra vì nó không hề chạy
SB.

**Cách fix**: Wiring `detectSb` vào `setup-backtest.ts` theo đúng cách production đang làm — sau
vòng lặp 6 detector chính, với mỗi tín hiệu bị đánh dấu false-break (`isFalseBreak`), gọi thêm
`detectSb(candles, index, ctx, failedSignal)`. Cũng cần thêm `"SB"` vào danh sách setup được
tổng hợp trong báo cáo (`bySetup`).

**Failure scenario**: Bật `CHART_ENGINE_MODE=deterministic` dựa trên báo cáo backtest "sạch",
nhưng SB (chưa từng được backtest) hoạt động tệ trong thực tế — gate bị vô hiệu hóa mà không ai
biết.

---

## 11. [ ] Fix retry cho OANDA không thực sự retry lỗi HTTP status (429/5xx)
**File**: `src/charts/ohlc-provider.ts:151`
**Verdict**: CONFIRMED

```ts
throw new Error(`OANDA API trả về ${res.status} cho ${instrument} ${granularity}`);
```

Round 1 #8 đã bọc `fetch()` bằng `withRetry(...)`, nhưng `isRetryableError` trong
`src/shared/retry.ts` chỉ nhận diện lỗi retryable qua: (a) regex khớp message dạng
`"code":429` hoặc `OpenRouter request failed (...)`, hoặc (b) field `.status`/`.code` trên chính
error object. Message `"OANDA API trả về 429 cho ..."` không khớp regex nào, và
`new Error(...)` thường không có field `.status`. Kết quả: `isRetryableError` trả `false`,
`withRetry` throw ngay ở lần thử đầu tiên — **retry không bao giờ thực sự xảy ra** cho đúng loại
lỗi (429/5xx) mà fix này nhắm tới.

**Cách fix**: Gắn `status` vào error object trước khi throw, ví dụ:
```ts
const err = new Error(`OANDA API trả về ${res.status} cho ${instrument} ${granularity}`);
(err as any).status = res.status;
throw err;
```
để `getStatusCode(error)` trong `retry.ts` nhận diện được, hoặc truyền custom
`isRetryable` predicate vào `withRetry(...)` khi gọi từ `ohlc-provider.ts`.

**Failure scenario**: OANDA rate-limit (429) hoặc lỗi 5xx thoáng qua vẫn khiến cả pair bị skip
ngay từ lần thử đầu — y hệt hành vi trước khi "fix", chỉ khác là giờ trông như đã có retry.

---

## 12. [ ] Refactor dedup slope/bodyRatio/confidence mới áp dụng cho 2/7 file
**File**: `src/charts/setups/fb.ts:165` (đại diện; tương tự ở `bb.ts`, `rb.ts`, `arb.ts`, `irb.ts`)
**Verdict**: CONFIRMED

Round 1 #7 đã thêm `computeSlope`/`computeBodyRatio`/`applyStandardConfidenceAdjustments` vào
`shared.ts`, nhưng chỉ `dd.ts` và `sb.ts` (file mới) thực sự gọi các hàm này. 5 file còn lại
(`fb.ts`, `bb.ts`, `rb.ts`, `arb.ts`, `irb.ts`) vẫn giữ nguyên logic inline y hệt trước — finding
gốc chưa được fix trọn vẹn. Ngoài ra `fb.ts` hiện **thiếu luôn** phần penalty bodyRatio (chỉ có
phần bonus slope), một lệch pha hành vi mới phát sinh từ việc refactor nửa vời.

**Cách fix**: Thay logic inline trong 5 file còn lại bằng lệnh gọi `computeSlope`/
`computeBodyRatio`/`applyStandardConfidenceAdjustments` từ `shared.ts`, giống cách `dd.ts` đã
làm. Bổ sung luôn phần bodyRatio penalty còn thiếu trong `fb.ts`.

**Failure scenario**: Backtest tinh chỉnh ngưỡng (subtask 04) đổi số `0.3`/`15` trong
`shared.ts` nhưng 5 setup vẫn dùng số cũ — các setup lặng lẽ lệch nhau về cách chấm điểm mà
không test nào bắt được.

---

## 13. [ ] D1/M15 fetch nhưng không dùng — lãng phí ~2/3 số lệnh gọi API mỗi cycle
**File**: `src/charts/deterministic-pipeline.ts:39`
**Verdict**: CONFIRMED

```ts
const [h4Result, d1Result, m15Result] = await Promise.all([
  fetchOhlcHistory(symbol, "H4", 200),
  fetchOhlcHistory(symbol, "D1", 200),
  fetchOhlcHistory(symbol, "M15", 200),
]);
// d1Result, m15Result không được dùng ở đâu khác trong hàm
```

Docstring của hàm ghi "Fetch OHLC history for M15/H4/D1" nhưng chỉ `h4Result` được dùng để tính
indicator và chạy 7 detector. D1/M15 bị fetch rồi bỏ không.

**Cách fix**: Hoặc dùng D1 để xác nhận trend lớn / M15 để tinh chỉnh entry (đúng thiết kế gốc
trong context.md), hoặc bỏ hẳn 2 lệnh fetch này cho tới khi thực sự cần — tránh lãng phí quota
OANDA.

**Failure scenario**: Với N pairs mỗi cycle, khoảng 2/3 lệnh gọi OANDA (D1+M15) không phục vụ
mục đích gì, có thể khiến rate-limit OANDA cạn nhanh hơn cần thiết.

---

## 14. [ ] Thiếu test cho `shared.ts` (helper mới)
**File**: `src/charts/setups/shared.ts:1`
**Verdict**: CONFIRMED

Không có file test nào cho `computeSlope`, `computeBodyRatio`, `applyStandardConfidenceAdjustments`
(grep toàn bộ `tests/` không ra kết quả) — vi phạm quy ước "Tests: Vitest, trong `tests/` mirror
`src/` structure" trong CLAUDE.md cho file mới này.

**Cách fix**: Thêm `tests/charts/setups/shared.test.ts` test riêng 3 hàm trên (không phụ thuộc
vào test của từng setup).

**Failure scenario**: Logic slope/bodyRatio/confidence dùng chung cho nhiều setup không có test
trực tiếp — regression ở đây sẽ chỉ lộ ra gián tiếp qua test của `dd.ts`/`sb.ts`, khó debug.

---

## 15. [ ] `cached as any` phá vỡ type-check cho nhánh đọc cache
**File**: `src/charts/index.ts:51`
**Verdict**: PLAUSIBLE

```ts
if (cached) { result = cached as any; }
```

Ép kiểu `any` khiến TypeScript không kiểm tra được `cached` có đúng shape `AnalysisResult` hay
không — nếu type này đổi trong tương lai (thêm field bắt buộc), compiler chỉ bắt lỗi ở nhánh
`analyzeAllCharts`/`analyzeAllChartsDeterministic`, bỏ sót nhánh cache.

**Cách fix**: Định kiểu tường minh `result: AnalysisResult` và ép `cached as AnalysisResult`
(hoặc validate runtime) thay vì `as any`.

**Failure scenario**: Schema `AnalysisResult` đổi, nhánh cache-hit đọc payload cũ thiếu field
mới, crash ở `sendAllAnalyses` khi cố đọc field không tồn tại — chỉ xảy ra khi có cache hit nên
khó phát hiện qua test thông thường.

---

## Ghi chú (Round 2)
- #11 (retry regex mismatch) là bug **do chính fix Round 1 #8 gây ra** — trông như đã fix nhưng
  không hoạt động, cần review kỹ khi merge các fix "trông hợp lý".
- #10 và #12 là fix **chưa trọn vẹn** (chỉ áp dụng 1 phần code liên quan) — nên kiểm tra lại toàn
  bộ vị trí liên quan khi fix loại "thêm helper dùng chung" hoặc "thêm 1 detector mới".
- Ưu tiên fix: #9, #10, #11 trước khi cân nhắc bật `CHART_ENGINE_MODE=deterministic` (ảnh hưởng
  trực tiếp đến độ tin cậy của gate backtest và an toàn vận hành); #12-#15 có thể làm sau.
