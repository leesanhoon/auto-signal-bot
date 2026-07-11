# Task 04: Đối chiếu order status Binance mỗi lần check-open-trades (SMC)

## Bối cảnh

**Phụ thuộc: task 01, 02 phải xong trước, và task 03 phải xong trước** (file `binance-execution-smc.ts` phải đã tồn tại với hàm `openBinanceFuturesPosition` — task này CHỈ THÊM hàm mới vào cuối file, KHÔNG sửa hàm đã có. Không làm song song với task 03 vì cùng sửa 1 file).

Hiện tại `check-open-trades-runner-smc.ts` → `evaluateOpenPosition()` (dòng 16-36) luôn đọc lại nến (candle high/low) để suy luận SL/TP1/TP2 có bị chạm không. Với vị thế đã đặt lệnh thật trên Binance (`position.binanceSymbol` khác null), **Binance là nguồn sự thật** — phải hỏi trạng thái lệnh thật thay vì suy luận từ nến.

Nguyên tắc: hàm mới `reconcileBinancePosition()` phải trả về đúng type `PositionDecisionOutcome` (định nghĩa trong `src/charts/position-engine-smc.ts`) để toàn bộ pipeline downstream (`buildPositionManagementPatch`, `updatePositionDecision`, `closePosition`, Telegram message) chạy y nguyên không cần sửa gì.

## Việc cần làm

### File 1: `src/charts/binance-execution-smc.ts` (sửa — THÊM vào cuối file, không đổi code đã có ở task 03)

Thêm các import sau vào đầu file (gộp vào import đã có từ `binance-futures-client.js` nếu trùng nguồn — thêm tên hàm vào cùng dòng import đó thay vì tạo dòng mới):

```ts
import {
  cancelOrder,
  getOrderStatus,
  getExchangeInfoFilters,
  placeStopMarketOrder,
} from "./binance-futures-client.js";
import { roundToTickSize } from "./binance-position-sizing.js";
import { updateBinanceSlOrder } from "./positions-repository-smc.js";
import type { PositionDecisionOutcome } from "./position-engine-smc.js";
import type { OpenPosition } from "./positions-repository-smc.js";
```

Thêm hàm mới vào cuối file:

```ts
export async function reconcileBinancePosition(
  position: OpenPosition,
): Promise<PositionDecisionOutcome> {
  const symbol = position.binanceSymbol as string;
  const alreadyPartial = (position.tp1ClosedPercent ?? 0) > 0;

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

  if (position.binanceSlOrderId) {
    const slStatus = await getOrderStatus(symbol, position.binanceSlOrderId);
    if (!(slStatus instanceof Error) && slStatus.status === "FILLED") {
      if (position.binanceTp1OrderId) {
        await cancelOrder(symbol, position.binanceTp1OrderId);
      }
      if (position.binanceTp2OrderId) {
        await cancelOrder(symbol, position.binanceTp2OrderId);
      }
      return {
        decision: "STOP",
        confidence: 100,
        comment: "SL đã khớp trên Binance Futures",
        managementAction: "NONE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: alreadyPartial,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }
  }

  if (position.binanceTp2OrderId) {
    const tp2Status = await getOrderStatus(symbol, position.binanceTp2OrderId);
    if (!(tp2Status instanceof Error) && tp2Status.status === "FILLED") {
      if (position.binanceSlOrderId) {
        await cancelOrder(symbol, position.binanceSlOrderId);
      }
      return {
        decision: "CLOSE",
        confidence: 100,
        comment: "TP2 đã khớp trên Binance Futures",
        managementAction: "TP2_CLOSE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: true,
        tp2Reached: true,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }
  }

  if (!alreadyPartial && position.binanceTp1OrderId) {
    const tp1Status = await getOrderStatus(symbol, position.binanceTp1OrderId);
    if (!(tp1Status instanceof Error) && tp1Status.status === "FILLED") {
      const closeSide: "BUY" | "SELL" =
        position.direction === "LONG" ? "SELL" : "BUY";

      // THU TU BAT BUOC: dat SL moi o breakeven TRUOC, huy SL cu SAU.
      // Neu dat SL moi fail -> SL cu van con, vi the luon co bao ve
      // (Binance cho phep 2 lenh STOP_MARKET closePosition=true cung ton tai).
      // Gia breakeven cung phai lam tron tickSize nhu moi stopPrice khac.
      const filters = await getExchangeInfoFilters(symbol);
      const entryPrice = Number(position.entry);
      const bePrice =
        filters instanceof Error
          ? entryPrice
          : roundToTickSize(entryPrice, filters.tickSize);

      const newSl = await placeStopMarketOrder(symbol, closeSide, bePrice);
      if (!(newSl instanceof Error)) {
        if (position.binanceSlOrderId) {
          await cancelOrder(symbol, position.binanceSlOrderId);
        }
        await updateBinanceSlOrder(position.id, newSl.orderId, String(bePrice));
      } else {
        // SL cu van con nguyen tren san — vi the van co bao ve o SL goc,
        // lan check sau se thu dat lai BE. Chi log, khong lam gi them.
        logger.error(
          "Khong the dat SL breakeven sau TP1 — giu nguyen SL cu, thu lai lan sau",
          {
            pair: position.pair,
            id: position.id,
            error: newSl,
          },
        );
      }
      // newStopLoss chi duoc bao ve BE khi lenh SL moi THAT SU dat thanh cong —
      // neu fail, SL that tren san van o gia goc, DB khong duoc ghi sai.
      const slMovedToBe = !(newSl instanceof Error);
      return {
        decision: "HOLD",
        confidence: 90,
        comment: slMovedToBe
          ? "TP1 đã khớp trên Binance Futures, dời SL về breakeven"
          : "TP1 đã khớp trên Binance Futures, dời SL về breakeven THẤT BẠI — SL vẫn ở giá gốc, sẽ thử lại lần check sau",
        managementAction: "PARTIAL_TP1",
        partialClosePercent: position.tp1ClosePercent ?? 50,
        newStopLoss: slMovedToBe ? String(bePrice) : null,
        tp1Reached: true,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }
  }

  return {
    decision: "HOLD",
    confidence: 100,
    comment: "Vị thế đang mở trên Binance Futures, chưa có lệnh SL/TP nào khớp",
    managementAction: "NONE",
    partialClosePercent: 0,
    newStopLoss: null,
    tp1Reached: alreadyPartial,
    tp2Reached: false,
    riskReward: null,
    tp1RiskReward: null,
    tp2RiskReward: null,
  };
}
```

### File 2: `src/charts/check-open-trades-runner-smc.ts` (sửa)

1. Thêm import ở đầu file:
```ts
import { reconcileBinancePosition } from "./binance-execution-smc.js";
```

2. Sửa hàm `evaluateOpenPosition` (dòng 16-36): thêm nhánh rẽ ngay đầu hàm — nếu `position.binanceSymbol` có giá trị, gọi `reconcileBinancePosition` thay vì luồng candle-based cũ. Nội dung hàm sau khi sửa:

```ts
async function evaluateOpenPosition(
  position: Awaited<ReturnType<typeof loadOpenPositions>>[number],
): Promise<PositionDecisionOutcome> {
  if (position.binanceSymbol) {
    return reconcileBinancePosition(position);
  }

  const chart = findChartForPair(CHARTS, position.pair, "H4");
  if (!chart) {
    logger.warn("No chart configuration found; sending explicit warning", { pair: position.pair, id: position.id });
    await sendMessage(
      `⚠️ *Check Open Trades*\n\nKhông tìm thấy cấu hình chart cho vị thế #${position.id} ${position.pair}.\nBot tạm giữ vị thế nhưng không thể xác minh SL/TP trong lượt này. Vui lòng kiểm tra cấu hình chart / mapping pair.`,
    );
    return resolveOpenPositionDecision(position, null, "missing_chart_config");
  }

  const stats = await fetchCandleRangeStats(chart.symbol, new Date(position.openedAt).getTime());
  if (stats === null) {
    logger.warn("Failed to fetch OHLC for open position; sending explicit warning", { pair: position.pair, id: position.id });
    await sendMessage(
      `⚠️ *Check Open Trades*\n\nKhông lấy được OHLC để kiểm tra vị thế #${position.id} ${position.pair}.\nBot tạm giữ vị thế nhưng không thể xác minh SL/TP trong lượt này. Vui lòng kiểm tra dữ liệu thị trường / nguồn chart.`,
    );
  }
  return resolveOpenPositionDecision(position, stats);
}
```

(Toàn bộ phần sau nhánh rẽ mới giữ NGUYÊN 100% code cũ đã có — chỉ thêm 3 dòng `if (position.binanceSymbol) { return reconcileBinancePosition(position); }` vào đầu hàm.)

Lưu ý giới hạn đã chấp nhận (không cần xử lý thêm): nếu giữa 2 lần cron cả TP1 lẫn SL cùng khớp, reconcile sẽ báo `STOP` với `tp1Reached` theo DB (chưa kịp cập nhật TP1) — PnL trong DB lệch nhẹ so với thật. Trade-off có chủ đích, kế thừa từ plan gốc (không ghi nhận giá khớp thật).

## Ràng buộc

- Tuân thủ "Quy tắc fail-safe bất biến" trong `tasks/binance-futures-execution-smc/plan.md`: đặt SL breakeven mới TRƯỚC rồi mới hủy SL cũ; giá breakeven phải qua `roundToTickSize`; status `"failed"` phải trả `CLOSE` để đóng bản ghi DB.
- KHÔNG sửa `position-engine-smc.ts` (logic `deriveManagementPatch`, `calculateRiskRewardPlan`...) — hàm mới CHỈ trả về type `PositionDecisionOutcome` có sẵn để tái dùng nguyên logic downstream.
- KHÔNG sửa `processPosition()`/`runCheckOpenTrades()` trong `check-open-trades-runner-smc.ts` — chỉ sửa `evaluateOpenPosition()`.
- KHÔNG đổi hành vi cho position không có `binanceSymbol` (forex/commodity) — luồng candle-based phải chạy y hệt trước đây.
- KHÔNG được xoá hay sửa hàm `openBinanceFuturesPosition` đã có trong `binance-execution-smc.ts` (task 03) — chỉ thêm hàm `reconcileBinancePosition` mới vào cuối file.
- KHÔNG đụng `check-open-trades-runner-volman.ts` hay `binance-execution-volman.ts`.

## Cách verify

```bash
npm run build
npm run test
```
`tests/charts/check-open-trades-runner-smc.test.ts` (nếu có) không được fail cho các case forex/commodity hiện có (không có `binanceSymbol`).

## Output

Ghi vào `tasks/binance-futures-execution-smc/04-position-reconciliation-smc/result.md`:
- Đoạn code đã thêm vào `binance-execution-smc.ts`
- Diff đã sửa trong `check-open-trades-runner-smc.ts`
- Kết quả `npm run build && npm run test`

Nếu bị chặn (ví dụ `OpenPosition` type ở task 01 chưa có field `binanceSymbol`/`binanceSlOrderId`/... đúng tên) → ghi `blocked.md`.
