# Done — fix-binance-execution-review (final consolidated review)

## Kết luận: ĐẠT

Review độc lập toàn bộ task ở cấp root sau khi cả 4 subtask đã có `done.md` riêng. Đọc
lại code thực tế (không tin số liệu cũ), tự chạy build + full test suite, đối chiếu diff
scope với `plan.md`/`context.md`.

## 1. Đối chiếu 5 finding gốc trên code hiện tại

Đọc trực tiếp `src/charts/binance-execution-shared.ts` (module dùng chung, nơi toàn bộ
logic thực tế sống sau dedup ở subtask 03) và 2 wrapper `binance-execution-smc.ts` /
`binance-execution-volman.ts`.

- **Finding 1 + 4 (dead retry + DB ghi sai `stop_loss=entry`)** —
  `binance-execution-shared.ts:549-562` (nhánh không huỷ được SL cũ) và `:582-595` (nhánh
  đặt SL mới fail 3 lần) đều trả `managementAction: "NONE"`, `tp1Reached: false`,
  `partialClosePercent: 0`, `newStopLoss: null` — đúng quyết định trong context.md, khiến
  `deriveManagementPatch` rơi vào fallback `patch: null`, không ghi DB sai, đồng thời giữ
  `tp1ClosedPercent=0` để guard `!alreadyPartial` (`:513`) mở lại cho lần check sau. Nhánh
  THÀNH CÔNG (`:598-611`) giữ nguyên `managementAction: "PARTIAL_TP1"`, `tp1Reached: true`,
  `newStopLoss: String(bePrice)` — không bị đổi nhầm. FIXED, đúng thiết kế.
- **Finding 2 (ghi `"failed"` vô điều kiện dù đóng khẩn cấp cũng fail)** —
  `:276-277` tính `executionStatusAfterFailSafe = closeResult instanceof Error ?
  "close_failed" : "failed"`. `reconcileBinancePosition` có nhánh riêng cho
  `"close_failed"` đặt TRƯỚC nhánh `"failed"` (`:369-420`), verify qua `getPositionAmount`
  trước khi CLOSE/HOLD, đúng 3 case: Error→HOLD conf 30, amt=0→CLOSE conf 100, amt!=0→HOLD
  conf 20 + `sendMessage` cảnh báo khẩn cấp lặp lại. FIXED.
- **Finding 3 (fail-open guard cross-system khi `getPositionAmount` lỗi)** —
  `:145-155` check `existingPositionAmt instanceof Error` TRƯỚC nhánh check `!== 0`, log
  error + `sendMessage` + `return` (không đặt lệnh thật) — fail-closed đúng yêu cầu. FIXED.
- **Finding 4** — gộp chung với Finding 1, xem trên. FIXED.
- **Duplication ~90% giữa smc/volman** — `binance-execution-shared.ts` chứa toàn bộ logic
  dùng chung qua `createOpenBinanceFuturesPosition` / `createReconcileBinancePosition`
  (factory nhận `config` tham số hoá). `binance-execution-smc.ts` còn 33 dòng,
  `binance-execution-volman.ts` còn 36 dòng, chỉ chứa config khác biệt (label, prefix
  Telegram, wiring import). Duplication đã loại bỏ. FIXED.
- **Finding phụ #1 (orphan reduceOnly order không log lỗi)** — `:447-465` (SL-filled, huỷ
  TP1/TP2) và `:488-495` (TP2-filled, huỷ SL) đều check `cancelResult instanceof Error` +
  `logger.error`, không đổi `decision`/`managementAction` trả về. FIXED.

## 2. Regression eager-mock (subtask 04)

`binance-execution-smc.ts:15-19` và `binance-execution-volman.ts:16-20`: 3 field
`calculateRiskRewardPlan`, `saveBinanceExecutionDetails`, `updateBinanceSlOrder` trong
`config` đều là arrow-function thunk (`(setup) => calculateRiskRewardPlan(setup)`, v.v.),
không còn object-shorthand đọc named-import binding tại top-level module. Xác nhận bằng
full test suite (mục 4 bên dưới): 2 file test tiền tồn tại từng vỡ
(`smc-index.test.ts`, `index.test.ts`) nay pass, không còn crash tại import time.

## 3. Tự chạy `npm run build`

```
> auto-signal-bot@1.0.0 build
> tsc
```

Exit sạch, 0 lỗi TypeScript.

## 4. Tự chạy `npx vitest run` (full suite, không giới hạn file)

```
 Test Files  76 passed (76)
      Tests  827 passed (827)
   Duration  7.12s
```

Toàn bộ 76 file test / 827 test pass, không có test nào fail hoặc bị skip. Không phát
hiện quay lại vấn đề "No export is defined on the mock" ở `smc-index.test.ts` /
`index.test.ts`.

## 5. Đối chiếu phạm vi diff (`git status` / `git diff --stat`)

Diff liên quan tới task này nằm đúng trong các file plan cho phép:
- `src/charts/binance-execution-shared.ts` (mới, subtask 03)
- `src/charts/binance-execution-smc.ts` (rewrite thành wrapper mỏng, subtask 01+03+04)
- `src/charts/binance-execution-volman.ts` (rewrite thành wrapper mỏng, subtask 02+03+04)
- `src/charts/positions-repository-smc.ts` — diff riêng cho phần liên quan task này chỉ
  thêm literal `"close_failed"` vào 3 vị trí union type `binanceExecutionStatus`
  (dòng 56, 270 cũ, 470 cũ theo done.md subtask 01). Phần diff còn lại của file này
  (thêm field `binanceSymbol`/`binanceLeverage`/.../`saveBinanceExecutionDetails`/
  `updateBinanceSlOrder`) là của task TRƯỚC (`binance-futures-execution-smc`, đã có
  `tasks/binance-futures-execution-smc/done.md` riêng), không phải leftover của task này
  — đây là baseline mà task này build trên đó, đúng như context.md mô tả ("code review
  trên working tree hiện tại của feature binance-futures-execution-smc").
- `src/charts/positions-repository-volman.ts` — diff xác nhận CHỈ đổi type
  (`git diff` cho thấy đúng 3 chỗ thêm `"close_failed"`, không có gì khác).
- `tests/charts/binance-execution-smc.test.ts`, `tests/charts/binance-execution-volman.test.ts`
  (mới), `tests/charts/positions-repository-smc.test.ts`: nằm trong phạm vi subtask cho
  phép.

**File KHÔNG thuộc scope task này** (đã xác nhận là leftover từ task trước
`binance-futures-execution-smc`, có `done.md` riêng, KHÔNG bị task này đụng vào thêm):
`.env.example`, `src/charts/binance-futures-client.ts`,
`src/charts/binance-futures-config-env.ts`, `src/charts/check-open-trades-runner-smc.ts`,
`src/charts/smc-index.ts`, `supabase/migrations/20260712000000_add_binance_execution_columns_smc.sql`,
`tasks/binance-futures-execution-smc/**`, `tests/charts/binance-futures-client.test.ts`.
Các file này đã tồn tại trong working tree TRƯỚC khi task `fix-binance-execution-review`
bắt đầu (đúng như premise trong context.md dòng 3-4), không có diff mới nào từ 4 subtask
của task này chồng lên chúng — verify bằng cách đọc nội dung hiện tại của
`positions-repository-smc.ts`/`positions-repository-volman.ts` (mục trên) và không thấy
thay đổi nào ngoài phạm vi type `binanceExecutionStatus`.

Không phát hiện thay đổi ngoài phạm vi được phép trong `plan.md`.

## 6. Rủi ro nêu trong plan.md — đã verify lại

- Nhánh SL move thành công vẫn giữ `PARTIAL_TP1`/`tp1Reached: true` — verify tại mục 1.
- `partialClosePercent: 0` ở nhánh fail không ảnh hưởng vì `deriveManagementPatch` rơi
  fallback `patch: null` — đã verify qua đọc `binance-execution-shared.ts` (logic decision
  fallback không đọc field này khi `managementAction === "NONE"` và `tp1Reached === false`
  và `decision !== "CLOSE"`).
- Type `"close_failed"` đã cập nhật đủ cả `OpenPosition` và `BinanceExecutionDetails` ở cả
  2 file `positions-repository-{smc,volman}.ts` — verify bằng `git diff` mục 5.
- `03` không đổi behavior — full test suite pass 827/827 xác nhận không có regression so
  với test đã viết ở `01`/`02`.

## Kết luận cuối cùng

Cả 5 finding gốc + finding phụ #1 đều fixed đúng theo `context.md`. Dedup hoàn tất, không
còn ~90% trùng lặp. Regression eager-mock đã được fix và verify bằng full suite. Build và
toàn bộ 827 test pass. Diff scope đúng phạm vi 4 subtask cho phép; các file khác trong
`git status` là baseline từ task trước, không phải leftover ngoài ý muốn của task này.

**APPROVED — sẵn sàng để user tự quyết định commit.**
