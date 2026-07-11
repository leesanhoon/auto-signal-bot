# Task 05: Đối chiếu order status Binance mỗi lần check-open-trades

## Bối cảnh

**Phụ thuộc: task 01, 02 phải xong trước** (cần `binance-futures-client.ts` và cột/hàm mới trong `positions-repository-volman.ts`). Có thể làm song song với task 04 (khác phần trong cùng file `binance-execution-volman.ts` — nếu task 04 đã tạo file này, chỉ THÊM hàm mới vào cuối, không sửa hàm `openBinanceFuturesPosition` đã có).

Hiện tại `check-open-trades-runner-volman.ts` → `evaluateOpenPosition()` (dòng 16-36) luôn đọc lại nến (candle high/low) để suy luận SL/TP1/TP2 có bị chạm không. Với vị thế đã đặt lệnh thật trên Binance (`position.binanceSymbol` khác null), **Binance là nguồn sự thật** — SL/TP là lệnh `STOP_MARKET`/`TAKE_PROFIT_MARKET` thật, nên phải hỏi **trạng thái lệnh thật** thay vì suy luận từ nến (tránh 2 nguồn sự thật xung đột: candle có thể chưa cập nhật kịp trong khi lệnh trên sàn đã khớp real-time).

Nguyên tắc: hàm mới `reconcileBinancePosition()` phải trả về đúng type `PositionDecisionOutcome` (định nghĩa trong `src/charts/position-engine-volman.ts`) để toàn bộ pipeline downstream (`buildPositionManagementPatch`, `updatePositionDecision`, `closePosition`, Telegram message) chạy y nguyên không cần sửa gì.

## Việc cần làm

### File 1: `src/charts/binance-execution-volman.ts` (sửa — THÊM vào cuối file, không đổi code đã có)

Thêm các import sau vào đầu file (gộp vào các import đã có nếu cùng nguồn, ví dụ nếu `binance-futures-client.js` đã được import ở task 04 thì thêm tên hàm vào cùng dòng import đó):

```ts
import {
  cancelOrder,
  getOrderStatus,
  placeStopMarketOrder,
} from "./binance-futures-client.js";
import { updateBinanceSlOrder } from "./positions-repository-volman.js";
import type { PositionDecisionOutcome } from "./position-engine-volman.js";
import type { OpenPosition } from "./positions-repository-volman.js";
```

Thêm hàm mới vào cuối file:

```ts
export async function reconcileBinancePosition(
  position: OpenPosition,
): Promise<PositionDecisionOutcome> {
  const symbol = position.binanceSymbol as string;
  const alreadyPartial = (position.tp1ClosedPercent ?? 0) > 0;

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
      if (position.binanceSlOrderId) {
        await cancelOrder(symbol, position.binanceSlOrderId);
      }
      const entryPrice = Number(position.entry);
      const newSl = await placeStopMarketOrder(symbol, closeSide, entryPrice);
      if (!(newSl instanceof Error)) {
        await updateBinanceSlOrder(position.id, newSl.orderId, position.entry);
      } else {
        logger.error("Khong the dat lai SL ve breakeven sau TP1", {
          pair: position.pair,
          id: position.id,
          error: newSl,
        });
      }
      return {
        decision: "HOLD",
        confidence: 90,
        comment: "TP1 đã khớp trên Binance Futures, dời SL về breakeven",
        managementAction: "PARTIAL_TP1",
        partialClosePercent: position.tp1ClosePercent ?? 50,
        newStopLoss: position.entry,
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

### File 2: `src/charts/check-open-trades-runner-volman.ts` (sửa)

1. Thêm import ở đầu file:
```ts
import { reconcileBinancePosition } from "./binance-execution-volman.js";
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

## Ràng buộc

- KHÔNG sửa `position-engine-volman.ts` (logic `deriveManagementPatch`, `calculateRiskRewardPlan`...) — hàm mới CHỈ trả về type `PositionDecisionOutcome` có sẵn để tái dùng nguyên logic downstream.
- KHÔNG sửa `processPosition()`/`runCheckOpenTrades()` trong `check-open-trades-runner-volman.ts` — chỉ sửa `evaluateOpenPosition()`.
- KHÔNG đổi hành vi cho position không có `binanceSymbol` (forex/commodity) — luồng candle-based phải chạy y hệt trước đây.
- Nếu task 04 đã tạo `binance-execution-volman.ts` với hàm `openBinanceFuturesPosition`, KHÔNG được xoá hay sửa hàm đó — chỉ thêm hàm `reconcileBinancePosition` mới vào cuối file.

## Cách verify

```bash
npm run build
npm run test
```
`tests/charts/check-open-trades-runner-volman.test.ts` (nếu có) không được fail cho các case forex/commodity hiện có (không có `binanceSymbol`).

## Output

Ghi vào `tasks/binance-futures-execution/05-position-reconciliation/result.md`:
- Đoạn code đã thêm vào `binance-execution-volman.ts`
- Diff đã sửa trong `check-open-trades-runner-volman.ts`
- Kết quả `npm run build && npm run test`

Nếu bị chặn (ví dụ `OpenPosition` type ở task 02 chưa có field `binanceSymbol`/`binanceSlOrderId`/... đúng tên) → ghi `blocked.md`.
