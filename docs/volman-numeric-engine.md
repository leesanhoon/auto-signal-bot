# Volman Numeric Detection Engine

Tài liệu tổng hợp cho nhánh `feat/volman-numeric-engine`. Các file gốc
(`tasks/volman-numeric-engine/plan.md`, `context.md`, `round-2-fixes.md`, task.md từng
subtask, `reviews/volman-numeric-engine/review-summary.md`) đã bị xoá ở commit
`d6b4e12` sau khi mọi finding được fix — doc này viết lại từ lịch sử git để không mất
context khi cần tra cứu lại.

## Mục tiêu

Số hóa (deterministic, rule-based) toàn bộ 7 setup của Bob Volman — **DD, FB, BB, RB,
ARB, IRB, SB** — thay thế vision-LLM đoán pattern qua ảnh chart (`analyzer.ts`).
Downstream (`positions-repository`, `position-engine`, `telegram.ts`) không đổi vì chỉ
đọc field string có sẵn trong `TradeSetup` (`reasons`, `risks`, `summary`...), bất kể do
Template sinh từ `ruleTrace`.

Có 3 chế độ chạy, cấu hình qua env `CHART_ENGINE_MODE` (mặc định `shadow`,
xem [chart-config-env.ts](../src/charts/chart-config-env.ts)):
- `ai` — giữ nguyên hành vi cũ (chụp ảnh + vision model cũ).
- `deterministic` — chỉ dùng engine số hóa mới, không gọi model cũ.
- `shadow` — chạy song song cả hai để đối chiếu, nhưng chỉ gửi kết quả từ engine cũ ra Telegram.

## Kiến trúc

```
OHLC Provider (TwelveData, H4)          src/charts/ohlc-provider.ts
        │
        ▼
Indicator Primitives                   src/charts/indicators.ts
(EMA20 + slope, ATR14, doji, block/range compression, false-break, session/ATR filter)
        │
        ▼
Pattern State Machines (7 setup)       src/charts/setups/{dd,fb,bb,rb,arb,irb,sb}.ts
  → DetectedSignal { setup, direction, entry, stop, ruleTrace, confidence }
        │
        ▼
False-break → SB + conflict resolve    src/charts/setup-sb-runner.ts, setup-resolver.ts
        │
        ▼
Backtest Replay Engine                 src/charts/setup-backtest.ts (+ *-runner.ts)
        │
        ▼
Signal Assembly (template, KHÔNG model)   src/charts/signal-assembly.ts
        │
        ▼
Orchestration                          src/charts/index.ts, deterministic-pipeline.ts
```

## 7 setup (tóm tắt quy tắc)

| Setup | Context | Trigger chính |
|-------|---------|----------------|
| **DD** — Double Doji Break | Trend rõ (UP/DOWN) | ≥2 doji liên tiếp sát EMA20, breakout cụm doji |
| **FB** — First Break | Trend mới hình thành (≤10 nến) | Lần đầu giá chạm lại EMA20 kể từ khi có trend, breakout signal bar thuận trend |
| **BB** — Block Break | Trend rõ, slope chặt hơn DD | Block (compression) hình thành sát EMA20, breakout theo trend |
| **RB** — Range Break | Không cần trend | Range ngang ≥6 nến, breakout kèm slope đổi hướng theo breakout |
| **ARB** — Advanced Range Break | Range đã test biên ≥2 lần fail | Breakout lần này không bị false-break filter loại |
| **IRB** — Inside Range Break | Có RangeOuter lớn | RangeInner sát biên breakout kéo phá luôn RangeOuter |
| **SB** — Second Break | Sau breakout khác bị false-break | Buildup mới trong range cũ, breakout lần 2 ngược hướng false-break đầu |

Ngưỡng số cụ thể (Zdoji=0.15, Kblock=1.2, slope threshold=0.15...) và công thức
confidence scoring (`base=50` + bonus/penalty) nằm trong code (`indicators.ts`,
`setups/shared.ts`) — coi là điểm khởi đầu, cần backtest per-pair để tinh chỉnh trước
khi bật `deterministic` toàn phần.

Trước khi cutover hoàn toàn: chạy shadow-mode đối chiếu đủ lâu + backtest replay
(`npm run backtest:setups`) cho kết quả không tệ hơn model hiện tại — đây là gate bắt
buộc, không cutover dựa trên phỏng đoán ngưỡng.

## Lịch sử review & fix (4 vòng, 28 findings)

Toàn bộ engine + test được đưa vào trong 1 commit lớn (`b592d61`), sau đó fix qua nhiều
vòng review:

**Round 1** (8 findings, tất cả đã fix trong `b592d61`): price-sanity reject bị bỏ qua
bằng `??`, session/volatility filter import nhưng không gọi, cache không phân biệt
engine mode, lỗi shadow-mode chỉ log warn không cảnh báo, `detectSb` không được wiring
vào detector list, fetch OHLC tuần tự (9 pairs × 3 timeframe), logic
slope/bodyRatio/confidence duplicate ở 7 file setup, `fetchOhlcHistory` không dùng
retry có sẵn.

**Round 2** (7 findings, #9–#15, fix trong `b592d61`): filter fail-open thay vì
fail-safe khi thiếu ATR data, backtest thiếu `detectSb` (khác rule với production), fix
retry OANDA không thực sự nhận diện 429/5xx (thiếu `.status` trên error), refactor dedup
mới áp dụng 2/7 file, D1/M15 fetch nhưng không dùng (lãng phí ~67% quota), thiếu test
cho `shared.ts`, cache read dùng `as any`.

**Round 3** (7 findings, #16–#22, fix trong `d6d551c`): **bug nghiêm trọng nhất** — signal
gốc đã biết false-break vẫn là ứng viên hợp lệ trong resolver (không bị loại khỏi mảng
trước khi merge với SB signal → có thể chọn nhầm signal đã biết sai làm trade thật, ảnh
hưởng cả production lẫn win-rate backtest); backtest `bySetup` thiếu `"SB"`; dedup Round 2
chưa áp dụng cho rb/arb/bb; logic false-break→SB copy y hệt giữa 2 file (nguyên nhân gốc
của bug trên); cache validation chỉ đổi tên cast không validate thật; `fb.ts` sót 1 chỗ
tính bodyRatio inline; `detectSb` dùng sai index (lastIndex thay vì gần
`signal.triggerIndex`).

**Round 4** (6 findings, #23–#28, fix trong `d6d551c` + `d6b4e12`): fix Round 3 gộp thành
1 refactor — rút `runSbDetection` dùng chung vào [`setup-sb-runner.ts`](../src/charts/setup-sb-runner.ts),
dùng cho cả production và backtest, tự động giải quyết 6 finding cùng lúc. Round 4 review
xác nhận **lần đầu tiên không còn bug correctness nghiêm trọng**. Còn lại là
observability/cleanup: mất signal âm thầm khi false-break xác nhận nhưng `detectSb` fail
(chưa fix — low priority), thêm test cho `setup-sb-runner.ts` (đã fix, 6 test),
document magic number `SB_BUILDUP_LOOKAHEAD = 3` (đã fix), `rb.ts` tính lại slope trùng
biến có sẵn (đã fix), biến `risk` không dùng ở `arb.ts`/`rb.ts` (đã fix), merge +
resolve conflict logic lặp giữa 2 file (đã gộp vào `runSbDetection` ở commit `d6b4e12`).

Commit cuối (`d6b4e12`) còn thêm: `isValidAnalysisResult` schema-driven validation thật
cho cache read ([chart-cache-repository.ts](../src/charts/chart-cache-repository.ts),
thay cho cast no-op trước đó), và dọn `index.ts` không còn tự định nghĩa validate
trùng lặp.

## Trạng thái hiện tại

- Toàn bộ 28 finding qua 4 vòng review: đã fix hoặc là cleanup/observability không chặn
  cutover (#23 — mất signal âm thầm khi SB fail — vẫn còn, mức độ thấp, chỉ thiếu log).
- Chưa có bằng chứng đã chạy backtest thật trên dữ liệu OANDA để tinh chỉnh ngưỡng —
  đây vẫn là gate bắt buộc trước khi đổi `CHART_ENGINE_MODE` sang `deterministic` ở
  production.
- Chưa thấy dấu vết đã chạy shadow-mode dài hạn để đối chiếu với engine cũ.

## File tham chiếu chính

- Engine: [deterministic-pipeline.ts](../src/charts/deterministic-pipeline.ts),
  [ohlc-provider.ts](../src/charts/ohlc-provider.ts),
  [indicators.ts](../src/charts/indicators.ts), [setups/](../src/charts/setups/)
- Conflict resolve & SB: [setup-sb-runner.ts](../src/charts/setup-sb-runner.ts),
  [setup-resolver.ts](../src/charts/setup-resolver.ts)
- Backtest: [setup-backtest.ts](../src/charts/setup-backtest.ts),
  [setup-backtest-runner.ts](../src/charts/setup-backtest-runner.ts)
  (`npm run backtest:setups`)
- Signal assembly (template, deterministic): [signal-assembly.ts](../src/charts/signal-assembly.ts)
- Cache: [chart-cache-repository.ts](../src/charts/chart-cache-repository.ts)
- Orchestration/cutover: [index.ts](../src/charts/index.ts)
