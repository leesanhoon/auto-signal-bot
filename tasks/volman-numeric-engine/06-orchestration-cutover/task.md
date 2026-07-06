# Task 06: Orchestration Cutover

## Bối cảnh
**KHÔNG bắt đầu task này cho đến khi Lead xác nhận subtask 04 (backtest replay) cho kết quả
chấp nhận được** (xem [plan.md](../plan.md) — đây là gate bắt buộc). Nếu bạn là worker và
được giao task này, hãy hỏi Lead xác nhận điều kiện trên trước khi code, đừng tự giả định.

Mục tiêu: nối toàn bộ pipeline mới (OANDA provider → indicators → 7 state machine → signal
assembly) vào [index.ts](../../../src/charts/index.ts), thay thế
`captureAllCharts()` + `analyzeAllCharts()`, với 1 giai đoạn shadow-mode an toàn trước khi
tắt hẳn AI.

## Yêu cầu

### 1. Feature flag
Thêm hàm vào [chart-config-env.ts](../../../src/charts/chart-config-env.ts) (đọc file này
trước để theo đúng pattern đọc env hiện có):
```ts
export type ChartEngineMode = "ai" | "deterministic" | "shadow";
export function getConfiguredChartEngineMode(): ChartEngineMode
```
- Đọc từ `process.env.CHART_ENGINE_MODE`, mặc định `"shadow"` (an toàn nhất — không tự động
  chuyển sang deterministic-only nếu không cấu hình).
- `"ai"`: giữ nguyên hành vi hiện tại (dùng `analyzeAllCharts`).
- `"deterministic"`: dùng hoàn toàn pipeline mới, KHÔNG gọi `analyzeAllCharts`/OpenRouter.
- `"shadow"`: chạy CẢ HAI song song, chỉ dùng kết quả AI để gửi Telegram/lưu position (hành
  vi y hệt hiện tại với người dùng), nhưng log kết quả deterministic ra để đối chiếu (không
  gửi/không lưu deterministic setup ở chế độ này).

### 2. Hàm build pipeline mới
Tạo file mới `src/charts/deterministic-pipeline.ts`:
```ts
export async function analyzeAllChartsDeterministic(
  pairs: Array<{ pair: string; symbol: string }>,
): Promise<AnalysisResult>
```
- Với mỗi pair, gọi `fetchOhlcHistory` (subtask 01) cho cả 3 timeframe M15/H4/D1 (bars đủ
  dùng, ví dụ 200 nến mỗi timeframe).
- Nếu `fetchOhlcHistory` trả `Error` cho 1 pair, log warning và bỏ qua pair đó (không làm
  fail toàn bộ batch) — theo đúng pattern try/catch per-pair đã có trong
  `analyzeAllCharts` ở `analyzer.ts` (tham khảo cấu trúc `Promise.all` ở đó).
- Chạy indicators (subtask 02) + 7 detector (subtask 03) + `resolveSetupConflicts` cho từng
  pair trên timeframe H4 làm chính (giữ nguyên logic `primaryTimeframe` mặc định H4 như hệ
  thống cũ), dùng D1 để xác nhận trend lớn nếu detector cần (tùy setup, xem context.md).
- Ghép kết quả qua `buildTradeSetupFromSignal`/`buildPairSummaryFromContext` (subtask 05)
  thành `AnalysisResult` đúng type hiện có ([chart-types.ts](../../../src/charts/chart-types.ts)).
- Trả `noSetupReason` tổng hợp lý do các pair không có signal (dựa vào `ruleTrace` của lần
  detect gần nhất bị fail, nếu có).

### 3. Sửa `index.ts`
- Thay đoạn gọi `captureAllCharts()` + `analyzeAllCharts()`
  ([index.ts:40-45](../../../src/charts/index.ts:40)) bằng logic rẽ nhánh theo
  `getConfiguredChartEngineMode()`:
  - `"ai"`: y hệt code hiện tại.
  - `"deterministic"`: gọi `analyzeAllChartsDeterministic`, KHÔNG gọi `captureAllCharts`
    (bỏ luôn bước screenshot để tiết kiệm thời gian — trừ khi cần ảnh cho Telegram, xem mục
    4 bên dưới).
  - `"shadow"`: gọi CẢ HAI (giữ `captureAllCharts`+`analyzeAllCharts` làm nguồn chính thức
    như hiện tại), sau đó gọi thêm `analyzeAllChartsDeterministic` trong khối `try/catch`
    riêng (lỗi ở nhánh deterministic không được làm crash luồng chính), chỉ
    `logger.info` so sánh: số setup AI tìm thấy vs số setup deterministic tìm thấy, và với
    mỗi pair có cả 2 nguồn đều ra signal, log xem `direction`/`setup` có khớp nhau không.
- Phần downstream (`shouldAutoTrackAsOpen`, `validateTradeSetupForOpen`, `saveOpenPosition`,
  `savePendingOrder`, `sendAllAnalyses`) **giữ nguyên không đổi** — chỉ áp dụng lên
  `result` bất kể nó đến từ nguồn nào, vì `TradeSetup`/`PairSummary` đã tương thích (subtask
  05 đảm bảo).

### 4. Ảnh chart cho Telegram ở chế độ deterministic
Ở chế độ `"deterministic"`, nếu vẫn muốn đính kèm ảnh minh hoạ khi gửi Telegram, gọi
`captureAllCharts()` CHỈ cho các pair có setup được phát hiện (không phải toàn bộ danh sách
như hiện tại) để giảm thời gian chạy — hoặc bỏ hẳn bước chụp ảnh nếu Lead xác nhận không cần
(kiểm tra `sendAllAnalyses` có tự xử lý được trường hợp không có `screenshots` không, đọc
`telegram.ts` phần dùng `result.screenshots` trước khi quyết định).

### 5. Cập nhật `.env.example`
Thêm `CHART_ENGINE_MODE=shadow` (kèm comment giải thích 3 giá trị) vào `.env.example`.

### Test
- Viết `tests/charts/deterministic-pipeline.test.ts`: mock `fetchOhlcHistory` trả fixture,
  kiểm tra `analyzeAllChartsDeterministic` trả đúng `AnalysisResult` shape, xử lý đúng khi 1
  pair fail (Error) mà không làm hỏng cả batch.
- Viết/cập nhật test cho `getConfiguredChartEngineMode` trong
  `tests/charts/chart-config-env.test.ts` (mirror file test hiện có nếu đã tồn tại).

## Không cần làm
- Không tự ý xóa `analyzer.ts` hay lệnh gọi OpenRouter trong task này — plan đã nêu rõ: chỉ
  gỡ sau khi shadow-mode chạy đủ lâu và Lead xác nhận thủ công (không phải quyết định của
  worker).
- Không cần chạy thật với OANDA/OpenRouter — test bằng mock.

## Kết quả mong đợi
Ghi vào `result.md`:
- Danh sách file đã tạo/sửa.
- Output `npm run build` và `npm run test -- --run` (pass toàn bộ, không phá test cũ liên
  quan `index.ts`/`chart-config-env.ts`).
- Xác nhận rõ: ở mode `"ai"` (mặc định hệ thống cũ set thủ công), hành vi 100% không đổi so
  với trước — đây là điều kiện bắt buộc để không phá vỡ production khi task này merge trước
  khi Lead sẵn sàng bật `"deterministic"`.
