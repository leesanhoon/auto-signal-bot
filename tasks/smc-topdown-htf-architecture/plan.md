# Plan: SMC Top-Down HTF Architecture (đúng chuẩn multi-timeframe)

## Bối cảnh

Sau khi hoàn thành [`smc-correctness-fixes`](../smc-correctness-fixes/done.md) và [`smc-liquidity-sweep-quality`](../smc-liquidity-sweep-quality/review.md), review timeframe cho thấy hệ thống **chưa đúng chuẩn SMC top-down**:

Chuẩn SMC/ICT đầy đủ dùng mô hình 3 tầng:
1. **HTF (H4/D1)** — xác định bias tổng thể + dealing range thật (để tính premium/discount đúng nghĩa)
2. **MTF (H1/M30)** — xác nhận thêm (đã có, dùng `checkMultiTimeframeConfluence`)
3. **LTF (M15)** — entry chính xác

Hệ thống hiện tại:

| Vấn đề | Vị trí | Chi tiết |
|---|---|---|
| Luôn phân tích M15 dù tên biến "multi" | [smc-pipeline.ts:34-38](../../src/charts/smc/smc-pipeline.ts#L34-L38) | `analysisTimeframe` trả về `"M15"` khi `timeframeMode !== "single"` — mặc định env là `multi` nên **luôn chạy M15**, tên gọi gây hiểu lầm |
| Premium/discount tính sai tầng | [smc-liquidity-context.ts:37-53](../../src/charts/smc/smc-liquidity-context.ts#L37-L53), gọi từ [smc-pipeline.ts:179](../../src/charts/smc/smc-pipeline.ts#L179) | `calculatePremiumDiscountZone` dùng swing **của chính M15** (khung entry) — không phản ánh dealing range thật trên khung lớn hơn |
| D1/H4 bị lãng phí | [charts.config.ts](../../src/charts/charts.config.ts) | Đã cấu hình sẵn cho mỗi cặp nhưng chỉ dùng để chụp ảnh chart Telegram (`screenshot.ts`), không đưa vào tính toán SMC |
| Không có gate hướng theo HTF | toàn bộ `smc-pipeline.ts` | H1/M30 confluence chỉ cộng/trừ điểm (+10/-5), không **loại cứng** setup ngược hướng HTF — vi phạm nguyên tắc top-down cơ bản nhất của SMC ("chỉ vào lệnh cùng hướng bias khung lớn") |

## Mục tiêu kiến trúc

Thêm 1 tầng **HTF Context** (H4 cho entry M15, D1 cho entry H4) được tính 1 lần mỗi cặp mỗi lượt phân tích, gồm:
- **HTF bias** (LONG/SHORT/null) — tái dùng `detectTimeframeBias` đã có sẵn trong `smc-confluence.ts`, không viết lại.
- **HTF dealing range** (swings HTF) — tái dùng `findSwingPoints` (từ `smc-structure.ts`) + `calculatePremiumDiscountZone`/`findDealingRange` (từ `smc-liquidity-context.ts`) đã có sẵn, **không cần sửa** 2 file này — chỉ gọi lại với input là swings/candles HTF thay vì M15-local.

Rồi áp dụng 2 thay đổi vào `smc-pipeline.ts`:
1. Premium/discount của setup OB dùng HTF range thay vì M15-local range khi có HTF context.
2. **Gate cứng theo hướng**: nếu HTF bias xác định được và ngược hướng với setup LTF (cả 3 setup: OB, Sweep, FVG) → loại hẳn signal đó, không chỉ hạ điểm.

Khi không lấy được HTF context (lỗi fetch, không đủ dữ liệu) → **giữ nguyên hành vi cũ** (fallback M15-local, không gate) — không được chặn cứng toàn hệ thống vì thiếu 1 nguồn dữ liệu phụ.

## Ràng buộc bắt buộc cho mọi subtask

- **Không sửa** `smc-structure.ts`, `smc-liquidity-context.ts`, `smc-confluence.ts`, `smc-session.ts`, `smc-signal-assembly.ts` — toàn bộ hàm cần dùng (`findSwingPoints`, `detectTimeframeBias`, `calculatePremiumDiscountZone`, `findDealingRange`) đã export sẵn, chỉ cần import và gọi lại với input khác, không cần đổi hàm gốc.
- Module mới (`smc-htf-context.ts`) phải **pure/testable**: hàm fetch (`buildHtfContext`) là async duy nhất gọi network; các hàm tính toán bên trong phải tách riêng để test không cần mock phức tạp nếu có thể.
- **Bài học từ lỗi ở task trước** ([xem review](../smc-liquidity-sweep-quality/review.md)): khi thêm gate loại bỏ signal, **TUYỆT ĐỐI không dùng `return` thoát cả hàm `buildSmcCandidatesAtIndex`** — hàm này xử lý tuần tự 3 setup (OB → Sweep → FVG) trong cùng 1 lần gọi, `return` sớm sẽ làm mất luôn các setup xử lý sau. Phải bọc phần logic cần bỏ qua trong `if (!bịLoại) { ... }`, không `return`.
- Khi HTF context là `null`/`undefined` (không fetch được, hoặc timeframe không có HTF cao hơn) → **fallback về hành vi cũ hoàn toàn** (không gate, dùng M15-local range) — đây là nguyên tắc graceful degradation nhất quán với toàn bộ pipeline hiện tại (ví dụ đã áp dụng y hệt cho premium/discount M15-local khi `pdZone === null`).
- Mỗi subtask phải thêm/sửa unit test tương ứng. Sau mỗi subtask: `npm run build && npm test` pass, không giảm test hiện có.
- Chạy tuần tự 01 → 02 → 03 → 04 (01 độc lập file mới; 02/03/04 đều sửa `smc-pipeline.ts` nên phải tuần tự tránh conflict).
- **Không đụng vào công thức SL/TP của setup Sweep** (đã biết yếu qua backtest thật, nhưng đó là vấn đề khác — không nằm trong scope task này, xem "Ghi chú riêng" bên dưới).

## Subtasks

| Subtask ID | Mô tả | Owner | Files chính | Dependency | Output kỳ vọng |
|---|---|---|---|---|---|
| [01-htf-context-module](01-htf-context-module/task.md) | Tạo `src/charts/smc/smc-htf-context.ts`: map entry timeframe → HTF timeframe, fetch HTF candles, tính bias + swings, trả về `HtfContext` | worker | `src/charts/smc/smc-htf-context.ts` (mới), `tests/charts/smc/smc-htf-context.test.ts` (mới) | none | Module độc lập, test đầy đủ, chưa wire vào pipeline |
| [02-htf-premium-discount](02-htf-premium-discount/task.md) | Wire `HtfContext` vào `buildSmcCandidatesAtIndex` (tham số optional), dùng HTF range cho premium/discount của setup OB thay vì M15-local khi có context | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | 01 | Setup OB dùng đúng HTF range khi có, fallback M15-local khi không có |
| [03-htf-directional-gate](03-htf-directional-gate/task.md) | Thêm gate cứng: loại setup (cả 3 loại) nếu hướng ngược HTF bias đã xác định | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | 02 | Setup ngược HTF bias không bao giờ xuất hiện trong candidates, setup null-bias hoặc cùng hướng không bị ảnh hưởng |
| [04-wire-production-backtest](04-wire-production-backtest/task.md) | Wire `buildHtfContext` vào `analyzeAllChartsSmc` (production) và `runSmcBacktest`/`smc-backtest-runner.ts` (backtest) | worker | `src/charts/smc/smc-pipeline.ts`, `src/charts/smc/smc-backtest.ts`, `src/charts/smc-backtest-runner.ts`, test tương ứng | 03 | Production và backtest đều dùng HTF context thật khi chạy, test cập nhật, build+test pass |

## Rủi ro & lưu ý

- **Gate cứng có thể giảm mạnh số lượng signal phát ra** (đúng chuẩn SMC là chấp nhận được — thà ít lệnh đúng hướng còn hơn nhiều lệnh ngược hướng bias lớn). Lead sẽ tự chạy backtest thật (H4 htf cho M15, hoặc D1 htf cho H4 tuỳ dữ liệu sẵn có) so sánh trước/sau sau khi cả 4 subtask xong — không chỉ dựa vào build/test pass.
- **Giới hạn đã biết của việc wire vào backtest** (subtask 04): `runSmcBacktest` chạy qua từng index lịch sử trong 1 vòng lặp đồng bộ, nhưng HTF context chỉ fetch **1 lần cho cả cặp** (giống cách `checkMultiTimeframeConfluence` hiện tại chỉ tính 1 lần ở production, không tính lại theo từng thời điểm lịch sử) — đây là xấp xỉ chấp nhận được, không phải bug, cần ghi rõ trong `assumptions` của `SmcBacktestReport` (subtask 04 sẽ hướng dẫn cụ thể).
- **Ghi chú riêng — KHÔNG thuộc scope task này**: backtest thật ở vòng review trước cho thấy setup `SMC_LIQUIDITY_SWEEP` có win rate âm ngay cả sau khi lọc theo depth/rejection/RVOL — nguyên nhân nhiều khả năng nằm ở công thức SL/TP của chính setup này, không phải do thiếu timeframe. Đây là vấn đề tách biệt, để lại làm task riêng sau nếu cần, không trộn vào đây.
- Sau khi cả 4 subtask được approve, Lead sẽ tự chạy lại backtest thật (dữ liệu sống, cùng phương pháp cache 1 lần đã dùng ở 2 task trước) để verify: (a) premium/discount giờ phản ánh đúng HTF, (b) gate hướng không làm hệ thống im lặng hoàn toàn (0 signal), (c) win rate tổng thể có cải thiện.
