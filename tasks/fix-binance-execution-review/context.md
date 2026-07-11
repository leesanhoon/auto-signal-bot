# Context — fix-binance-execution-review

Nguồn: code review trên working tree hiện tại của feature `binance-futures-execution-smc`
(xem `tasks/binance-futures-execution-smc/plan.md` và `done.md` để hiểu kiến trúc gốc).
Review phát hiện 5 finding (đánh số theo mức nghiêm trọng) trên CẢ HAI hệ SMC và Volman
vì `binance-execution-smc.ts` là bản copy ~90% của `binance-execution-volman.ts`.

Đọc file này trước khi làm `01-fix-smc-execution-logic/task.md` hoặc
`02-fix-volman-execution-logic/task.md`. Hai task đó áp dụng **cùng một bộ fix**, chỉ
khác file/module target (SMC dùng hậu tố `-smc`, Volman dùng hậu tố `-volman` hoặc không
hậu tố tuỳ file — xem bảng file mapping bên dưới).

## File mapping SMC ↔ Volman

| Vai trò | SMC | Volman |
|---|---|---|
| Execution module | `src/charts/binance-execution-smc.ts` | `src/charts/binance-execution-volman.ts` |
| Position engine (type `PositionDecisionOutcome`, `deriveManagementPatch`) | `src/charts/position-engine-smc.ts` | `src/charts/position-engine-volman.ts` |
| Repository (`OpenPosition`, `BinanceExecutionDetails`, `saveBinanceExecutionDetails`, `updateBinanceSlOrder`) | `src/charts/positions-repository-smc.ts` | `src/charts/positions-repository-volman.ts` |
| Test file execution | `tests/charts/binance-execution-smc.test.ts` | `tests/charts/binance-execution-volman.test.ts` (tạo mới nếu chưa có, theo đúng pattern của bản SMC) |
| Test file repository | `tests/charts/positions-repository-smc.test.ts` | `tests/charts/positions-repository-volman.test.ts` |
| Logger tag hiện tại | `charts:binance-execution-smc` | `charts:binance-execution` (giữ nguyên, không đổi) |
| Alert prefix Telegram | `*Binance Futures (SMC)*` | `*Binance Futures*` / `*Binance Futures (Volman)*` (giữ nguyên convention hiện có trong từng file, xem code) |

`position-engine-*.ts` đã có type `PositionDecisionOutcome` và enum
`PositionDecisionAction = "NONE" | "PARTIAL_TP1" | "MOVE_SL_TO_BE" | "TRAIL_SL" | "TP2_CLOSE"`
GIỐNG HỆT NHAU ở cả 2 hệ (đã verify). Fix trong plan này KHÔNG cần sửa file
`position-engine-*.ts` — chỉ cần dùng đúng field `tp1Reached` / `managementAction` /
`newStopLoss` hiện có theo quy tắc mới. `deriveManagementPatch` (đã đọc, dùng logic:
nếu `managementAction !== "PARTIAL_TP1"` và `tp1Reached === false` và
`managementAction` không phải `MOVE_SL_TO_BE`/`TRAIL_SL`/`TP2_CLOSE` và `decision !==
"CLOSE"` thì rơi vào fallback cuối cùng `return { patch: null, closePosition: false }` —
tức là KHÔNG ghi gì vào DB ngoài `last_decision`/`last_decision_comment`/
`last_decision_confidence` (luôn được `updatePositionDecision` ghi bất kể patch có null
hay không). Đây chính là cơ chế ta sẽ tận dụng để fix Finding 1 + Finding 4 mà KHÔNG cần
thêm cột DB mới.

## Quyết định kiến trúc

### Finding 1 + Finding 4 (gộp chung, xử lý cùng lúc) — Dead retry SL breakeven + DB ghi sai stop_loss

**Quyết định: KHÔNG thêm cột DB mới (không cần `binance_sl_moved_to_be`).** Thay vào đó
sửa `reconcileBinancePosition` trong `binance-execution-*.ts`: 2 nhánh fail hiện tại của
khối "dời SL về breakeven" (dòng ~364-388 và ~398-420 trong bản SMC, tương ứng trong
Volman) đang trả về:

```ts
managementAction: "PARTIAL_TP1",
newStopLoss: null,
tp1Reached: true,
```

Đây là NGUYÊN NHÂN của cả Finding 1 và Finding 4. Vì `deriveManagementPatch` check
`decision.managementAction === "PARTIAL_TP1" || decision.tp1Reached` — cả 2 field đều
đang true nên patch luôn được ghi (tp1ClosedPercent=50 + stopLoss fallback về `entry`),
dù SL move thất bại.

**Sửa: đổi CẢ 2 nhánh fail này** để trả về:

```ts
managementAction: "NONE",
newStopLoss: null,
tp1Reached: false,       // <-- đổi false, KHÔNG phải true
partialClosePercent: 0,  // <-- đổi 0 thay vì position.tp1ClosePercent ?? 50
```

Giữ nguyên `decision: "HOLD"`, `confidence`, `comment` (comment vẫn mô tả rõ tình trạng
lỗi — comment này VẪN được ghi vào `last_decision_comment` qua `updatePositionDecision`,
người vận hành vẫn nhìn thấy trong Telegram message, KHÔNG mất thông tin).

Kết quả: `deriveManagementPatch` rơi vào fallback `return { patch: null, closePosition:
false }` — KHÔNG ghi `tp1_closed_percent`, KHÔNG ghi `stop_loss` sai (fix Finding 4).
`tp1ClosedPercent` trong DB vẫn = 0 → `alreadyPartial` vẫn false ở chu kỳ sau → guard
`!alreadyPartial && position.binanceTp1OrderId` (dòng 343 SMC / 353 Volman) vẫn mở →
`reconcileBinancePosition` sẽ tự động RETRY toàn bộ khối dời SL ở lần check tiếp theo,
vì `getOrderStatus` với TP1 order id vẫn trả FILLED (TP1 đã khớp thật trên sàn, trạng
thái này không đổi) — retry tự nhiên xảy ra mỗi cycle cho tới khi thành công (fix
Finding 1, "retry không bao giờ chạy").

**Chỉ nhánh THÀNH CÔNG** (đặt lại SL mới thành công, dòng ~422-435 SMC / ~433-446 Volman)
mới giữ nguyên `managementAction: "PARTIAL_TP1"`, `tp1Reached: true`,
`newStopLoss: String(bePrice)` như code hiện tại — đây là hành vi ĐÚNG, không đổi.

Lưu ý: giữa các cycle, nếu SL cũ đã bị huỷ nhưng đặt SL mới fail (nhánh 2), vị thế thật
sự KHÔNG CÓ SL trên sàn cho tới cycle sau — alert Telegram khẩn cấp hiện có (dòng
403-405 SMC) đã cảnh báo đúng, giữ nguyên. Nhánh này sẽ tiếp tục retry (huỷ lại — dù đã
huỷ trước đó `cancelOrder` là idempotent với lỗi -2011 theo comment code hiện tại — rồi
đặt lại) ở cycle sau, không cần thay đổi thêm.

### Finding 2 — 'failed' status ghi vô điều kiện trong fail-safe

**Quyết định:** thêm giá trị status mới `"close_failed"` (không phải cột mới, chỉ thêm
literal vào type `binanceExecutionStatus` đang là text ở DB, không cần migration).

- Nếu `closeResult` (lệnh đóng khẩn cấp) THÀNH CÔNG → giữ nguyên `"failed"` (ý nghĩa:
  "execution fail, đã đóng an toàn trên sàn" — reconcile CLOSE DB record, hành vi hiện
  tại ĐÚNG, không đổi).
- Nếu `closeResult instanceof Error` → ghi `"close_failed"` (ý nghĩa: "execution fail,
  đóng khẩn cấp CŨNG fail, vị thế có thể vẫn đang mở trên sàn KHÔNG CÓ SL").

`reconcileBinancePosition` thêm nhánh xử lý `binanceExecutionStatus === "close_failed"`
ĐẶT TRƯỚC nhánh `"failed"` hiện tại:

```ts
if (position.binanceExecutionStatus === "close_failed") {
  const positionAmt = await getPositionAmount(symbol);
  if (positionAmt instanceof Error) {
    return HOLD, confidence thấp (vd 30), comment giải thích không xác minh được trạng
    thái sàn, thử lại cycle sau — KHÔNG đóng DB.
  }
  if (positionAmt === 0) {
    // Vị thế đã được đóng tay/tự đóng trên sàn từ lúc đó tới giờ
    return CLOSE, comment "Vị thế đã đóng khẩn cấp trước đó thất bại nhưng nay xác nhận
    đã đóng trên sàn (positionAmt=0), đóng bản ghi DB".
  }
  // Vị thế vẫn đang mở trên sàn, không có SL — tiếp tục HOLD + nhắc lại cảnh báo mỗi cycle
  await sendMessage(urgent reminder — vẫn còn mở KHÔNG SL, cần đóng tay);
  return HOLD, confidence 20, comment mô tả đúng tình trạng.
}
```

Type `binanceExecutionStatus` trong `positions-repository-*.ts` (2 chỗ mỗi file: field
trong `OpenPosition` và trong `BinanceExecutionDetails`) đổi từ
`"pending" | "placed" | "failed"` (+ `| null` ở OpenPosition) thành
`"pending" | "placed" | "failed" | "close_failed"` (+ `| null`).

### Finding 3 — Guard cross-system fail-open → fail-closed

Sửa điều kiện guard trong `openBinanceFuturesPosition`:

```ts
const existingPositionAmt = await getPositionAmount(binanceSymbol);
if (existingPositionAmt instanceof Error) {
  logger.error("Khong xac minh duoc vi the hien tai tren san — bo qua entry (fail-closed)", {
    pair: setup.pair,
    binanceSymbol,
    error: existingPositionAmt,
  });
  await sendMessage(
    `⚠️ *Binance Futures (SMC|Volman)* — Bỏ qua mở vị thế thật ${binanceSymbol}: không xác minh được vị thế hiện tại trên sàn (lỗi API). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn để tránh rủi ro mở đè lên vị thế của hệ khác.\nLỗi: ${existingPositionAmt.message}`,
  );
  return;
}
if (existingPositionAmt !== 0) {
  // giữ nguyên nhánh hiện tại
}
```

### Finding phụ #1 — Orphan reduceOnly order khi dọn lệnh còn lại

Trong 2 nhánh SL-filled (dòng ~296-304 SMC) và TP2-filled (dòng ~321-326 SMC, tương ứng
Volman), `cancelOrder` cho lệnh còn lại (TP1/TP2 khi SL filled; SL khi TP2 filled) không
kiểm tra kết quả lỗi. Sửa: log lỗi rõ ràng (không cần alert Telegram bắt buộc — lệnh
reduceOnly mồ côi không tự mở vị thế mới, rủi ro thấp hơn nhiều so với Finding 1-4, chỉ
cần log để có thể trace) khi `cancelOrder` trả Error, tương tự pattern try/log đã dùng ở
fail-safe branch (dòng 175-184). KHÔNG thay đổi `decision`/`managementAction` trả về —
vẫn STOP/CLOSE như cũ vì vị thế đã thực sự đóng.

### Findings phụ #2, #3 (side-effect trước persist DB, FINISHED/algoStatus ambiguity)

**KHÔNG đưa vào scope task này.** Lý do: #2 (side effect trước persist) là trade-off vốn
có của mô hình "reconcile đọc trực tiếp từ sàn" — sửa đúng cần idempotency key / outbox
pattern, vượt phạm vi fix an toàn hiện tại và rủi ro thêm bug mới cao hơn lợi ích trước
mắt. #3 (FINISHED → FILLED mapping) đã có comment giải thích rõ trong
`binance-futures-client.ts:33-40` là quyết định có chủ đích, sản phẩm đã verify trên
testnet theo `tasks/binance-futures-execution-smc/05-config-docs-tests-smc/testnet-verification.md`.
Nếu muốn double-check bằng `getPositionAmount` trước khi coi FINISHED là fill thật, cần
task riêng sau khi có thêm dữ liệu thực tế trên mainnet — ghi nhận là known limitation,
không fix trong task này.

## Không được làm

- Không thêm migration DB mới trong `01`/`02` (Finding 1+4 không cần cột mới; Finding 2
  chỉ thêm literal string vào cột text `binance_execution_status` đã tồn tại).
- Không sửa `position-engine-smc.ts` / `position-engine-volman.ts` trong `01`/`02` (logic
  `deriveManagementPatch` giữ nguyên, chỉ tận dụng behavior đã có).
- Không refactor gộp code giữa SMC/Volman trong `01`/`02` — đó là scope của `03`.
- Không commit/push.
