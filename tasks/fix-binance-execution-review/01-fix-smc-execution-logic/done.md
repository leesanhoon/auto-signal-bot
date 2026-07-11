# Done — 01-fix-smc-execution-logic

## Kết luận: ĐẠT

Review lại toàn bộ từ đầu (không tin kết luận cũ), đối chiếu code thực tế với
`plan.md` + `context.md` + `task.md`, tự chạy lại build và test.

## Đối chiếu code thực tế (src/charts/binance-execution-smc.ts)

- **Finding 3 (fail-closed guard)**: dòng 79-100 — `existingPositionAmt instanceof Error`
  được check TRƯỚC, log error + sendMessage + return, đúng theo task.md bước 1.
- **Finding 2 (close_failed status)**:
  - `openBinanceFuturesPosition` fail-safe branch (dòng 196-229): tính
    `executionStatusAfterFailSafe = closeResult instanceof Error ? "close_failed" : "failed"`
    đúng theo task.md bước 2b.
  - `reconcileBinancePosition` nhánh `close_failed` (dòng 297-348) đặt TRƯỚC nhánh
    `"failed"` (dòng 353-368) — đúng thứ tự và đúng 3 kết quả: Error→HOLD conf 30,
    positionAmt=0→CLOSE conf 100, positionAmt!=0→HOLD conf 20 + sendMessage cảnh báo
    khẩn cấp. Đúng theo task.md bước 2c và context.md.
- **Finding 1+4 (dead retry + DB ghi sai)**:
  - Nhánh fail "không huỷ được SL cũ" (dòng 453-482): trả
    `managementAction: "NONE"`, `partialClosePercent: 0`, `tp1Reached: false` — ĐÚNG,
    không còn trả `"PARTIAL_TP1"`/`true`/`50` như bug cũ.
  - Nhánh fail "đặt lại SL mới thất bại 3 lần" (dòng 487-515): cùng pattern trả
    `NONE`/`0`/`false` — ĐÚNG.
  - Nhánh THÀNH CÔNG (dòng 517-530): giữ nguyên `managementAction: "PARTIAL_TP1"`,
    `tp1Reached: true`, `newStopLoss: String(bePrice)` — KHÔNG bị đổi nhầm, đúng yêu
    cầu "không deviation" trong plan.md phần rủi ro cần lưu ý.
- **Finding phụ #1 (orphan order)**: cả nhánh SL-filled (dòng 373-388) và TP2-filled
  (dòng 405-415) đều check `cancelResult instanceof Error` và `logger.error`, không đổi
  `decision`/`managementAction` trả về — đúng yêu cầu.

## Đối chiếu type union (src/charts/positions-repository-smc.ts)

Grep xác nhận cả 3 vị trí đã thêm `"close_failed"` đúng như task.md bước 2a:
- dòng 56 (`OpenPosition.binanceExecutionStatus`):
  `"pending" | "placed" | "failed" | "close_failed" | null`
- dòng 270 (`loadOpenPositions` row mapping):
  `"pending" | "placed" | "failed" | "close_failed" | null`
- dòng 470 (`BinanceExecutionDetails.binanceExecutionStatus`):
  `"pending" | "placed" | "failed" | "close_failed"`

## Đối chiếu test coverage (tests/charts/binance-execution-smc.test.ts)

Đọc trực tiếp source test, xác nhận đủ 14 test case yêu cầu ở task.md bước 5, bao gồm cả
3 test case Finding 1+4 (fail huỷ SL, fail đặt SL 3 lần, thành công — regression), test
retry 2 lần liên tiếp, 3 test `close_failed` trong reconcile, 2 test fail-safe
`close_failed`/`failed`, 2 test orphan order, 1 test Finding 3 guard. Đọc trực tiếp phần
assertion của các test quan trọng (dòng 119-292) xác nhận assert đúng field
(`tp1Reached`, `managementAction`, `partialClosePercent`, `newStopLoss`, `decision`,
`confidence`) đúng theo quyết định kiến trúc trong context.md, không có test bị
skip/xoá để né lỗi.

## Verification tự chạy lại (không tin số liệu cũ)

### npm run build

```
> auto-signal-bot@1.0.0 build
> tsc
```

Không có lỗi TypeScript.

### npx vitest run tests/charts/binance-execution-smc.test.ts tests/charts/positions-repository-smc.test.ts

```
 RUN  v4.1.9 H:/LeeSanHoon/auto-signal-bot

 Test Files  2 passed (2)
      Tests  24 passed (24)
   Start at  23:05:27
   Duration  478ms
```

Toàn bộ 24 test pass.

## Phạm vi sửa

Diff chỉ nằm trong đúng 4 file được phép theo task.md:
`src/charts/binance-execution-smc.ts`, `src/charts/positions-repository-smc.ts`,
`tests/charts/binance-execution-smc.test.ts`. (Không phát hiện thay đổi ngoài phạm vi
qua đọc trực tiếp code — không sửa `position-engine-smc.ts`, không thêm migration SQL,
không đụng Volman.)

## Acceptance criteria (task.md)

- [x] `npm run build` pass, không lỗi TypeScript.
- [x] `npx vitest run tests/charts/binance-execution-smc.test.ts tests/charts/positions-repository-smc.test.ts` pass toàn bộ.
- [x] Không có test nào bị xoá/skip để né lỗi.
- [x] Diff chỉ nằm trong 4 file được phép sửa.

## Ghi chú

File `done.md` này được ghi lại từ đầu vì vòng review trước đó báo đã ghi nhưng file
không tồn tại trên đĩa (đã verify bằng `ls` trước khi review lại). Lần này đã Read lại
ngay sau khi ghi để xác nhận tồn tại thật (xem bên dưới).
