# Task 01 — Sửa lỗi đã xác nhận trong result.md của round2/02 (HIGH)

## Lỗi cụ thể

`tasks/fix-review-round2-findings/02-fix-irb-fallback-test-mock/result.md`
hiện ghi:
```
- The mock-based IRB fallback test was implemented initially, but it was
  later replaced by the real-data fixture in round 6.
```
**SAI.** Sự thật (đã xác nhận qua nội dung review trực tiếp trong phiên làm
việc — KHÔNG phải suy đoán từ code hiện tại): việc thay test mock
(`vi.mock("../../src/charts/indicators.js", ...)`) bằng test dùng dữ liệu
nến THẬT đã xảy ra như 1 phần của chính round 2 (subtask
`02-fix-irb-fallback-test-mock`) — được xác nhận khi review diff của round 3
(lúc đó review confirm: "tests/charts/irb-fallback.test.ts — this diff DID
replace the mock-based test flagged in the prior review round with a
real-data test... properly addresses the prior finding"). Round 6's task 03
(`properly-test-irb-fallback-case-a`) là 1 việc HOÀN TOÀN KHÁC — kiểm tra
xem `checkShiftedFallback` có làm hẹp lại phạm vi chấp nhận signal hay
không, KHÔNG liên quan gì tới việc mock vs dữ liệu thật.

## Yêu cầu

Sửa lại `tasks/fix-review-round2-findings/02-fix-irb-fallback-test-mock/result.md`
thành nội dung chính xác, ví dụ:
```
# Result

- Test mock-based cho IRB fallback (`vi.mock` trên `detectCompression`) đã
  được thay bằng test dùng dữ liệu nến thật ngay trong round 2 (subtask
  này) — không phải ở round sau.
- Xác nhận: diff của round 3 (review sau đó) đã ghi nhận rõ ràng file test
  này KHÔNG còn mock, dùng candle array thật, gọi `detectIrb` trực tiếp.
- File hiện tại: `tests/charts/setups/irb-fallback.test.ts` (đã di chuyển vị
  trí ở round 5, nội dung real-data giữ nguyên từ round 2).
```
(Điều chỉnh câu chữ cho tự nhiên, miễn giữ đúng sự thật trên.)

## KHÔNG làm

- Không sửa code.
- Không đổi các phần khác của `result.md` này (chỉ sửa đúng câu bị sai).

## Ghi kết quả

`result.md` trong `tasks/fix-backfill-accuracy/01-fix-known-inaccuracy/`:
xác nhận đã sửa xong.
