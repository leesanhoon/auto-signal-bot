# Plan: Volman Numeric Detection Engine

## Mục tiêu
Số hóa (deterministic, rule-based) toàn bộ 7 setup của Bob Volman đang được mô tả trong
prompt AI hiện tại — **DD, FB, BB, RB, ARB, IRB, SB** (định nghĩa chi tiết từng setup ở
[context.md](context.md)) — và **thay thế hoàn toàn** vision-LLM đoán pattern qua ảnh chart
như hiện nay ([analyzer.ts](../../src/charts/analyzer.ts)).

Quyết định: **cutover toàn bộ, không giữ AI song song lâu dài**. Sau giai đoạn shadow-mode
đối chiếu (subtask 06), lệnh gọi OpenRouter vision trong luồng chính sẽ bị gỡ bỏ — engine
toán học là nguồn duy nhất sinh setup. Lý do có thể cutover trọn vẹn: phần downstream
(`positions-repository`, `position-engine`, `telegram.ts`) chỉ đọc field string có sẵn trong
`TradeSetup` (`reasons`, `risks`, `summary`, `entryCondition`...) — không phụ thuộc việc các
field đó do AI viết hay do template sinh ra từ `ruleTrace`. Nên không cần đổi gì ở downstream.

## Đánh giá tính khả thi (đã kiểm tra trước khi chốt hướng)
**Đúng hướng** — cả 7 setup đều có cấu trúc hình học lượng hóa được (Volman viết sách chính
là để geometrize price action; AI vision hiện tại cũng chỉ đang áp cùng bộ quy tắc hình học
đó qua ảnh, không hề "hiểu" gì hơn thuật toán). Ưu thế thêm mà AI không có: backtest được,
reproducible, audit được qua `ruleTrace`.

**Điều kiện bắt buộc để cutover an toàn** (không được bỏ qua):
1. Ngưỡng số trong context.md (`Zdoji`, `Kblock`, `slope threshold`...) là điểm khởi đầu,
   CHƯA kiểm chứng — phải chạy backtest (subtask 04) trên dữ liệu OANDA thật để tinh chỉnh
   trước khi tắt AI, không cutover dựa trên phỏng đoán.
2. Cần quy tắc ưu tiên rõ ràng khi nhiều setup chồng lấn cùng lúc (ví dụ BB và DD cùng khớp
   điều kiện) — xử lý ở subtask 03, tránh bắn tín hiệu nhiễu/trùng.
3. Chấp nhận đánh đổi: thuật toán không bắt được 100% "feel" của trader kinh nghiệm (phản
   ứng quanh tin tức, cấu trúc D1 xa) — bù một phần bằng feature số hóa thêm (swing high/low,
   vùng S/R từ D1) nếu cần, nhưng không kỳ vọng thay thế tuyệt đối trực giác con người.
4. Ngưỡng có thể cần tinh chỉnh riêng theo từng pair (XAU/USD biến động khác USD/JPY) —
   backtest per-pair, không ép 1 bộ số chung nếu dữ liệu cho thấy lệch rõ.

## Vấn đề gốc rễ hiện tại
- Không có pipeline OHLC nào phục vụ phát hiện setup. `fetchCandleRangeStats`
  ([screenshot.ts:129](../../src/charts/screenshot.ts:129)) chỉ dùng Yahoo Finance 2m/1d để
  *hậu kiểm* lệnh đã trigger/cắt lỗ chưa — không phải nguồn cho detection.
- `forex-backtest.ts` chỉ tổng hợp kết quả các lệnh **đã đóng**, không replay lại lịch sử
  nến qua logic — không thể tinh chỉnh ngưỡng (Doji Z, Block threshold) bằng dữ liệu thật.
- Ngưỡng dạng "pips cố định" không hợp lý giữa các pair có biến động khác nhau
  (XAU/USD vs EUR/USD) — cần chuẩn hóa theo ATR.

## Kiến trúc mục tiêu

```
OHLC Provider (M15/H4/D1, nhiều nến lịch sử)
        │
        ▼
Indicator Primitives (EMA20 + slope, ATR14, doji ratio, block/range compression)
        │
        ▼
Pattern State Machines (DD / FB / BB / RB / ARB / IRB / SB)  →  DetectedSignal { setup, direction, entry, stop, ruleTrace, confidence }
        │
        ▼
Backtest Replay Engine (walk-forward qua lịch sử, đo win rate/expectancy theo setup)
        │
        ▼
Signal Assembly (ruleTrace → TradeSetup/PairSummary bằng template tiếng Việt, KHÔNG gọi AI)
        │
        ▼
Orchestration Cutover (index.ts dùng engine mới thay captureAllCharts+analyzeAllCharts)
```

## Subtask breakdown

### 01 — OHLC Data Provider (OANDA v20 practice API)
Nguồn dữ liệu chính: **OANDA v20 REST API** (practice/demo account, miễn phí) —
`GET /v3/instruments/{instrument}/candles?granularity=H4&count=500&price=M`.
Lý do chọn: khớp đúng symbol đang cấu hình (`OANDA:EURUSD` → `EUR_USD`), granularity
`M15/H4/D` gần như 1:1 với `ChartTimeframe` nên không cần tự resample như phương án Yahoo,
tới 5000 nến/request đủ cho cả live lẫn backtest, và có volume thật (Yahoo không đáng tin
cho forex) — hữu ích cho BB/RB vì Volman coi trọng volume tại điểm breakout.
Cần biến môi trường `OANDA_API_TOKEN` + `OANDA_ACCOUNT_ID` (người dùng tự đăng ký, không
tự động hoá được bước này). Yahoo Finance (`fetchCandleRangeStats` hiện có) giữ làm fallback
dự phòng khi OANDA lỗi/rate-limit, KHÔNG xoá code cũ.
→ [01-ohlc-data-provider/task.md](01-ohlc-data-provider/task.md)

### 02 — Indicator Primitives
Pure function, ATR-normalized: EMA20 + slope classifier (flat/up/down), ATR(14), doji
detector (`|Open-Close| ≤ Z·ATR`, body/range ratio nhỏ), sliding-window block/range
compression detector (`Max(High)-Min(Low) < Threshold·ATR` trên cửa sổ 4-6 nến).
Unit test đầy đủ theo chuẩn Vitest của project (`tests/` mirror `src/`).

### 03 — Pattern State Machines
Mỗi setup (DD, FB, BB, RB, ARB, IRB, SB — quy tắc chi tiết ở [context.md §2](context.md))
là 1 state machine riêng theo pattern chung
(`SearchingTrend → WaitingPullback/Compression → TensionDetected → Triggered`), input là
indicator series (subtask 02), output là `DetectedSignal` kèm `ruleTrace` (lý do từng bước)
và `confidence` theo công thức scoring ở [context.md §3](context.md). Bao gồm false-break
filter (SB được sinh ra như nhánh phụ khi 1 setup khác fail) và session/volatility filter
làm cross-cutting rule. **Cần thêm bước resolve xung đột**: khi nhiều state machine cùng
trigger 1 thời điểm cho cùng 1 pair, chỉ giữ lại tín hiệu có `confidence` cao nhất hoặc theo
thứ tự ưu tiên cấu hình được (ví dụ ARB > RB > BB > DD do điều kiện chặt hơn).

### 04 — Backtest Replay Engine (gate bắt buộc trước cutover)
Engine mới (khác `forex-backtest.ts` hiện tại) walk-forward qua OHLC lịch sử OANDA, giả lập
entry/stop/TP theo từng state machine, xuất win rate/expectancy/riskReward theo setup và
theo từng pair riêng — dùng để tinh chỉnh ngưỡng Z/Block/ATR-multiplier bằng dữ liệu thật
thay vì đoán. **Đây là gate bắt buộc**: subtask 06 (cutover) chỉ được thực hiện sau khi
subtask này cho kết quả tối thiểu không tệ hơn hiệu năng AI hiện tại (đo qua
`performance-tracking.ts`/`forex-backtest.ts` đã có sẵn của hệ thống cũ).

### 05 — Signal Assembly (thay thế AI hoàn toàn)
Gắn `ruleTrace: string[]` vào `TradeSetup`/`PairSummary` type
([chart-types.ts](../../src/charts/chart-types.ts)). Viết hàm build `TradeSetup[]`/
`PairSummary[]` trực tiếp từ `DetectedSignal` (subtask 03) + OHLC context — KHÔNG gọi AI.
`reasons`/`risks`/`summary`/`entryCondition`/`currentPriceContext` sinh ra bằng template
tiếng Việt tham chiếu `ruleTrace` (ví dụ: "EMA20 dốc lên, 2 doji liên tiếp sát EMA, nến thứ 3
phá đỉnh cụm doji"). `confidence` tính từ rule scoring (không phải AI đoán) — ví dụ dựa trên
độ rõ của compression, khoảng cách tới EMA, ATR ratio.

### 06 — Orchestration Cutover
Sửa [index.ts](../../src/charts/index.ts): thay `captureAllCharts()` + `analyzeAllCharts()`
bằng pipeline mới (OHLC provider → indicators → state machines → signal assembly). Giữ lại
`captureAllCharts` CHỈ để đính kèm ảnh chart minh hoạ khi gửi Telegram (không dùng để phát
hiện setup nữa) — có thể tắt qua flag nếu muốn bỏ luôn phần chụp ảnh để giảm chi phí/thời
gian chạy. Trước khi xoá hẳn `analyzer.ts`/lệnh gọi OpenRouter, chạy shadow-mode tối thiểu
N ngày (log song song deterministic vs AI cũ, không gửi AI ra Telegram) để xác nhận
deterministic engine không thụt lùi so với AI hiện tại (dùng report từ subtask 04). Sau khi
xác nhận ổn, xoá lệnh gọi OpenRouter khỏi luồng chính (có thể giữ `analyzer.ts` như tiện ích
debug/so sánh thủ công, không chạy production).

## Review checkpoints
Sau mỗi subtask, Lead review `result.md` so với `task.md` tương ứng, ghi
`reviews/volman-numeric-engine/review-0X-*.md` nếu có issue, `done.md` khi tất cả subtask
approved.
