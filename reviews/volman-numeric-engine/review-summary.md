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

---

# Round 3 (re-review sau khi commit Round 2 — `b592d61`)

Toàn bộ Round 2 đã được commit. 6/7 fix xác nhận đúng và sạch (#9 fail-safe filter, #11 retry
`.status`, #13 xoá D1/M15, #14 test shared.ts đều verify tốt — không phát sinh bug mới). Nhưng
phát hiện **1 bug mới nghiêm trọng nhất từ trước đến giờ** (#16), cùng vài fix chưa trọn vẹn.

---

## 16. [x] Signal gốc đã biết false-break vẫn là ứng viên hợp lệ trong resolver — nghiêm trọng nhất
**File**: `src/charts/deterministic-pipeline.ts:122` (và y hệt ở `src/charts/setup-backtest.ts:118`)
**Verdict**: CONFIRMED

```ts
const combined = [...allSignals, ...sbSignals];
// allSignals vẫn chứa signal GỐC đã bị isFalseBreak() xác nhận là sai,
// không hề bị loại bỏ trước khi merge với sbSignals rồi đưa vào resolveSetupConflicts
```

Khi 1 signal (VD từ `detectFb`) bị phát hiện false-break, hệ thống gọi `detectSb` để tìm signal
đảo chiều — nhưng **không loại signal gốc khỏi `allSignals`**. `resolveSetupConflicts`
(`setup-resolver.ts`) chỉ group theo `pair` và sort theo `confidence`/`priority`, hoàn toàn
không biết gì về lịch sử false-break (không có field `invalidated`/`isFalseBreak` nào được
check). Nếu confidence của signal gốc > confidence của SB signal, resolver sẽ **giữ lại chính
signal đã biết là sai**, bỏ signal SB đúng.

Bug này ảnh hưởng **cả production** (`deterministic-pipeline.ts` → `buildTradeSetupFromSignal`
→ `AnalysisResult.setups` → auto-track/Telegram) **lẫn backtest** (`setup-backtest.ts`, làm sai
lệch win-rate của chính setup gốc vì tính cả trade đã biết invalid).

**Cách fix**: Sau khi xác nhận false-break và tạo `sbSignal`, loại bỏ signal gốc khỏi mảng
trước khi merge:
```ts
const combined = [...allSignals.filter(s => s !== signal), ...sbSignals];
```
Áp dụng đồng thời ở cả `deterministic-pipeline.ts` và `setup-backtest.ts`.

**Failure scenario**: FB signal confidence 70 bị false-break, SB signal đảo chiều confidence
60 — resolver chọn nhầm FB (đã biết sai) làm trade thật, gửi Telegram/auto-track sai hướng.

---

## 17. [x] Backtest `bySetup` vẫn thiếu `"SB"` dù đã wiring detectSb
**File**: `src/charts/setup-backtest.ts:235`
**Verdict**: CONFIRMED

```ts
// computeReport() hardcode danh sách setup, thiếu "SB":
["DD", "FB", "BB", "RB", "ARB", "IRB"]
```

Round 2 #10 đã cắm `detectSb` vào backtest và trade SB được tính vào `trades[]`/`overall`/
`byPair`, nhưng `bySetup` vẫn dùng mảng hardcode cũ thiếu `"SB"` — nên `bySetup["SB"]` luôn
`undefined`, tổng `sum(bySetup[*].trades)` sẽ nhỏ hơn `overall.trades`, gây khó hiểu khi audit
báo cáo.

**Cách fix**: Thêm `"SB"` vào mảng hardcode trong `computeReport`.

**Failure scenario**: Người xem báo cáo win-rate theo setup không thấy SB đâu, tưởng SB chưa
từng chạy, trong khi nó đã được tính vào tổng — dễ đưa ra quyết định sai khi đánh giá có nên bật
`CHART_ENGINE_MODE=deterministic` hay không.

---

## 18. [x] Refactor dedup Round 2 #12 chưa áp dụng cho `rb.ts`/`arb.ts`/`bb.ts`
**File**: `src/charts/setups/rb.ts:4`
**Verdict**: CONFIRMED

`rb.ts` và `arb.ts` import `computeSlope`/`applyStandardConfidenceAdjustments` từ `shared.ts`
nhưng **không hề gọi** — vẫn giữ nguyên logic slope/confidence tự viết inline (`rb.ts` còn có
rule riêng "FLAT→trend +15" không có trong `shared.ts`). `bb.ts` cũng import `computeSlope`
nhưng không gọi, tự tính slope inline. Chỉ `fb.ts`, `bb.ts` (phần confidence), `irb.ts`,
`dd.ts`, `sb.ts` thực sự dùng `applyStandardConfidenceAdjustments`.

**Cách fix**: Với `rb.ts`/`arb.ts`, hoặc chuyển hẳn sang gọi `computeSlope` (giữ rule riêng như
tham số bổ sung), hoặc xóa import không dùng và ghi chú rõ đây là setup có logic đặc thù không
dùng chung — tránh gây hiểu lầm là "đã refactor" trong khi chưa.

**Failure scenario**: Backtest tinh chỉnh ngưỡng trong `shared.ts` không ảnh hưởng gì đến
`rb.ts`/`arb.ts`/`bb.ts` — dễ tưởng đã áp dụng đồng bộ nhưng thực ra 3/7 setup vẫn dùng số cũ.

---

## 19. [x] Logic false-break→SB copy y hệt giữa 2 file — nguyên nhân gốc của #16
**File**: `src/charts/setup-backtest.ts:93` (trùng với `deterministic-pipeline.ts:95-119`)
**Verdict**: CONFIRMED

Toàn bộ block tính `levelHigh`/`levelLow`, gọi `isFalseBreak`, gọi `detectSb`, `ruleTrace.unshift(...)`
bị copy gần như nguyên văn giữa 2 file thay vì rút thành 1 helper dùng chung.

**Cách fix**: Rút thành `runSbDetectionForSignals(candles, signals, index, ctx)` dùng chung cho
cả `deterministic-pipeline.ts` và `setup-backtest.ts` — fix #16 chỉ cần sửa 1 chỗ thay vì 2.

**Failure scenario**: Đây chính là lý do bug #16 xuất hiện ở cả production lẫn backtest — sửa
1 chỗ mà quên chỗ kia là kịch bản rất dễ xảy ra với code bị duplicate kiểu này.

---

## 20. [x] Fix #15 (cache type-safety) chỉ đổi tên cast, không thêm validation thật
**File**: `src/charts/index.ts:52`
**Verdict**: CONFIRMED

```ts
result = cached as AnalysisResult; // trước đó là `as any`
```

`loadChartAnalysisCache` đã khai báo return type `Promise<AnalysisResult | null>` sẵn — nên
`cached as AnalysisResult` chỉ là ép kiểu no-op (bỏ `null`), không thêm bất kỳ validate runtime
nào. Về bản chất an toàn y hệt `as any` cũ, chỉ khác là trông "có vẻ" đã fix.

**Cách fix**: Thêm validate runtime tối thiểu (check các field bắt buộc tồn tại) trước khi gán
vào `result`, thay vì chỉ đổi cú pháp cast.

**Failure scenario**: Schema `chart_analysis_cache` đổi trong tương lai (thêm field bắt buộc),
nhánh cache-hit vẫn đọc được payload cũ thiếu field mà không hề báo lỗi, crash muộn hơn ở
`sendAllAnalyses`.

---

## 21. [x] `fb.ts` còn sót 1 chỗ tính bodyRatio inline
**File**: `src/charts/setups/fb.ts:109`
**Verdict**: CONFIRMED

Dù đã import `computeBodyRatio` từ `shared.ts` (dùng trong `applyStandardConfidenceAdjustments`),
`fb.ts` vẫn có 1 chỗ khác tự tính `bodyRatio` inline thay vì gọi lại hàm chung.

**Cách fix**: Thay chỗ tính inline còn sót bằng lệnh gọi `computeBodyRatio(...)`.

**Failure scenario**: Hiện tại trùng kết quả do trùng hợp (cùng công thức fallback), nhưng nếu
`computeBodyRatio` đổi cách xử lý range=0 sau này, chỗ inline này sẽ lặng lẽ lệch mà không test
nào bắt được.

---

## 22. [x] `detectSb` luôn chạy ở nến cuối cùng, không phải đúng vị trí signal gốc trigger
**File**: `src/charts/deterministic-pipeline.ts:109`
**Verdict**: PLAUSIBLE

```ts
const sbSignal = detectSb(primaryCandles, lastIndex, ctx, signal);
// luôn dùng lastIndex, dù signal.triggerIndex có thể ở vài nến trước đó
```

Khác với `setup-backtest.ts` (dùng đúng `index` của vòng lặp walk-forward hiện tại),
`deterministic-pipeline.ts` luôn phân tích SB tại `lastIndex` (nến mới nhất) bất kể
`signal.triggerIndex` nằm ở đâu trong cửa sổ lookback.

**Cách fix**: Cần xác nhận lại chủ đích — nếu SB nên phân tích buildup ngay sau điểm false-break
gốc, nên dùng index gần `signal.triggerIndex` hơn là luôn dùng `lastIndex`.

**Failure scenario**: False-break xảy ra ở vài nến trước, nhưng SB phân tích buildup tại nến mới
nhất — có thể cho ra tín hiệu SB hợp lý về mặt hình học nhưng sai ngữ cảnh thực tế.

---

## Ghi chú (Round 3)
- **#16 là bug nghiêm trọng nhất phát hiện từ trước đến giờ** — ảnh hưởng trực tiếp cả production
  lẫn backtest, cần fix ngay trước khi cân nhắc bật `CHART_ENGINE_MODE=deterministic`.
- #16 và #19 nên fix cùng lúc (rút helper dùng chung sẽ tự động fix cả 2 nơi).
- Ưu tiên fix: #16 → #19 → #17 → #18, còn lại (#20-#22) có thể làm sau.

---

# Round 4 (re-review sau khi rút `setup-sb-runner.ts` dùng chung)

Fix cho #16/#17/#18/#19/#21/#22 được gộp thành 1 refactor: rút `runSbDetection` vào file mới
`src/charts/setup-sb-runner.ts`, dùng chung cho cả `deterministic-pipeline.ts` và
`setup-backtest.ts`. Verify: **6/6 finding trên đã fix đúng, sạch, không phát sinh bug
correctness mới** — đây là lần review đầu tiên trong chuỗi không tìm thấy lỗi ảnh hưởng trực
tiếp đến kết quả trading. 6 finding còn lại đều ở mức thấp (observability/cleanup/docs).

---

## 23. [ ] Mất signal âm thầm khi false-break xác nhận nhưng `detectSb` fail
**File**: `src/charts/setup-sb-runner.ts:39`
**Verdict**: PLAUSIBLE

```ts
if (fbResult) {
  const sbIndex = Math.min(signal.triggerIndex + 3, currentIndex);
  try {
    const sbSignal = detectSb(candles, sbIndex, ctx, signal);
    if (sbSignal) { sbSignals.push(sbSignal); }
  } catch { /* skip SB errors */ }
  continue; // luôn bỏ signal gốc, kể cả khi detectSb trả null/throw
}
```

Khi xác nhận false-break nhưng `detectSb` không tạo được signal đảo chiều (VD không hình thành
block mới trong old range), signal gốc **và** SB signal đều biến mất — không có log/trace nào
ghi lại lý do. Khó phân biệt "không có false-break" với "có false-break nhưng SB cũng fail" khi
debug thiếu tín hiệu.

**Cách fix**: Thêm log/trace khi rơi vào nhánh này mà `sbSignal` là `null` (VD
`logger.debug` hoặc append vào 1 mảng `droppedSignals` để dễ audit).

**Failure scenario**: Pair có false-break thật nhưng không có compression mới hình thành —
signal biến mất hoàn toàn, không ai biết lý do khi review log.

---

## 24. [ ] `setup-sb-runner.ts` chưa có test
**File**: `src/charts/setup-sb-runner.ts:1`
**Verdict**: CONFIRMED

File mới này chính là nơi fix bug nghiêm trọng nhất (#16) nhưng chưa có
`tests/charts/setup-sb-runner.test.ts` — vi phạm quy ước "Tests: Vitest, trong `tests/` mirror
`src/` structure" trong CLAUDE.md.

**Cách fix**: Thêm test cho `runSbDetection`, tối thiểu cover:
- Signal false-break → bị loại khỏi `validSignals`, có mặt trong `sbSignals` (hoặc không, nếu
  `detectSb` trả null).
- Signal không false-break → giữ nguyên trong `validSignals`.
- Signal quá gần cuối mảng (không đủ lookahead) → giữ nguyên trong `validSignals`.

**Failure scenario**: Fix quan trọng nhất trong toàn bộ chuỗi review này hiện không có regression
test — 1 lần sửa `isFalseBreak`/`detectSb` trong tương lai có thể vô tình làm bug #16 quay lại
mà không ai biết.

---

## 25. [ ] Magic number `+3` không có tài liệu giải thích
**File**: `src/charts/setup-sb-runner.ts:32`
**Verdict**: CONFIRMED

```ts
const sbIndex = Math.min(signal.triggerIndex + 3, currentIndex);
```

Không có chỗ nào trong `context.md` hay code giải thích tại sao là `+3` (không phải `+2`/`+4`).

**Cách fix**: Thêm comment giải thích rationale (VD "chờ 3 nến để buildup mới hình thành sau
false-break, theo context.md §2.7"), hoặc đặt thành hằng số có tên
(`const SB_BUILDUP_LOOKAHEAD = 3;`) kèm giải thích.

**Failure scenario**: Setup tương lai cần logic "nhìn N nến sau 1 signal trước đó" sẽ không có
pattern/hằng số nào để tái sử dụng, dễ hardcode số tùy tiện khác không nhất quán.

---

## 26. [ ] `rb.ts` tính lại slope trùng với biến đã có sẵn
**File**: `src/charts/setups/rb.ts:120`
**Verdict**: CONFIRMED

`computeSlope(ctx.ema20, ctx.atr14, index)` tính lại đúng công thức đã có sẵn ở biến
`slopeNow` (dùng cho rule "FLAT→trend" riêng của RB) vài dòng trước đó. Không sai kết quả,
nhưng dư thừa.

**Cách fix**: Dùng lại `slopeNow` thay vì gọi `computeSlope` lần nữa trong cùng hàm.

**Failure scenario**: Không ảnh hưởng correctness hiện tại, chỉ tốn thêm 1 lần tính toán mỗi
lần detector chạy — tích lũy nhỏ qua nhiều nến trong backtest.

---

## 27. [ ] Biến `risk` không dùng trong `arb.ts`/`rb.ts` (có từ trước, chưa dọn)
**File**: `src/charts/setups/arb.ts:107`
**Verdict**: CONFIRMED

`const risk = Math.abs(entry - stopLoss);` được tính nhưng không dùng ở đâu (TP1/TP2 dùng
`rangeHeight` thay vì `risk`). Cùng pattern tồn tại ở `rb.ts:97`. Đây là dead code có từ trước,
không phải do Round 4 gây ra, nhưng chưa được dọn khi 2 file này vừa được sửa.

**Cách fix**: Xóa biến `risk` không dùng ở cả 2 file (hoặc dùng nó nếu thực ra dự định
đưa vào TP calculation).

**Failure scenario**: Người đọc code tưởng `risk` được dùng trong tính TP, mất thời gian trace
biến không có tác dụng gì.

---

## 28. [ ] Đoạn merge + resolveSetupConflicts lặp lại giữa 2 file
**File**: `src/charts/deterministic-pipeline.ts:96`
**Verdict**: CONFIRMED

```ts
const { validSignals, sbSignals } = runSbDetection(primaryCandles, allSignals, lastIndex, ctx);
const combined = [...validSignals, ...sbSignals];
const resolved = resolveSetupConflicts(combined);
```

3 dòng này lặp lại y hệt ở `setup-backtest.ts` thay vì gộp vào `runSbDetection` (hoặc 1 helper
`runSbDetectionAndResolve`).

**Cách fix**: Gộp bước merge + resolve vào trong `runSbDetection`, trả thẳng `resolved` cho cả
2 nơi gọi.

**Failure scenario**: Đây chính là kiểu duplicate đã gây ra bug #16/#19 trước đó (sửa 1 chỗ quên
chỗ kia) — nếu logic resolve/merge cần đổi trong tương lai, rủi ro lặp lại y hệt.

---

## Ghi chú (Round 4)
- **Không còn bug correctness nghiêm trọng** — lần đầu tiên trong chuỗi review này. Refactor
  `runSbDetection` đã giải quyết gọn 6 finding cùng lúc.
- #24 (thiếu test cho file vừa fix bug nghiêm trọng nhất) nên ưu tiên làm trước, vì đây là điểm
  dễ tái phát bug #16 nhất nếu không có test chặn lại.
- #23, #25-#28 đều là cleanup/observability, không khẩn cấp — có thể làm bất kỳ lúc nào trước
  khi merge, không cần chặn việc bật `CHART_ENGINE_MODE=deterministic`.
