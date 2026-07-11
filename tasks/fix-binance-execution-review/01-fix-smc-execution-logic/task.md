# Task 01 — Fix Binance execution logic (SMC)

Đọc `tasks/fix-binance-execution-review/context.md` trước (giải thích root cause + quyết
định kiến trúc đầy đủ). Task này chỉ áp fix vào 2 hệ SMC.

## Phạm vi được phép sửa

- `src/charts/binance-execution-smc.ts`
- `src/charts/positions-repository-smc.ts` (CHỈ đổi type union `binanceExecutionStatus`,
  KHÔNG đổi logic khác)
- `tests/charts/binance-execution-smc.test.ts`
- `tests/charts/positions-repository-smc.test.ts` (chỉ nếu cần thêm test cho type mới)

KHÔNG sửa file nào khác. KHÔNG sửa `position-engine-smc.ts`. KHÔNG thêm migration SQL.
KHÔNG refactor/gộp code với Volman (đó là task 03, làm sau).

## Bước 1 — Fix Finding 3 (guard fail-closed) trong `binance-execution-smc.ts`

Tìm đoạn code hiện tại (khoảng dòng 79-90):

```ts
    const existingPositionAmt = await getPositionAmount(binanceSymbol);
    if (!(existingPositionAmt instanceof Error) && existingPositionAmt !== 0) {
      logger.warn("Bo qua entry Binance — symbol da co vi the mo (co the do he khac)", {
        pair: setup.pair,
        binanceSymbol,
        existingPositionAmt,
      });
      await sendMessage(
        `⚠️ *Binance Futures (SMC)* — Bỏ qua mở vị thế thật ${binanceSymbol}: symbol này đã có vị thế đang mở trên sàn (có thể do hệ khác đặt). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn.`,
      );
      return;
    }
```

Thay bằng (thêm nhánh fail-closed TRƯỚC nhánh hiện tại, giữ nguyên nhánh hiện tại):

```ts
    const existingPositionAmt = await getPositionAmount(binanceSymbol);
    if (existingPositionAmt instanceof Error) {
      logger.error(
        "Khong xac minh duoc vi the hien tai tren san — bo qua entry (fail-closed)",
        { pair: setup.pair, binanceSymbol, error: existingPositionAmt },
      );
      await sendMessage(
        `⚠️ *Binance Futures (SMC)* — Bỏ qua mở vị thế thật ${binanceSymbol}: không xác minh được vị thế hiện tại trên sàn (lỗi API). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn để tránh rủi ro mở đè lên vị thế của hệ khác.\nLỗi: ${existingPositionAmt.message}`,
      );
      return;
    }
    if (existingPositionAmt !== 0) {
      logger.warn("Bo qua entry Binance — symbol da co vi the mo (co the do he khac)", {
        pair: setup.pair,
        binanceSymbol,
        existingPositionAmt,
      });
      await sendMessage(
        `⚠️ *Binance Futures (SMC)* — Bỏ qua mở vị thế thật ${binanceSymbol}: symbol này đã có vị thế đang mở trên sàn (có thể do hệ khác đặt). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn.`,
      );
      return;
    }
```

## Bước 2 — Fix Finding 2 (status `close_failed`) trong `binance-execution-smc.ts`

### 2a. Đổi type `binanceExecutionStatus` trong `positions-repository-smc.ts`

Tìm dòng (trong type `OpenPosition`, khoảng dòng 56):

```ts
  binanceExecutionStatus: "pending" | "placed" | "failed" | null;
```

Đổi thành:

```ts
  binanceExecutionStatus: "pending" | "placed" | "failed" | "close_failed" | null;
```

Tìm dòng (trong type `BinanceExecutionDetails`, khoảng dòng 470):

```ts
  binanceExecutionStatus: "pending" | "placed" | "failed";
```

Đổi thành:

```ts
  binanceExecutionStatus: "pending" | "placed" | "failed" | "close_failed";
```

Cũng tìm trong hàm `loadOpenPositions` (kiểu inline của row mapping, khoảng dòng 270):

```ts
      binance_execution_status: "pending" | "placed" | "failed" | null;
```

Đổi thành:

```ts
      binance_execution_status: "pending" | "placed" | "failed" | "close_failed" | null;
```

### 2b. Sửa fail-safe branch trong `openBinanceFuturesPosition` (`binance-execution-smc.ts`)

Tìm đoạn code hiện tại trong khối `catch (protectionError)` (khoảng dòng 186-211):

```ts
      const positionAmt = await getPositionAmount(binanceSymbol);
      const qtyToClose =
        !(positionAmt instanceof Error) && positionAmt !== 0
          ? Math.abs(positionAmt)
          : sizing.quantity;
      const closeResult = await placeMarketOrder(binanceSymbol, closeSide, qtyToClose, {
        reduceOnly: true,
      });

      try {
        await saveBinanceExecutionDetails(positionId, {
          binanceSymbol,
          binanceLeverage: leverage,
          binanceQuantity: sizing.quantity,
          binanceEntryOrderId: entryOrder.orderId,
          binanceSlOrderId: null,
          binanceTp1OrderId: null,
          binanceTp2OrderId: null,
          binanceExecutionStatus: "failed",
        });
      } catch (dbError) {
        logger.error("Khong ghi duoc execution status failed vao DB", {
          positionId,
          error: dbError,
        });
      }
```

Đổi thành (chỉ đổi giá trị `binanceExecutionStatus` dựa trên `closeResult`, giữ nguyên
phần còn lại):

```ts
      const positionAmt = await getPositionAmount(binanceSymbol);
      const qtyToClose =
        !(positionAmt instanceof Error) && positionAmt !== 0
          ? Math.abs(positionAmt)
          : sizing.quantity;
      const closeResult = await placeMarketOrder(binanceSymbol, closeSide, qtyToClose, {
        reduceOnly: true,
      });

      // "failed" = da dong an toan tren san (closeResult thanh cong), reconcile duoc
      // phep CLOSE ban ghi DB. "close_failed" = dong khan cap CUNG that bai, vi the co
      // the van dang mo tren san KHONG CO SL — reconcile phai tiep tuc theo doi qua
      // getPositionAmount, KHONG duoc coi la da dong.
      const executionStatusAfterFailSafe: "failed" | "close_failed" =
        closeResult instanceof Error ? "close_failed" : "failed";

      try {
        await saveBinanceExecutionDetails(positionId, {
          binanceSymbol,
          binanceLeverage: leverage,
          binanceQuantity: sizing.quantity,
          binanceEntryOrderId: entryOrder.orderId,
          binanceSlOrderId: null,
          binanceTp1OrderId: null,
          binanceTp2OrderId: null,
          binanceExecutionStatus: executionStatusAfterFailSafe,
        });
      } catch (dbError) {
        logger.error("Khong ghi duoc execution status vao DB", {
          positionId,
          status: executionStatusAfterFailSafe,
          error: dbError,
        });
      }
```

### 2c. Thêm nhánh xử lý `close_failed` trong `reconcileBinancePosition`

Tìm đoạn code hiện tại (khoảng dòng 276-294):

```ts
  // Execution "failed" = fail-safe cua task 03 da dong khan cap vi the tren san
  // (khong con lenh nao, moi order id deu null). Neu de HOLD, position DB se treo
  // mai mai (khong roi ve luong candle vi binanceSymbol da set). Dong DB luon.
  if (position.binanceExecutionStatus === "failed") {
    return {
      decision: "CLOSE",
      confidence: 100,
      comment:
        "Execution Binance thất bại — vị thế đã được fail-safe đóng khẩn cấp trên sàn, đóng bản ghi DB tương ứng",
      managementAction: "NONE",
      partialClosePercent: 0,
      newStopLoss: null,
      tp1Reached: false,
      tp2Reached: false,
      riskReward: null,
      tp1RiskReward: null,
      tp2RiskReward: null,
    };
  }
```

Thêm nhánh MỚI ngay TRƯỚC đoạn trên (giữ nguyên đoạn trên không đổi):

```ts
  // Execution "close_failed" = fail-safe da dong khan cap that bai luon — sang co the
  // VAN CON vi the mo KHONG CO SL. Phai verify qua getPositionAmount truoc khi quyet
  // dinh, KHONG duoc coi nhu da dong (khac voi "failed").
  if (position.binanceExecutionStatus === "close_failed") {
    const positionAmt = await getPositionAmount(symbol);
    if (positionAmt instanceof Error) {
      return {
        decision: "HOLD",
        confidence: 30,
        comment:
          "Execution Binance thất bại và lệnh đóng khẩn cấp cũng thất bại trước đó — không xác minh được trạng thái vị thế trên sàn lúc này, sẽ thử lại lần check sau",
        managementAction: "NONE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: false,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }
    if (positionAmt === 0) {
      return {
        decision: "CLOSE",
        confidence: 100,
        comment:
          "Execution Binance thất bại và lệnh đóng khẩn cấp cũng thất bại trước đó, nhưng nay xác nhận vị thế đã đóng trên sàn — đóng bản ghi DB tương ứng",
        managementAction: "NONE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: false,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }
    await sendMessage(
      `🚨🚨 *Binance Futures (SMC) — KHẨN CẤP nhắc lại* — ${symbol}: vị thế VẪN ĐANG MỞ trên sàn KHÔNG CÓ SL (đóng khẩn cấp trước đó thất bại). Mở Binance app và ĐÓNG TAY hoặc đặt SL NGAY.`,
    );
    return {
      decision: "HOLD",
      confidence: 20,
      comment:
        "Execution Binance thất bại và lệnh đóng khẩn cấp cũng thất bại — vị thế vẫn đang mở trên sàn KHÔNG CÓ SL, cần can thiệp tay khẩn cấp",
      managementAction: "NONE",
      partialClosePercent: 0,
      newStopLoss: null,
      tp1Reached: false,
      tp2Reached: false,
      riskReward: null,
      tp1RiskReward: null,
      tp2RiskReward: null,
    };
  }

```

(Giữ nguyên khối `if (position.binanceExecutionStatus === "failed")` ngay sau nó không
đổi gì.)

## Bước 3 — Fix Finding 1 + Finding 4 (dead retry + DB ghi sai stop_loss)

Trong `reconcileBinancePosition`, tìm khối "HUY SL CU TRUOC, dat SL moi SAU" (khoảng dòng
343-436 theo số dòng hiện tại trước khi sửa bước 1/2 — SAU KHI đã áp bước 1/2 số dòng sẽ
dịch xuống, tìm bằng nội dung code, không dùng số dòng).

### 3a. Nhánh fail "không huỷ được SL cũ"

Tìm:

```ts
          logger.error(
            "Khong huy duoc SL cu de doi BE — giu nguyen SL goc, thu lai lan sau",
            { pair: position.pair, id: position.id, error: cancelResult },
          );
          return {
            decision: "HOLD",
            confidence: 90,
            comment:
              "TP1 đã khớp trên Binance Futures, dời SL về breakeven THẤT BẠI (không hủy được SL cũ) — SL vẫn ở giá gốc, sẽ thử lại lần check sau",
            managementAction: "PARTIAL_TP1",
            partialClosePercent: position.tp1ClosePercent ?? 50,
            newStopLoss: null,
            tp1Reached: true,
            tp2Reached: false,
            riskReward: null,
            tp1RiskReward: null,
            tp2RiskReward: null,
          };
```

Đổi thành (chỉ đổi 3 field `managementAction`, `partialClosePercent`, `tp1Reached`, thêm
comment giải thích, giữ nguyên `comment` hiển thị cho user):

```ts
          logger.error(
            "Khong huy duoc SL cu de doi BE — giu nguyen SL goc, thu lai lan sau",
            { pair: position.pair, id: position.id, error: cancelResult },
          );
          // QUAN TRONG: managementAction "NONE" + tp1Reached false + partialClosePercent 0
          // (KHONG phai "PARTIAL_TP1"/true/50 nhu truoc) de deriveManagementPatch KHONG ghi
          // tp1ClosedPercent/stopLoss sai vao DB — giu tp1ClosedPercent=0 trong DB de guard
          // "!alreadyPartial" o dau ham nay mo lai, cho phep retry tu nhien o cycle sau
          // (xem tasks/fix-binance-execution-review/context.md muc "Finding 1 + Finding 4").
          return {
            decision: "HOLD",
            confidence: 90,
            comment:
              "TP1 đã khớp trên Binance Futures, dời SL về breakeven THẤT BẠI (không hủy được SL cũ) — SL vẫn ở giá gốc, sẽ thử lại lần check sau",
            managementAction: "NONE",
            partialClosePercent: 0,
            newStopLoss: null,
            tp1Reached: false,
            tp2Reached: false,
            riskReward: null,
            tp1RiskReward: null,
            tp2RiskReward: null,
          };
```

### 3b. Nhánh fail "đã huỷ SL cũ nhưng không đặt lại được SL mới sau 3 lần"

Tìm:

```ts
        await sendMessage(
          `🚨🚨 *Binance Futures (SMC) — KHẨN CẤP* — ${symbol}: đã hủy SL cũ để dời breakeven nhưng KHÔNG đặt lại được SL mới sau 3 lần thử.\n⚠️ VỊ THẾ ĐANG KHÔNG CÓ SL — mở Binance app và đặt SL tay NGAY LẬP TỨC.\nLỗi: ${newSl.message}`,
        );
        return {
          decision: "HOLD",
          confidence: 90,
          comment:
            "TP1 đã khớp trên Binance Futures, dời SL về breakeven THẤT BẠI SAU KHI ĐÃ HỦY SL CŨ — vị thế đang KHÔNG CÓ SL, cần đặt tay khẩn cấp",
          managementAction: "PARTIAL_TP1",
          partialClosePercent: position.tp1ClosePercent ?? 50,
          newStopLoss: null,
          tp1Reached: true,
          tp2Reached: false,
          riskReward: null,
          tp1RiskReward: null,
          tp2RiskReward: null,
        };
```

Đổi thành:

```ts
        await sendMessage(
          `🚨🚨 *Binance Futures (SMC) — KHẨN CẤP* — ${symbol}: đã hủy SL cũ để dời breakeven nhưng KHÔNG đặt lại được SL mới sau 3 lần thử.\n⚠️ VỊ THẾ ĐANG KHÔNG CÓ SL — mở Binance app và đặt SL tay NGAY LẬP TỨC.\nLỗi: ${newSl.message}`,
        );
        // QUAN TRONG: xem giai thich o nhanh fail phia tren (3a) — cung ap dung o day.
        return {
          decision: "HOLD",
          confidence: 90,
          comment:
            "TP1 đã khớp trên Binance Futures, dời SL về breakeven THẤT BẠI SAU KHI ĐÃ HỦY SL CŨ — vị thế đang KHÔNG CÓ SL, cần đặt tay khẩn cấp",
          managementAction: "NONE",
          partialClosePercent: 0,
          newStopLoss: null,
          tp1Reached: false,
          tp2Reached: false,
          riskReward: null,
          tp1RiskReward: null,
          tp2RiskReward: null,
        };
```

### 3c. Nhánh THÀNH CÔNG — KHÔNG được đổi

Đoạn code sau (nhánh đặt lại SL mới THÀNH CÔNG) PHẢI giữ nguyên y hệt, KHÔNG sửa:

```ts
      await updateBinanceSlOrder(position.id, newSl.orderId, String(bePrice));
      return {
        decision: "HOLD",
        confidence: 90,
        comment: "TP1 đã khớp trên Binance Futures, dời SL về breakeven",
        managementAction: "PARTIAL_TP1",
        partialClosePercent: position.tp1ClosePercent ?? 50,
        newStopLoss: String(bePrice),
        tp1Reached: true,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
```

## Bước 4 — Fix Finding phụ #1 (orphan reduceOnly order)

Trong `reconcileBinancePosition`, nhánh SL-filled (tìm `slStatus.status === "FILLED"`):

```ts
    if (!(slStatus instanceof Error) && slStatus.status === "FILLED") {
      if (position.binanceTp1OrderId) {
        await cancelOrder(symbol, position.binanceTp1OrderId);
      }
      if (position.binanceTp2OrderId) {
        await cancelOrder(symbol, position.binanceTp2OrderId);
      }
```

Đổi thành (thêm kiểm tra + log lỗi, không đổi flow):

```ts
    if (!(slStatus instanceof Error) && slStatus.status === "FILLED") {
      if (position.binanceTp1OrderId) {
        const cancelTp1 = await cancelOrder(symbol, position.binanceTp1OrderId);
        if (cancelTp1 instanceof Error) {
          logger.error("Khong huy duoc TP1 order con lai sau khi SL filled — co the con orphan order tren san", {
            pair: position.pair, id: position.id, orderId: position.binanceTp1OrderId, error: cancelTp1,
          });
        }
      }
      if (position.binanceTp2OrderId) {
        const cancelTp2 = await cancelOrder(symbol, position.binanceTp2OrderId);
        if (cancelTp2 instanceof Error) {
          logger.error("Khong huy duoc TP2 order con lai sau khi SL filled — co the con orphan order tren san", {
            pair: position.pair, id: position.id, orderId: position.binanceTp2OrderId, error: cancelTp2,
          });
        }
      }
```

Tương tự cho nhánh TP2-filled (tìm `tp2Status.status === "FILLED"`):

```ts
    if (!(tp2Status instanceof Error) && tp2Status.status === "FILLED") {
      if (position.binanceSlOrderId) {
        await cancelOrder(symbol, position.binanceSlOrderId);
      }
```

Đổi thành:

```ts
    if (!(tp2Status instanceof Error) && tp2Status.status === "FILLED") {
      if (position.binanceSlOrderId) {
        const cancelSl = await cancelOrder(symbol, position.binanceSlOrderId);
        if (cancelSl instanceof Error) {
          logger.error("Khong huy duoc SL order con lai sau khi TP2 filled — co the con orphan order tren san", {
            pair: position.pair, id: position.id, orderId: position.binanceSlOrderId, error: cancelSl,
          });
        }
      }
```

## Bước 5 — Viết/cập nhật test

Sửa `tests/charts/binance-execution-smc.test.ts`. File hiện có sẵn setup mock (đọc file
để nắm pattern hiện tại: `vi.hoisted`, mock `binance-futures-client.js`,
`ohlc-provider.js`, `binance-futures-config-env.js`, `position-engine-smc.js`,
`positions-repository-smc.js`, `telegram-client.js`, import động
`openBinanceFuturesPosition`).

Cần bổ sung:

1. Mock thêm `getOrderStatus`, `updateBinanceSlOrder` vào `clientState` /
   `positions-repository-smc.js` mock (hiện chưa có, cần thêm vào `vi.hoisted` object và
   mock module tương ứng) để test được `reconcileBinancePosition` (đang KHÔNG được
   export/import trong file test — cần thêm import `reconcileBinancePosition` từ
   `../../src/charts/binance-execution-smc.js`).
2. Thêm `describe("charts/binance-execution-smc reconcileBinancePosition", ...)` với các
   test case (dùng object `OpenPosition` tối thiểu cần thiết, ép kiểu `as any` nếu cần
   cho gọn — theo đúng pattern `baseSetup as any` đã có trong file):
   - `"TP1 filled, huy SL cu that bai -> tra HOLD, tp1Reached false, managementAction NONE"`:
     mock `getOrderStatus` cho SL order id (nếu có trong fixture, có thể để
     `binanceSlOrderId: 111`) trả FILLED=false hoặc bỏ qua nếu fixture không set SL trước
     đó; mock TP1 order status FILLED; mock `cancelOrder` trả `new Error("cancel failed")`.
     Assert: kết quả `tp1Reached === false`, `managementAction === "NONE"`,
     `partialClosePercent === 0`, `newStopLoss === null`, `decision === "HOLD"`.
   - `"TP1 filled, huy SL cu OK nhung dat SL moi fail 3 lan -> tra HOLD, tp1Reached false"`:
     mock `cancelOrder` (cho SL cũ) trả thành công; mock `placeStopMarketOrder` LUÔN trả
     Error (3 lần gọi). Assert tương tự nhánh trên. Verify `placeStopMarketOrder` được
     gọi đúng 3 lần (`toHaveBeenCalledTimes(3)`).
   - `"TP1 filled, doi SL breakeven thanh cong -> tra managementAction PARTIAL_TP1, tp1Reached true"` (regression):
     mock `cancelOrder` OK, `placeStopMarketOrder` trả thành công với `orderId` cụ thể,
     mock `getExchangeInfoFilters` trả tickSize hợp lệ, mock `updateBinanceSlOrder` OK.
     Assert `managementAction === "PARTIAL_TP1"`, `tp1Reached === true`,
     `newStopLoss !== null`. Verify `updateBinanceSlOrder` được gọi.
   - `"retry: fail lan 1 khong lam tp1ClosedPercent tang, cho phep vao lai nhanh doi SL o lan goi thu 2"`:
     gọi `reconcileBinancePosition` với `tp1ClosedPercent: 0` (mô phỏng DB chưa bị ghi
     sai vì fix bước 3) 2 lần liên tiếp — lần 1 fail (assert kết quả như case đầu), lần 2
     mock lại để thành công — assert lần 2 KHÔNG bị guard `alreadyPartial` chặn (verify
     `getOrderStatus` cho TP1 order id được gọi ở CẢ 2 lần, tức code có chạy vào nhánh dời
     SL cả 2 lần).
   - `"close_failed + getPositionAmount tra 0 -> CLOSE"`.
   - `"close_failed + getPositionAmount khac 0 -> HOLD va gui alert"`.
   - `"close_failed + getPositionAmount tra Error -> HOLD, khong gui CLOSE"`.
3. Thêm test cho Finding 3 trong describe `"guard cross-system"` đã có sẵn: thêm case
   `"getPositionAmount tra Error -> fail-closed, khong mo lenh, co gui alert"` — mock
   `getPositionAmount` trả `new Error("api down")`, assert `placeMarketOrder` KHÔNG được
   gọi, `sendMessage` được gọi với nội dung chứa "không xác minh được vị thế".
4. Thêm test cho Finding 2 (đặt trong describe mới hoặc describe hiện có phù hợp):
   - `"dat SL/TP fail + dong khan cap fail -> saveBinanceExecutionDetails ghi close_failed"`.
   - `"dat SL/TP fail + dong khan cap OK -> saveBinanceExecutionDetails van ghi failed"` (regression).

Nếu `tests/charts/positions-repository-smc.test.ts` có test liên quan đến
`binanceExecutionStatus`/`saveBinanceExecutionDetails`, kiểm tra không bị lỗi type sau
khi mở rộng union — chỉ sửa nếu build/test báo lỗi type, không cần thêm test case mới bắt
buộc ở file này trừ khi thấy cần thiết để cover Finding 2.

## Acceptance criteria

- `npm run build` pass, không có lỗi TypeScript.
- `npx vitest run tests/charts/binance-execution-smc.test.ts tests/charts/positions-repository-smc.test.ts` pass toàn bộ, bao gồm mọi test case liệt kê ở Bước 5.
- Không có test nào bị xoá/skip để né lỗi.
- Diff chỉ nằm trong 4 file được phép sửa ở đầu task này.

## Out of scope

- KHÔNG sửa Volman (task 02).
- KHÔNG gộp code chung giữa SMC/Volman (task 03).
- KHÔNG thêm migration SQL.
- KHÔNG sửa `check-open-trades-runner-smc.ts`, `position-engine-smc.ts`.
- KHÔNG fix Findings phụ #2, #3 (side-effect trước persist, FINISHED/algoStatus) — đã
  quyết định deferred, xem context.md.

## Output

Ghi kết quả vào `tasks/fix-binance-execution-review/01-fix-smc-execution-logic/result.md`:
liệt kê từng thay đổi đã thực hiện (map với bước 1-5 ở trên), output đầy đủ của
`npm run build` và `npx vitest run ...` (copy full test summary), và list diff file. Nếu
bị chặn, ghi `blocked.md` thay vì đoán.
