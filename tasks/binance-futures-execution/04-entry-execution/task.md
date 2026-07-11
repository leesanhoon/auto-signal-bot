# Task 04: Đặt lệnh entry+SL+TP1+TP2 khi mở vị thế + wiring vào `index.ts`

## Bối cảnh

**Phụ thuộc: task 01, 02, 03 phải xong trước** (cần `binance-futures-client.ts`, `binance-futures-config-env.ts`, `binance-position-sizing.ts`, và cột/hàm mới trong `positions-repository-volman.ts`).

Vị thế Volman "mở" trong DB tại `src/charts/index.ts:212` (`const saved = await saveOpenPosition(setup);`), bên trong hàm `handleAnalysisResult()`, nhánh `shouldAutoTrackAsOpen(setup, threshold)` (dòng ~200-224). Biến `symbolByPair: Map<string, string>` đã tồn tại sẵn trong scope của hàm này (dòng 170-174), map `setup.pair` → chart symbol dạng `"BINANCE:BTCUSDT"` hoặc `"OANDA:EURUSD"`.

Task này: (1) viết hàm `openBinanceFuturesPosition()` orchestrate toàn bộ việc đặt lệnh thật, (2) gọi hàm đó ngay sau khi `saveOpenPosition` thành công, CHỈ với symbol Binance.

## Việc cần làm

### File 1: `src/charts/binance-execution-volman.ts` (tạo mới — chỉ phần entry, KHÔNG viết `reconcileBinancePosition` ở task này, để task 05 làm)

```ts
import { toBinanceSymbol } from "./ohlc-provider.js";
import {
  getExchangeInfoFilters,
  getAvailableBalanceUsdt,
  setMarginType,
  setLeverage,
  placeMarketOrder,
  placeStopMarketOrder,
  placeTakeProfitMarketOrder,
  getPositionAmount,
} from "./binance-futures-client.js";
import {
  getConfiguredBinanceLeverage,
  getConfiguredBinanceMarginType,
  getConfiguredBinanceRiskPercentPerTrade,
} from "./binance-futures-config-env.js";
import { computeOrderQuantity } from "./binance-position-sizing.js";
import { calculateRiskRewardPlan } from "./position-engine-volman.js";
import { saveBinanceExecutionDetails } from "./positions-repository-volman.js";
import { sendMessage } from "../shared/telegram-client.js";
import { createLogger } from "../shared/logger.js";
import type { TradeSetup } from "./chart-types-volman.js";

const logger = createLogger("charts:binance-execution");

export async function openBinanceFuturesPosition(
  setup: TradeSetup,
  positionId: number,
  chartSymbol: string,
): Promise<void> {
  const binanceSymbol = toBinanceSymbol(chartSymbol);
  if (!binanceSymbol) {
    logger.warn("Symbol khong phai Binance, bo qua execution", {
      pair: setup.pair,
      chartSymbol,
    });
    return;
  }

  const plan = calculateRiskRewardPlan(setup);
  if (!plan) {
    logger.error("Khong tinh duoc RiskRewardPlan cho execution", {
      pair: setup.pair,
      positionId,
    });
    return;
  }

  const leverage = getConfiguredBinanceLeverage();
  const marginType = getConfiguredBinanceMarginType();
  const riskPercent = getConfiguredBinanceRiskPercentPerTrade();
  const side: "BUY" | "SELL" = setup.direction === "LONG" ? "BUY" : "SELL";
  const closeSide: "BUY" | "SELL" = side === "BUY" ? "SELL" : "BUY";

  try {
    const filters = await getExchangeInfoFilters(binanceSymbol);
    if (filters instanceof Error) throw filters;

    const balance = await getAvailableBalanceUsdt();
    if (balance instanceof Error) throw balance;

    const sizing = computeOrderQuantity({
      balanceUsdt: balance,
      riskPercent,
      entry: plan.entry,
      stopLoss: plan.stopLoss,
      leverage,
      filters,
    });
    if (sizing instanceof Error) throw sizing;

    const marginResult = await setMarginType(binanceSymbol, marginType);
    if (marginResult instanceof Error) throw marginResult;

    const leverageResult = await setLeverage(binanceSymbol, leverage);
    if (leverageResult instanceof Error) throw leverageResult;

    const entryOrder = await placeMarketOrder(binanceSymbol, side, sizing.quantity);
    if (entryOrder instanceof Error) throw entryOrder;

    // Tu day tro di, vi the DA THAT SU MO tren Binance — moi loi phai duoc
    // fail-safe dong lai ngay, khong duoc de vi the "tran" (khong co SL).
    try {
      const slOrder = await placeStopMarketOrder(
        binanceSymbol,
        closeSide,
        plan.stopLoss,
      );
      if (slOrder instanceof Error) throw slOrder;

      const tp1Quantity = Number(
        (sizing.quantity * (plan.partialClosePercent / 100)).toFixed(8),
      );
      const tp2Quantity = Number((sizing.quantity - tp1Quantity).toFixed(8));

      const tp1Order = await placeTakeProfitMarketOrder(
        binanceSymbol,
        closeSide,
        plan.takeProfit1,
        tp1Quantity,
      );
      if (tp1Order instanceof Error) throw tp1Order;

      let tp2OrderId: number | null = null;
      if (plan.takeProfit2 !== null && tp2Quantity > 0) {
        const tp2Order = await placeTakeProfitMarketOrder(
          binanceSymbol,
          closeSide,
          plan.takeProfit2,
          tp2Quantity,
        );
        if (tp2Order instanceof Error) throw tp2Order;
        tp2OrderId = tp2Order.orderId;
      }

      await saveBinanceExecutionDetails(positionId, {
        binanceSymbol,
        binanceLeverage: leverage,
        binanceQuantity: sizing.quantity,
        binanceEntryOrderId: entryOrder.orderId,
        binanceSlOrderId: slOrder.orderId,
        binanceTp1OrderId: tp1Order.orderId,
        binanceTp2OrderId: tp2OrderId,
        binanceExecutionStatus: "placed",
      });

      await sendMessage(
        `✅ *Binance Futures* — Đã mở vị thế thật ${setup.direction} ${binanceSymbol}\nQty: ${sizing.quantity} | Leverage: ${leverage}x\nEntry: ${plan.entry} | SL: ${plan.stopLoss} | TP1: ${plan.takeProfit1} | TP2: ${plan.takeProfit2 ?? "-"}`,
      );
    } catch (protectionError) {
      // Dat SL/TP that bai sau khi entry da fill -> dong ngay vi the de tranh
      // vi the tran khong co bao ve.
      logger.error("Dat SL/TP that bai sau entry, dong vi the fail-safe", {
        pair: setup.pair,
        positionId,
        error: protectionError,
      });

      const positionAmt = await getPositionAmount(binanceSymbol);
      const qtyToClose =
        !(positionAmt instanceof Error) && positionAmt !== 0
          ? Math.abs(positionAmt)
          : sizing.quantity;

      await placeMarketOrder(binanceSymbol, closeSide, qtyToClose, {
        reduceOnly: true,
      });

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

      await sendMessage(
        `🚨 *Binance Futures* — LỖI khi đặt SL/TP cho ${binanceSymbol}, đã đóng khẩn cấp vị thế để tránh rủi ro không kiểm soát.\nLỗi: ${protectionError instanceof Error ? protectionError.message : String(protectionError)}`,
      );
    }
  } catch (error) {
    logger.error("Khong the mo vi the Binance Futures", {
      pair: setup.pair,
      positionId,
      error,
    });
    await sendMessage(
      `❌ *Binance Futures* — Không thể mở vị thế thật cho ${binanceSymbol} (${setup.direction}).\nLỗi: ${error instanceof Error ? error.message : String(error)}\nVị thế vẫn được track trong hệ thống (chỉ signal), không có lệnh thật trên sàn.`,
    );
  }
}
```

### File 2: `src/charts/index.ts` (sửa)

1. Thêm import ở đầu file (cạnh các import khác, sau dòng `import { CHARTS, getChartsForTimeframeMode } from "./volman-charts.config.js";`):

```ts
import { openBinanceFuturesPosition } from "./binance-execution-volman.js";
import { isBinanceLiveTradingEnabled } from "./binance-futures-config-env.js";
import { findOpenPositionIdByPair } from "./positions-repository-volman.js";
```

Lưu ý: `saveOpenPosition` đã được import từ `positions-repository-volman.js` ở dòng 2 — thêm `findOpenPositionIdByPair` vào CÙNG import đó (gộp lại thành 1 dòng import, không tạo 2 dòng import riêng từ cùng 1 file):
```ts
import { saveOpenPosition, findOpenPositionIdByPair /*, savePendingOrder */ } from "./positions-repository-volman.js";
```

2. Trong nhánh `if (shouldAutoTrackAsOpen(setup, threshold))` (khoảng dòng 202-224), ngay sau đoạn:
```ts
        const saved = await saveOpenPosition(setup);
        if (saved) {
          setup.autoTracked = true;
          logger.info("Auto-saved open position", { pair: setup.pair });
        } else {
```
Thêm code gọi Binance execution vào NGAY sau `logger.info("Auto-saved open position", ...)` (bên trong khối `if (saved) { ... }`, thêm dòng mới sau logger.info, TRƯỚC dấu `}` đóng khối if):

```ts
          if (isBinanceLiveTradingEnabled()) {
            const chartSymbol = symbolByPair.get(setup.pair);
            if (chartSymbol) {
              const positionId = await findOpenPositionIdByPair(setup.pair);
              if (positionId !== null) {
                await openBinanceFuturesPosition(setup, positionId, chartSymbol);
              }
            }
          }
```

Kết quả khối `if (saved) { ... }` sau khi sửa:
```ts
        if (saved) {
          setup.autoTracked = true;
          logger.info("Auto-saved open position", { pair: setup.pair });
          if (isBinanceLiveTradingEnabled()) {
            const chartSymbol = symbolByPair.get(setup.pair);
            if (chartSymbol) {
              const positionId = await findOpenPositionIdByPair(setup.pair);
              if (positionId !== null) {
                await openBinanceFuturesPosition(setup, positionId, chartSymbol);
              }
            }
          }
        } else {
```

## Ràng buộc

- KHÔNG sửa logic `shouldAutoTrackAsOpen`, `validateTradeSetupForOpen`, hay bất kỳ điều kiện auto-track nào khác.
- KHÔNG đụng vào nhánh `else if` (pending order, đang bị disable có chủ đích — xem `tasks/disable-pending-orders/plan.md`).
- `openBinanceFuturesPosition` PHẢI không bao giờ throw ra ngoài (đã có try/catch bọc toàn bộ trong code mẫu) — nếu lỗi Binance xảy ra, KHÔNG được làm crash hay dừng vòng lặp xử lý các setup khác trong `handleAnalysisResult`.
- Không thêm cấu hình/feature ngoài scope liệt kê ở trên.

## Cách verify

```bash
npm run build
npm run test
```
`tests/charts/index.test.ts` (nếu có) không được fail — nếu test mock `saveOpenPosition`/`findOpenPositionIdByPair`, cần đảm bảo `isBinanceLiveTradingEnabled()` mặc định `false` trong môi trường test (không set env `BINANCE_LIVE_TRADING_ENABLED`) nên nhánh Binance sẽ không chạy, không cần mock thêm gì mới.

## Output

Ghi vào `tasks/binance-futures-execution/04-entry-execution/result.md`:
- Đường dẫn file mới + đoạn diff đã sửa trong `index.ts`
- Kết quả `npm run build && npm run test`

Nếu bị chặn (ví dụ không tìm thấy đúng đoạn code dòng 200-224 như mô tả do file đã đổi khác) → đọc lại file thực tế, tìm đúng vị trí tương đương (nhánh `if (shouldAutoTrackAsOpen(...))` gọi `saveOpenPosition`), áp dụng đúng logic mô tả. Nếu vẫn không xác định được → ghi `blocked.md`.
