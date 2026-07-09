# Plan: Rolling HTF Bias cho Backtest (thay thế static single-context)

## Bối cảnh

Sau khi [`smc-topdown-htf-architecture`](../smc-topdown-htf-architecture/review.md) được approve, Lead chạy backtest thật (H4 entry, D1 làm HTF, 4 cặp, dữ liệu sống) để verify. Kết quả **trái chiều**:

| Cặp | Win rate trước→sau (static HTF) |
|---|---|
| XAU/USD | 62.8% → 61.8% (gần như không đổi) |
| EUR/USD | 64.5% → **54.1%** (tệ đi rõ rệt) |
| GBP/USD | 55.7% → **58.8%** (cải thiện) |
| USD/JPY | 50.7% → **63.3%** (cải thiện mạnh) |

**Nguyên nhân đã xác định**: `buildHtfContext` hiện tính bias **1 lần duy nhất** từ toàn bộ chuỗi D1 (300 nến ≈ 300 ngày), rồi áp dụng **tĩnh** cho toàn bộ cửa sổ backtest H4 ~3 tháng. Thị trường thực tế đổi bias nhiều lần trong 3 tháng — cách tính tĩnh không phản ánh đúng "tại thời điểm đó, bias là gì", gây ra kết quả không nhất quán (EUR/USD bias D1 tổng thể là LONG suốt giai đoạn, nhưng thực ra các lệnh SHORT theo cấu trúc cục bộ mới là phần hoạt động tốt trong giai đoạn đó — bị loại oan).

## Mục tiêu

Nâng cấp **backtest** (không đụng production) để tính lại HTF bias theo từng thời điểm lịch sử (rolling) — tại mỗi candle entry, chỉ dùng các nến HTF **đã đóng thật sự tính đến thời điểm đó** (không nhìn trước tương lai — tránh look-ahead bias).

## Thiết kế

Thêm 1 hàm thuần tuý mới vào `src/charts/smc/smc-htf-context.ts` (không sửa hàm cũ):

```ts
export function buildRollingHtfContexts(
  htfTimeframe: ChartTimeframe,
  htfCandles: Candle[],
  entryCandles: Candle[],
): (HtfContext | null)[]
```

- Với mỗi `entryCandles[i]`, xác định số nến HTF đã đóng hoàn toàn tính đến `entryCandles[i].time` (dùng `intervalMs` của HTF timeframe để biết khi nào 1 nến HTF thực sự đóng — **không** dùng so sánh `time` thô, vì 1 nến H4 cùng ngày có `time` lớn hơn nến D1 cùng ngày dù nến D1 đó **chưa đóng** — đây chính là lỗi look-ahead cần tránh).
- Dùng con trỏ tăng dần (2 mảng đều sắp xếp theo thời gian tăng dần, đã đúng theo cách `fetchOhlcHistory` trả về) để tính hiệu quả O(n+m), không phải O(n×m).
- Cache lại context đã tính khi biên (boundary) nến HTF chưa đổi giữa các entry candle liên tiếp (nhiều entry candle dùng chung 1 context khi chưa có nến HTF mới đóng thêm) — tránh tính lại `findSwingPoints`/`detectTimeframeBias` không cần thiết.
- Tái dùng `computeHtfContextFromCandles` đã có sẵn (từ `smc-topdown-htf-architecture`) cho từng lát cắt — không viết lại logic tính bias/swing.

Rồi wire vào `runSmcBacktest`: đổi tham số thứ 4 từ `HtfContext | null` (1 context tĩnh) sang `(HtfContext | null)[]` (1 context riêng cho từng index) — tại mỗi vòng lặp lịch sử, lấy đúng context tại index đó thay vì dùng chung 1 context cho cả cửa sổ.

## Phạm vi — CHỈ backtest, KHÔNG đụng production

- `analyzeAllChartsSmc` (production, dùng `buildHtfContext` — context tĩnh "hiện tại") **giữ nguyên hoàn toàn** — production chỉ quan tâm bias "bây giờ", không cần rolling lịch sử. Không sửa hàm này.
- `analyzeSmcWindow`/`analyzeSmcSignalsAtIndex`/`buildSmcCandidatesAtIndex` (nhận 1 `HtfContext | null` mỗi lần gọi) **giữ nguyên signature** — không đổi gì ở tầng pipeline, vì rolling chỉ là cách backtest chọn đúng context cho từng lần gọi, bản thân hàm xử lý 1 thời điểm vẫn nhận đúng 1 context như cũ.
- Chỉ `runSmcBacktest` (trong `smc-backtest.ts`) và `smc-backtest-runner.ts` thay đổi.

## Ràng buộc bắt buộc

- Không sửa `buildHtfContext`, `computeHtfContextFromCandles`, `getHtfTimeframeFor` đã có (chỉ thêm hàm mới `buildRollingHtfContexts` bên cạnh).
- Không sửa `smc-pipeline.ts` (đã approve ở task trước, không cần đổi gì thêm).
- **Bài học từ 2 task trước — nhắc lại vì rất quan trọng**: khi thêm logic có điều kiện, không dùng `return` sớm làm mất code phía sau trong cùng 1 hàm xử lý tuần tự nhiều việc.
- Test phải chứng minh: nến HTF **chưa đóng** tại thời điểm entry candle không được dùng vào context (test look-ahead cụ thể, không chỉ test "có chạy được").
- Sau mỗi subtask: `npm run build && npm test` pass, không giảm test hiện có.
- Chạy tuần tự 01 → 02.

## Subtasks

| Subtask ID | Mô tả | Owner | Files chính | Dependency | Output kỳ vọng |
|---|---|---|---|---|---|
| [01-rolling-htf-context](01-rolling-htf-context/task.md) | Thêm `buildRollingHtfContexts` vào `smc-htf-context.ts`, thuần tuý, test riêng chứng minh không look-ahead | worker | `src/charts/smc/smc-htf-context.ts`, `tests/charts/smc/smc-htf-context.test.ts` | none | Hàm mới hoạt động đúng, test cover boundary case (nến HTF chưa đóng, vừa đóng, nhiều entry dùng chung context) |
| [02-wire-rolling-backtest](02-wire-rolling-backtest/task.md) | Đổi `runSmcBacktest` nhận mảng context theo index, cập nhật `smc-backtest-runner.ts` fetch đủ dữ liệu HTF lịch sử + build rolling array | worker | `src/charts/smc/smc-backtest.ts`, `src/charts/smc-backtest-runner.ts`, test tương ứng | 01 | Backtest dùng đúng context tại từng thời điểm lịch sử, không look-ahead, test cũ (single-context) được cập nhật hợp lý |

## Rủi ro & lưu ý

- Sau khi xong, Lead sẽ chạy lại đúng backtest thật (H4/D1, 4 cặp, cùng phương pháp) để so sánh: static-HTF (kết quả đã có) vs rolling-HTF (mới) vs không-HTF (baseline gốc) — 3 chiều so sánh để biết rolling có thực sự khắc phục được vấn đề EUR/USD hay không.
- Rolling khiến mỗi entry candle có thể có context khác nhau — số lượng "context switch" phụ thuộc tần suất nến HTF đóng (D1 đóng 1 lần/ngày, nên với H4 entry, cứ 6 nến H4 mới đổi context 1 lần — hợp lý, không phải lo hiệu năng).
