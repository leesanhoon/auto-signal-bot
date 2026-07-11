# Plan — fix-binance-execution-review

## Mục tiêu

Fix 5 finding từ code review trên feature `binance-futures-execution-smc` (working tree
hiện tại, chưa commit), áp dụng cho CẢ HAI hệ SMC và Volman:

1. Dead retry khi dời SL breakeven thất bại → vị thế có thể chạy vĩnh viễn không SL.
2. `binance_execution_status = "failed"` ghi vô điều kiện dù lệnh đóng khẩn cấp fail →
   DB đóng record trong khi sàn còn vị thế sống không SL.
3. Guard cross-system fail-open khi `getPositionAmount` lỗi → có thể mở đè vị thế hệ khác.
4. DB ghi `stop_loss = entry` sai khi dời SL breakeven thất bại → sai lệch báo cáo/RR.
5. Duplication ~90% giữa `binance-execution-smc.ts` và `binance-execution-volman.ts`.

Chi tiết root cause + quyết định kiến trúc đầy đủ nằm trong
`tasks/fix-binance-execution-review/context.md` — đọc file đó trước khi thực thi bất kỳ
subtask nào bên dưới.

## Quyết định thứ tự: fix trước, dedup sau

Đã cân nhắc 2 phương án:

- **A. Dedup trước, fix 1 lần:** rủi ro cao — phải viết module chung tham số hoá
  (`systemLabel`, `calculateRiskRewardPlan`, `saveBinanceExecutionDetails`,
  `updateBinanceSlOrder`, `riskUsdt?`) VÀ đồng thời sửa 4 finding an toàn nghiêm trọng
  trong cùng 1 lần đổi — khó review, khó cô lập lỗi nếu regression xảy ra, và trì hoãn
  các fix an toàn (Finding 1-4 có thể gây mất tiền thật) chờ refactor xong.
- **B. Fix 2 hệ song song trước, dedup sau (ĐÃ CHỌN):** 2 file gần như giống hệt nhau
  (đã verify từng dòng) nên áp fix giống nhau vào 2 file độc lập không tốn thêm effort
  đáng kể so với A, nhưng tách rủi ro rõ ràng: fix an toàn merge được ngay, dedup là
  refactor thuần tuý (không đổi behavior) làm sau khi đã có test coverage đầy đủ cho
  behavior mới từ bước fix — dedup lúc đó chỉ cần verify test cũ vẫn pass, an toàn hơn
  nhiều.

**Trade-off chấp nhận:** tốn công sửa 2 lần cho 4 finding an toàn (Finding 1-4), nhưng vì
2 file gần như giống hệt nên chi phí thực tế thấp, đổi lại rủi ro thấp hơn đáng kể và fix
an toàn không bị block bởi refactor lớn.

## Kiến trúc quyết định chính (tóm tắt — xem context.md để biết đầy đủ)

- **Finding 1 + 4:** không thêm cột DB. Đổi 2 nhánh fail của khối dời SL breakeven trong
  `reconcileBinancePosition` để trả `managementAction: "NONE"`, `tp1Reached: false`,
  `partialClosePercent: 0` thay vì `"PARTIAL_TP1"`/`true`/`50` — khiến
  `deriveManagementPatch` rơi vào fallback `patch: null` (không ghi DB sai), đồng thời
  giữ `tp1ClosedPercent` DB = 0 để guard `alreadyPartial` mở lại retry tự nhiên ở cycle
  sau.
- **Finding 2:** thêm status `"close_failed"` (giá trị text mới, không cần migration) —
  chỉ ghi `"failed"` khi lệnh đóng khẩn cấp thành công; `"close_failed"` khi đóng khẩn
  cấp cũng fail. `reconcileBinancePosition` thêm nhánh xử lý `"close_failed"`: verify qua
  `getPositionAmount` trước khi quyết định CLOSE hay tiếp tục HOLD + cảnh báo.
- **Finding 3:** guard fail-closed — `getPositionAmount` lỗi thì bỏ entry + log + alert
  Telegram, không mở lệnh thật.
- **Finding phụ #1 (orphan order):** thêm log lỗi khi `cancelOrder` fail trong nhánh dọn
  lệnh còn lại (SL-filled/TP2-filled), không đổi decision trả về.
- **Findings phụ #2, #3:** KHÔNG fix trong task này — lý do nêu trong context.md phần
  "Findings phụ #2, #3" (trade-off/rủi ro cao hơn lợi ích, hoặc đã có comment giải thích
  quyết định có chủ đích).

## File bị ảnh hưởng

- `src/charts/binance-execution-smc.ts` (subtask 01)
- `src/charts/positions-repository-smc.ts` (subtask 01, chỉ đổi type)
- `tests/charts/binance-execution-smc.test.ts` (subtask 01)
- `tests/charts/positions-repository-smc.test.ts` (subtask 01, nếu cần test type mới)
- `src/charts/binance-execution-volman.ts` (subtask 02)
- `src/charts/positions-repository-volman.ts` (subtask 02, chỉ đổi type)
- `tests/charts/binance-execution-volman.test.ts` (subtask 02, tạo mới nếu chưa có)
- `tests/charts/positions-repository-volman.test.ts` (subtask 02, nếu cần)
- Sau khi 01+02 xong: `src/charts/binance-execution-smc.ts`,
  `src/charts/binance-execution-volman.ts`, file module chung mới (subtask 03)

## Testing strategy

- Mỗi subtask 01/02 phải bổ sung/mở rộng test file tương ứng, cover:
  - Finding 1+4: TP1 filled, huỷ SL cũ fail → `HOLD`, `patch` không ghi tp1ClosedPercent
    (verify qua gọi `deriveManagementPatch` thực hoặc verify `reconcileBinancePosition`
    trả `tp1Reached: false`, `managementAction: "NONE"`, `newStopLoss: null`).
  - Finding 1+4: TP1 filled, huỷ SL cũ OK nhưng đặt SL mới fail 3 lần → cùng assertion.
  - Finding 1+4: TP1 filled, cả 2 bước OK → vẫn trả `managementAction: "PARTIAL_TP1"`,
    `tp1Reached: true` như cũ (regression test, không được đổi hành vi thành công).
  - Finding 1: retry — gọi `reconcileBinancePosition` 2 lần liên tiếp mô phỏng 1 fail + 1
    success, xác nhận lần 2 vẫn vào được nhánh dời SL (không bị `alreadyPartial` chặn).
  - Finding 2: `openBinanceFuturesPosition` — đặt SL/TP fail + `closeResult` fail →
    `saveBinanceExecutionDetails` được gọi với `binanceExecutionStatus: "close_failed"`
    (không phải `"failed"`).
  - Finding 2: `openBinanceFuturesPosition` — đặt SL/TP fail + `closeResult` OK → vẫn
    `"failed"` như cũ (regression test).
  - Finding 2: `reconcileBinancePosition` với `binanceExecutionStatus: "close_failed"` +
    `getPositionAmount` trả 0 → `CLOSE`; trả khác 0 → `HOLD`; trả Error → `HOLD`.
  - Finding 3: `getPositionAmount` trả Error trong `openBinanceFuturesPosition` →
    `placeMarketOrder` KHÔNG được gọi, có gửi alert Telegram.
  - Finding phụ #1: `cancelOrder` fail trong nhánh SL-filled/TP2-filled → không throw,
    decision vẫn trả đúng (STOP/CLOSE), có log lỗi (verify qua spy nếu cần, không bắt
    buộc assert log).
- Verify command bắt buộc cho mỗi subtask: `npm run build` và
  `npx vitest run <đúng test file(s) bị sửa>`.

## Subtasks

| id | owner | files được phép sửa | phụ thuộc | output | verify |
|---|---|---|---|---|---|
| `01-fix-smc-execution-logic` | worker | `src/charts/binance-execution-smc.ts`, `src/charts/positions-repository-smc.ts`, `tests/charts/binance-execution-smc.test.ts`, `tests/charts/positions-repository-smc.test.ts` | không | `tasks/fix-binance-execution-review/01-fix-smc-execution-logic/result.md` | `npm run build`; `npx vitest run tests/charts/binance-execution-smc.test.ts tests/charts/positions-repository-smc.test.ts` |
| `02-fix-volman-execution-logic` | worker | `src/charts/binance-execution-volman.ts`, `src/charts/positions-repository-volman.ts`, `tests/charts/binance-execution-volman.test.ts`, `tests/charts/positions-repository-volman.test.ts` | không (parallel với 01, không đụng file chung) | `tasks/fix-binance-execution-review/02-fix-volman-execution-logic/result.md` | `npm run build`; `npx vitest run tests/charts/binance-execution-volman.test.ts tests/charts/positions-repository-volman.test.ts` |
| `03-dedup-shared-execution-module` | worker | `src/charts/binance-execution-shared.ts` (mới), `src/charts/binance-execution-smc.ts`, `src/charts/binance-execution-volman.ts`, `tests/charts/binance-execution-smc.test.ts`, `tests/charts/binance-execution-volman.test.ts` | `01`, `02` (bắt buộc cả 2 done trước) | `tasks/fix-binance-execution-review/03-dedup-shared-execution-module/result.md` | `npm run build`; `npx vitest run tests/charts/binance-execution-smc.test.ts tests/charts/binance-execution-volman.test.ts` |
| `04-fix-eager-mock-regression` | worker | `src/charts/binance-execution-smc.ts`, `src/charts/binance-execution-volman.ts` | `03` (đã done — sửa tiếp trên kết quả dedup) | `tasks/fix-binance-execution-review/04-fix-eager-mock-regression/result.md` | `npm run build`; `npx vitest run` (BẮT BUỘC full suite, không chỉ file trong scope) |

**Parallelizable:** `01` và `02` có thể chạy song song (2 worker session khác nhau, không
đụng file chung). `03` PHẢI chờ cả `01` và `02` done và review APPROVED mới bắt đầu (cần
logic đã ổn định để refactor an toàn). `04` chạy sau `03`, không parallel với gì (2 file
độc lập nhưng đủ nhỏ để 1 worker làm cả 2 trong 1 subtask).

## Regression phát hiện sau khi 01/02/03 đã done (bổ sung subtask 04)

Khi Lead chạy FULL test suite lần cuối trước commit (`npx vitest run` toàn bộ, không giới
hạn theo file trong scope từng subtask), phát hiện 2 file test tiền-tồn tại
(`tests/charts/smc-index.test.ts`: 17/17 fail; `tests/charts/index.test.ts`: crash tại
import, 14 test không chạy được) bị vỡ bởi thay đổi ở subtask `03`.

**Root cause (đã tự verify bằng cách đọc code + chạy lại `npm run build` và
`npx vitest run` — tái hiện đúng "2 failed | 74 passed (76)" file, "17 failed | 796 passed
(813)" test như báo cáo):**

Ở `src/charts/binance-execution-smc.ts` dòng 8-22 và
`src/charts/binance-execution-volman.ts` dòng 9-25, object `config` được dựng ở
MODULE TOP-LEVEL bằng object-shorthand (`calculateRiskRewardPlan,` v.v.). Cú pháp này đọc
giá trị của named-import binding NGAY LÚC MODULE ĐƯỢC IMPORT (eager). Khi Vitest mock ESM
namespace của `position-engine-smc.js` / `position-engine-volman.js` mà không cung cấp đủ
named export `calculateRiskRewardPlan` (như 2 file test tiền-tồn tại đang làm), việc đọc
eager này throw `"No export is defined on the mock"` ngay lúc import — bất kể hàm có được
GỌI hay không.

Trước dedup (subtask 03), các identifier này chỉ được đọc BÊN TRONG THÂN HÀM
`openBinanceFuturesPosition` (lazy — chỉ đọc lúc hàm thật sự chạy runtime), nên không có
vấn đề.

**2 phương án đã cân nhắc:**

- **A. Đổi 3 field trong `config` (cả 2 file `binance-execution-{smc,volman}.ts`) từ
  object-shorthand (eager) sang arrow-function thunk (lazy) — ĐÃ CHỌN.** Chỉ sửa trong
  phạm vi 2 file đã APPROVED ở subtask 03 (không mở rộng scope sang test file tiền-tồn
  tại). Khôi phục đúng hành vi lazy-read như code trước khi dedup — không phải
  "workaround để né test", mà là sửa lại điểm hồi quy thực sự do dedup gây ra: đọc
  named-import binding ở top-level module là fragile với live-binding/mock semantics của
  ESM, bất kể có test hay không.
- **B. Sửa mock trong `tests/charts/smc-index.test.ts` (dòng 103-110) và
  `tests/charts/index.test.ts`** để bổ sung đủ named export bị thiếu
  (`calculateRiskRewardPlan`, `saveBinanceExecutionDetails`, `updateBinanceSlOrder`).
  Loại bỏ được vì: (1) mở rộng phạm vi ra 2 file test tiền-tồn tại ngoài scope subtask
  01-03, cần điều tra kỹ toàn bộ mock setup của 2 file (không chỉ 3-5 dòng bị báo lỗi) để
  tránh side-effect khi mock thêm hàm thật sẽ chạy unmocked; (2) không khắc phục gốc rễ —
  nếu sau này có thêm code mới dùng lại pattern object-shorthand top-level tương tự, lỗi
  sẽ tái diễn ở chỗ khác; (3) rủi ro cao hơn cho 1 subtask nhỏ giao cho Worker Haiku vốn
  không được phép "improvise" ngoài instruction rõ ràng.

**Bài học cho Testing strategy (áp dụng từ subtask 04 trở đi và cho các task tương lai):**
verify command của MỌI subtask liên quan tới thay đổi cấu trúc export/import/module-level
side-effect (không riêng bug logic thuần tuý) PHẢI bao gồm `npx vitest run` KHÔNG giới hạn
file, không chỉ chạy đúng file test trong phạm vi subtask đó — vì lỗi loại
"crash tại import time" chỉ lộ ra khi 1 module bị import bởi 1 entrypoint khác ngoài phạm
vi test file được sửa trực tiếp. Test file trong phạm vi subtask KHÔNG đủ để phát hiện loại
lỗi này vì bản thân nó không import qua entrypoint bị ảnh hưởng.

## Rủi ro cần lưu ý cho Lead khi review

- Regression: đảm bảo nhánh THÀNH CÔNG của dời SL breakeven (đặt lại SL mới OK) vẫn giữ
  nguyên `managementAction: "PARTIAL_TP1"` / `tp1Reached: true` — không được đổi nhầm
  sang nhánh fail.
- `partialClosePercent: 0` ở nhánh fail phải không ảnh hưởng gì vì `deriveManagementPatch`
  không đọc field này khi rơi vào fallback `patch: null` — verify code path thực tế,
  không chỉ đọc comment.
- Type `binanceExecutionStatus` thêm `"close_failed"` phải cập nhật ĐỦ mọi nơi dùng union
  type này (cả `OpenPosition` và `BinanceExecutionDetails` trong `positions-repository-*.ts`)
  — thiếu 1 chỗ sẽ gây lỗi TypeScript build.
- `03` không được đổi behavior — mọi test đã viết ở `01`/`02` phải pass nguyên vẹn sau
  dedup (chạy lại đúng test file, không được sửa test để "cho pass").
