# Review: Task 07 — swing-trailing-sl-live

## Verdict: ĐÃ ĐƯỢC LEAD LÀM LẠI HOÀN TOÀN (2026-07-12, theo yêu cầu user "triển khai task 07")

Lead viết lại đúng theo task.md thay vì giao lại Worker, vì đây là vấn đề an toàn vốn cần ưu tiên:

- Bỏ hoàn toàn `getHigherTimeframe`/`calculateSwingSupportLevel` (khung cao hơn, 1 lần duy nhất,
  có thể nới lỏng SL) — thay bằng `calculateSwingTrailLevel` (cùng timeframe vị thế, đúng công
  thức `scanOutcomeSwingTrail`).
- Nhánh TP1-lần-đầu khôi phục nguyên bản (breakeven đơn giản, không đổi).
- Thêm nhánh MỚI: khi `alreadyPartial===true` (đã qua TP1), mỗi cycle `reconcileBinancePosition`
  tính lại swing low/high trên `position.primaryTimeframe` (cột thêm ở Task 01), lookback 3 nến
  (cấu hình qua `POSITION_SWING_TRAIL_LOOKBACK`) — **chỉ áp dụng khi siết chặt hơn SL hiện tại**
  (`position.stopLoss`), không bao giờ nới lỏng. Dùng lại đúng pattern hủy-SL-cũ/đặt-SL-mới/retry
  3 lần/alert khẩn cấp đã có.
- Chỉ chạy cho vị thế có `primaryTimeframe` (hiện là Volman) — SMC (không có cột này) tự động bỏ
  qua nhánh, giữ nguyên hành vi breakeven cố định như trước.
- **Fix thêm 1 bug pre-existing phát hiện khi implement**: `deriveManagementPatch` (Volman) kiểm
  tra `tp1Reached` TRƯỚC `managementAction === "TRAIL_SL"` — khiến nhánh `TRAIL_SL` không bao giờ
  chạy tới được (mọi decision sau TP1 đều có `tp1Reached=true`, luôn bị nhánh PARTIAL_TP1 chặn
  trước). Đã đổi thứ tự kiểm tra. (Lưu ý: `position-engine-smc.ts` có cùng lỗi thứ tự này nhưng
  KHÔNG sửa — ngoài scope Task 07, SMC chưa dùng TRAIL_SL nên chưa cấp thiết, cần task riêng nếu
  muốn bật cho SMC sau này.)
- Thêm test: so sánh công thức `calculateSwingTrailLevel` với đúng công thức
  `scanOutcomeSwingTrail` trên cùng dữ liệu (bắt buộc theo task.md), + test tighten-only, +
  test bỏ qua khi không có `primaryTimeframe`, + test cho cả LONG/SHORT.
- `npx tsc --noEmit` sạch, `npx vitest run` 907/907 pass (900 cũ + 7 test mới).

## Nội dung review gốc (trước khi Lead làm lại) — giữ lại để tham khảo

Không có `result.md`. Đã đọc trực tiếp diff commit `520066a`.

## Tóm tắt: Worker làm ra một thứ KHÁC HẲN so với task.md yêu cầu, và có 1 lỗi an toàn thật

Task.md yêu cầu: sau khi TP1 khớp, **mỗi cycle check-open-trades** tính lại swing low/high trên
**cùng timeframe của vị thế**, lookback 3 nến (đúng công thức `scanOutcomeSwingTrail` trong
`setup-backtest.ts` để backtest và live nhất quán), chỉ siết SL chặt hơn, không bao giờ nới lỏng.

Worker đã làm: thêm 1 lần tính "swing support" **duy nhất tại đúng thời điểm TP1 vừa khớp** (không
lặp lại ở các cycle sau), dùng dữ liệu từ **khung thời gian CAO HƠN** (M15→H1, H1→H4...), lấy
10 nến gần nhất, tìm low/high thấp/cao nhất làm SL mới thay cho breakeven.

## Vấn đề 1 (nghiêm trọng nhất) — SL mới có thể LỎNG HƠN breakeven, ngược hoàn toàn ý đồ bảo toàn vốn

Đọc `calculateSwingSupportLevel`:

```ts
if (direction === "LONG") {
  let swingLow = ohlcData[0].low;
  for (const candle of ohlcData) { if (candle.low < swingLow) swingLow = candle.low; }
  if (swingLow >= entryPrice) return null; // fallback breakeven
  return swingLow; // <-- chỉ dùng khi swingLow < entryPrice
}
```

Hàm này **chỉ trả về 1 giá trị hợp lệ khi `swingLow < entryPrice`** — tức đúng lúc nó "hoạt động",
SL mới sẽ nằm **DƯỚI** giá entry (đối với LONG), tức **LỎNG HƠN breakeven**, không phải chặt hơn.

Trước khi có thay đổi này, hành vi cũ (đã đúng, đã hoạt động) là: TP1 khớp → SL dời về breakeven
(= entry) → bảo toàn vốn, không thể lỗ thêm. Sau thay đổi này: TP1 khớp → nếu tìm được swing low
dưới entry (rất thường xảy ra, vì TP1 thường chỉ cách entry 1-1.5x risk, còn nến của khung thời
gian CAO HƠN dao động biên độ lớn hơn nhiều) → **SL bị đặt THẤP HƠN entry, tức vị thế có thể lỗ
trở lại dù đã ăn TP1** — hoàn toàn ngược lại nguyên tắc "chỉ siết chặt hơn, không nới lỏng" mà
task.md yêu cầu, và ngược cả tinh thần bảo toàn vốn của Bob Volman.

Đây không phải rủi ro lý thuyết — với setup R:R thấp (đã biết từ trước, RB/ARB blend ~1.25R), TP1
cách entry rất gần, trong khi 10 nến của khung cao hơn (ví dụ M15→H1: 10 nến H1 = ~10 tiếng dữ
liệu) gần như chắc chắn có ít nhất 1 đáy thấp hơn entry — nghĩa là **trường hợp "swing_support"
kích hoạt sẽ là trường hợp PHỔ BIẾN, không phải hiếm**.

## Vấn đề 2 — Không phải "trailing" thật, chỉ là 1 lần thay thế cho breakeven

Code được chèn vào ĐÚNG nhánh xử lý "TP1 vừa khớp lần đầu" (`!alreadyPartial && ... FILLED`) — nhánh
này chỉ chạy DUY NHẤT 1 LẦN trong vòng đời vị thế. Sau khi SL được đặt (dù là swing_support hay
breakeven), **không có cơ chế nào tính lại/siết thêm ở các cycle check-open-trades tiếp theo**.
Đây hoàn toàn không phải "trailing theo cấu trúc" như Bob Volman làm (dời SL liên tục siết dần theo
đáy/đỉnh mới) — chỉ là đổi công thức của 1 lần dời SL duy nhất. Không đạt yêu cầu cốt lõi của
task 07.

## Vấn đề 3 — Dùng khung thời gian khác hẳn công thức tham chiếu trong backtest

Task.md yêu cầu bám sát `scanOutcomeSwingTrail` (cùng timeframe, lookback 3 nến, tính lại MỖI
cycle) để backtest và live nhất quán — đúng bài học đã rút ra trong dự án này trước đó ("backtest
không đại diện live"). Worker tự sáng tác công thức khác hẳn (timeframe cao hơn, 10 nến, tính 1
lần) — không có cách nào so sánh/verify công thức này với backtest, vì backtest không hề có khái
niệm "khung cao hơn". Nếu chạy backtest với `exitMode=swing_trail` và so với live thật, 2 kết quả
sẽ hoàn toàn không liên quan đến nhau.

## Vấn đề 4 — Đọc `process.env.CHART_PRIMARY_TIMEFRAME` trực tiếp trong module dùng chung SMC+Volman

```ts
const primaryTimeframe = (process.env.CHART_PRIMARY_TIMEFRAME as ChartTimeframe | undefined) || "H4";
```

Đây là code trong `binance-execution-shared.ts` — module DÙNG CHUNG cho cả SMC và Volman, và (theo
đúng mục tiêu toàn bộ plan này) sẽ được chạy bởi **3 process riêng biệt** (M15/H1/H4, xem Task 05)
với `CHART_PRIMARY_TIMEFRAME` khác nhau cho mỗi process. Đọc thẳng biến môi trường của process hiện
tại thay vì dùng `position.primaryTimeframe` (cột đã thêm ở Task 01, chính xác để biết vị thế NÀY
thuộc timeframe nào) là sai — nếu sau này có tình huống 1 job xử lý vị thế không thuộc timeframe
của chính nó (race condition, hoặc migrate dữ liệu cũ), code sẽ suy luận SAI timeframe của vị thế.

## Vấn đề 5 — Không có test nào cho toàn bộ logic mới

`git show --stat` xác nhận commit chỉ sửa 1 file (`binance-execution-shared.ts`), không đụng bất
kỳ file test nào. Task.md yêu cầu rõ: test verify công thức đúng, test verify không gọi API dời SL
khi swing không tốt hơn, và ĐẶC BIỆT yêu cầu 1 test so sánh trực tiếp công thức live vs
`scanOutcomeSwingTrail` trên cùng bộ dữ liệu — không có test nào trong số này được viết.

## Yêu cầu làm lại (toàn bộ, không phải vá nhỏ)

1. Bỏ hoàn toàn cách tiếp cận "khung cao hơn + 1 lần duy nhất tại TP1". Viết lại theo đúng task.md:
   - Dùng OHLC **cùng timeframe với vị thế** (`position.primaryTimeframe` từ Task 01, KHÔNG đọc
     `process.env` trong file dùng chung).
   - Tính swing low/high trên **lookback 3 nến gần nhất đã đóng** (mặc định, có thể cấu hình qua
     env `POSITION_SWING_TRAIL_LOOKBACK`), giống hệt công thức `scanOutcomeSwingTrail`.
   - Áp dụng **mỗi cycle reconcileBinancePosition** khi `alreadyPartial === true` (không chỉ lần
     đầu TP1 khớp) — xem lại task.md mục 2 để implement đúng nhánh mới, KHÔNG thay thế nhánh xử lý
     TP1-lần-đầu hiện có (giữ nguyên breakeven move đầu tiên, thêm nhánh MỚI cho các cycle sau).
   - **Bắt buộc**: SL mới chỉ được áp dụng khi nó SIẾT CHẶT HƠN SL/breakeven hiện tại
     (`newSwingStop > currentStop` cho LONG, `newSwingStop < currentStop` cho SHORT) — không bao
     giờ được phép lỏng hơn breakeven đã đặt.
2. Viết test so sánh công thức live vs `scanOutcomeSwingTrail` trên cùng dữ liệu giả lập — bắt buộc
   theo task.md, chưa có sẽ không được coi là hoàn thành.
3. Verify lại toàn bộ bằng `npx tsc --noEmit` + `npx vitest run` sau khi sửa.

## Trạng thái

**Task 07 chưa đạt, cần Worker làm lại từ đầu theo đúng task.md** — đây là lỗi nghiêm trọng nhất
trong 4 task vừa review (rủi ro thật: vị thế có thể bị nới lỏng SL xuống dưới breakeven ngay sau
khi vừa ăn TP1, ngược hoàn toàn mục đích bảo toàn vốn). Lead KHÔNG tự vá task này (khác Task 01/02
là các lỗi có thể vá bằng 1 thao tác rõ ràng, đơn nghĩa) vì đây là thiết kế sai cần viết lại có chủ
đích, không phải lỗi kỹ thuật đơn thuần.
