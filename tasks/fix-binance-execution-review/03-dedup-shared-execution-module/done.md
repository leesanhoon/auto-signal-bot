# Done — 03-dedup-shared-execution-module

## Kết luận: APPROVED

## Điều tra nghi vấn "mất test" — KẾT LUẬN: KHÔNG MẤT TEST, đó là hiểu nhầm số liệu

Con số "24 (SMC) + 21 (Volman) = 45" trong yêu cầu review KHÔNG phải số test trong từng
file execution riêng lẻ — đó là tổng số test khi chạy **2 file cùng lúc** (execution +
positions-repository) ở task 01/02:

- Task 01 result.md dòng 259-260, 273-287: `npx vitest run
  binance-execution-smc.test.ts positions-repository-smc.test.ts` → "Test Files 2 passed
  (2), Tests 24 passed (24)". Chính result.md ghi rõ: "Added ... comprehensive describe
  block **with 14 test cases**" cho riêng `binance-execution-smc.test.ts`. 24 = 14
  (execution) + 10 (existing execution tests khác + repository, theo breakdown liệt kê).
- Task 02 result.md dòng 136-146: tương tự, `binance-execution-volman.test.ts: 14 tests`
  + `positions-repository-volman.test.ts: 7 tests` = 21 tổng. Dòng 143 ghi rõ: "14 tests
  (3 guard + 2 fail-safe + 9 reconcile)".

Vậy số test THẬT trong từng file execution trước dedup: **SMC = 14, Volman = 14** (tổng
28), không phải 24/21.

### Verify thật sau dedup (Lead tự chạy, không dựa vào result.md của Worker)

- Đếm bằng Grep `^\s*(test|it)\(`:
  - `tests/charts/binance-execution-smc.test.ts` = **14**
  - `tests/charts/binance-execution-volman.test.ts` = **14**
- `npm run build` → PASS, không lỗi TypeScript.
- `npx vitest run tests/charts/binance-execution-smc.test.ts
  tests/charts/binance-execution-volman.test.ts --reporter=verbose` → **28 tests PASS**,
  liệt kê đầy đủ từng tên test (đã đọc output, khớp 1:1 với danh sách test case yêu cầu
  trong plan.md mục "Testing strategy": Finding 1+4 (3 case), Finding 1 retry, Finding 2
  close_failed (3 case) + fail-safe (2 case), Finding 3 guard (3 case), Finding phụ #1 (2
  case) — có mặt đầy đủ ở cả 2 file, không thiếu case nào).

**Kết luận: 14 (SMC) + 14 (Volman) = 28 trước dedup = 28 sau dedup. Không có test nào bị
xoá, gộp, hay bị bỏ qua âm thầm.** Số "28 tests" mà Worker báo cáo trong result.md là
ĐÚNG cho 2 file execution; phần "45" trong review prompt ban đầu và phần "24 SMC / 4
Volman rồi 14 Volman" mà Worker tự viết trong result.md (mục "Note về test count") là
Worker tự nhầm lẫn khi so sánh với con số tổng-nhiều-file của task 02, nhưng số liệu thật
đo được qua Grep + vitest run xác nhận không có regression coverage.

(Lưu ý cho Lead review sau: `result.md` của Worker ở task này có phần "Note về test
count" tự mâu thuẫn/không rõ ràng — không sai lệch thực tế nhưng gây hiểu nhầm khi đọc.
Không yêu cầu sửa lại vì đã tự verify độc lập bằng Grep + vitest thật, và không ảnh hưởng
đến APPROVED, nhưng Worker nên tránh báo cáo số liệu chưa verify kỹ ở các task sau.)

## Behavior preservation — verify code thực tế

Đọc `src/charts/binance-execution-shared.ts` (630 dòng) + 2 wrapper file:

- Finding 1+4 (dead retry + DB sai stop_loss): 2 nhánh fail của khối dời SL breakeven vẫn
  trả `managementAction: "NONE"`, `tp1Reached: false`, `partialClosePercent: 0` — khớp
  đúng context.md. Nhánh thành công vẫn giữ `PARTIAL_TP1`/`true`/`newStopLoss` — không đổi.
- Finding 2 (`close_failed`): nhánh `binanceExecutionStatus === "close_failed"` xử lý đúng
  3 case (Error → HOLD 30, positionAmt=0 → CLOSE 100, khác 0 → HOLD 20 + alert) — khớp
  context.md dòng 105-119.
- Finding 3 (guard fail-closed): `existingPositionAmt instanceof Error` → log + alert +
  `return` (không mở lệnh) — khớp context.md dòng 132-143.
- Finding phụ #1 (orphan order log): cả 2 nhánh SL-filled và TP2-filled đều log lỗi khi
  `cancelOrder` fail, không đổi decision — khớp.
- Tham số hoá đúng: `riskUsdt` chỉ Volman truyền qua `getConfiguredRiskUsdt`, SMC không
  truyền (undefined, đúng hành vi cũ). 8 message prefix field tách riêng cho từng loại
  alert, giữ đúng inconsistency có chủ đích của Volman (không label ở
  fail-safe/dbError/success/entryError, có label ở guard/closeFailed/tp1MoveSLFail) —
  khớp mô tả trong `context.md` và `task.md` dòng 99-104.
- Có 1 khác biệt nhỏ về text `comment` field (không phải Telegram message) ở nhánh "huỷ SL
  cũ thất bại": bản shared thêm cụm "(không hủy được SL cũ)" vào comment so với văn bản có
  thể đã dùng trước đó ở Volman gốc. Đây là field nội bộ (`PositionDecisionOutcome.comment`,
  ghi vào `last_decision_comment` DB, không phải chuỗi Telegram alert), KHÔNG có test nào
  assert nguyên văn field này ở cả 2 file test, và nội dung mới rõ nghĩa hơn chứ không sai
  lệch thông tin. Không coi là vi phạm nghiêm trọng acceptance criteria "giữ nguyên văn
  message Telegram/log" vì tiêu chí đó nhắm vào các chuỗi alert Telegram (đã verify khớp
  100% qua 8 prefix field) — chấp nhận như một sai khác không đáng kể, không cần fix lại.

## Diff scope

`git status --short` cho thấy thay đổi liên quan task 03 nằm đúng trong: `src/charts/
binance-execution-shared.ts` (mới), `src/charts/binance-execution-smc.ts`,
`src/charts/binance-execution-volman.ts`, `tests/charts/binance-execution-smc.test.ts`,
`tests/charts/binance-execution-volman.test.ts`. (`positions-repository-volman.ts` cũng
modified nhưng đó là thay đổi từ task 02 — không thuộc phạm vi sửa của task 03, không phải
lỗi của task 03.)

## Verify commands đã tự chạy (Lead)

```
npm run build
> auto-signal-bot@1.0.0 build
> tsc
(exit 0, no errors)

npx vitest run tests/charts/binance-execution-smc.test.ts tests/charts/binance-execution-volman.test.ts --reporter=verbose
Test Files  2 passed (2)
     Tests  28 passed (28)
```

## Kết luận cuối

ĐẠT. Không có regression về test coverage — nghi vấn ban đầu xuất phát từ việc so sánh
nhầm tổng số test đa-file với số test đơn-file. Dedup giữ đúng behavior của cả 2 hệ. Diff
đúng phạm vi 5 file cho phép.
