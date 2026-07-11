# Task 03: Tạo `binance-execution-smc.ts` (entry + guard) + wiring vào `smc-index.ts`

## Bối cảnh

**Phụ thuộc: task 01, 02 phải xong trước** (cần cột/hàm mới trong `positions-repository-smc.ts` từ task 01, và `isBinanceLiveTradingEnabledSmc()` từ `binance-futures-config-env.ts` ở task 02).

Vị thế SMC "mở" trong DB tại `src/charts/smc-index.ts` (hàm `handleAnalysisResult()`, nhánh `if (shouldAutoTrackAsOpen(setup, threshold))`, khoảng dòng 147-164):
```ts
  for (const setup of result.setups) {
    if (shouldAutoTrackAsOpen(setup, threshold)) {
      try {
        const validation = validateTradeSetupForOpen(setup);
        if (!validation.accepted) {
          logger.info("Skipped open position due to risk/reward gate", { pair: setup.pair, reason: validation.reason });
          continue;
        }
        const saved = await saveOpenPosition(setup);
        if (saved) {
          setup.autoTracked = true;
          logger.info("Auto-saved open position", { pair: setup.pair });
        } else {
          logger.info("Skipped duplicate open position", { pair: setup.pair });
        }
      } catch (error) {
        logger.error("Failed to auto-save open position", { pair: setup.pair, error });
      }
    } else if (...) { ... }
  }
```
Biến `symbolByPair: Map<string, string>` đã tồn tại sẵn trong scope hàm này (khai báo `const symbolByPair = new Map(getPairs().map((p) => [p.pair, p.symbol]));` ở đầu `handleAnalysisResult`), map `setup.pair` → chart symbol dạng `"BINANCE:BTCUSDT"` hoặc `"OANDA:EURUSD"`.

File này (`binance-execution-smc.ts`) là bản song song của `binance-execution-volman.ts` (đã APPROVED, test kỹ trên testnet) — copy đúng kiến trúc, đổi import sang module `-smc`, và **thêm guard cross-system** (task 02 đã làm phần guard cho Volman; task này làm phần guard cho SMC, dùng chung `getPositionAmount`).

## Việc cần làm

### File 1: `src/charts/binance-execution-smc.ts` (tạo mới — chỉ phần entry, KHÔNG viết `reconcileBinancePosition` ở task này, để task 04 làm)

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
  cancelOrder,
  isHedgeModeEnabled,
} from "./binance-futures-client.js";
import {
  getConfiguredBinanceLeverage,
  getConfiguredBinanceMarginType,
  getConfiguredBinanceRiskPercentPerTrade,
} from "./binance-futures-config-env.js";
import {
  computeOrderQuantity,
  roundToTickSize,
  splitTpQuantities,
} from "./binance-position-sizing.js";
import { calculateRiskRewardPlan } from "./position-engine-smc.js";
import { saveBinanceExecutionDetails } from "./positions-repository-smc.js";
import { sendMessage } from "../shared/telegram-client.js";
import { createLogger } from "../shared/logger.js";
import type { TradeSetup } from "./chart-types-smc.js";

const logger = createLogger("charts:binance-execution-smc");

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
    // Plan nay CHI ho tro One-way mode — lenh khong gui positionSide se fail -4061
    // neu account dang o Hedge mode. Kiem tra TRUOC khi dat bat ky lenh nao.
    const hedgeMode = await isHedgeModeEnabled();
    if (hedgeMode instanceof Error) throw hedgeMode;
    if (hedgeMode) {
      throw new Error(
        "Tai khoan Binance Futures dang o Hedge mode — bot chi ho tro One-way mode. Doi Position Mode ve One-way trong Binance truoc khi bat live trading.",
      );
    }

    // Guard cross-system: 1 symbol chi 1 vi the tai 1 thoi diem, he nao mo truoc
    // thi giu. SL/TP dat closePosition=true se dong toan bo net position cua symbol
    // tren san — neu he khac (Volman) da co vi the mo tren cung symbol, KHONG duoc
    // mo them (xem plan.md muc "Kien truc quyet dinh #1").
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

    const filters = await getExchangeInfoFilters(binanceSymbol);
    if (filters instanceof Error) throw filters;

    // Moi gia stopPrice gui len Binance PHAI lam tron theo tickSize — gia tho tu
    // SMC engine se bi Binance tu choi (loi price precision -1111/-4014).
    const slPrice = roundToTickSize(plan.stopLoss, filters.tickSize);
    const tp1Price = roundToTickSize(plan.takeProfit1, filters.tickSize);
    const tp2Price =
      plan.takeProfit2 !== null
        ? roundToTickSize(plan.takeProfit2, filters.tickSize)
        : null;

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

    // Chia qty TP1/TP2 khop stepSize (toFixed(8) tho se dinh loi LOT_SIZE)
    const { tp1Quantity, tp2Quantity } = splitTpQuantities(
      sizing.quantity,
      plan.partialClosePercent,
      filters.stepSize,
    );

    const marginResult = await setMarginType(binanceSymbol, marginType);
    if (marginResult instanceof Error) throw marginResult;

    const leverageResult = await setLeverage(binanceSymbol, leverage);
    if (leverageResult instanceof Error) throw leverageResult;

    const entryOrder = await placeMarketOrder(binanceSymbol, side, sizing.quantity);
    if (entryOrder instanceof Error) throw entryOrder;

    // Tu day tro di, vi the DA THAT SU MO tren Binance — moi loi khi dat SL/TP
    // phai duoc fail-safe dong lai ngay, khong duoc de vi the "tran" (khong co SL).
    const placedProtectionOrders: number[] = [];
    let slOrderId: number | null = null;
    let tp1OrderId: number | null = null;
    let tp2OrderId: number | null = null;

    try {
      const slOrder = await placeStopMarketOrder(binanceSymbol, closeSide, slPrice);
      if (slOrder instanceof Error) throw slOrder;
      slOrderId = slOrder.orderId;
      placedProtectionOrders.push(slOrder.orderId);

      const tp1Order = await placeTakeProfitMarketOrder(
        binanceSymbol,
        closeSide,
        tp1Price,
        tp1Quantity,
      );
      if (tp1Order instanceof Error) throw tp1Order;
      tp1OrderId = tp1Order.orderId;
      placedProtectionOrders.push(tp1Order.orderId);

      if (tp2Price !== null && tp2Quantity > 0) {
        const tp2Order = await placeTakeProfitMarketOrder(
          binanceSymbol,
          closeSide,
          tp2Price,
          tp2Quantity,
        );
        if (tp2Order instanceof Error) throw tp2Order;
        tp2OrderId = tp2Order.orderId;
        placedProtectionOrders.push(tp2Order.orderId);
      }
    } catch (protectionError) {
      // FAIL-SAFE: entry da fill nhung khong dat du bo SL/TP -> dong ngay vi the.
      logger.error("Dat SL/TP that bai sau entry, dong vi the fail-safe", {
        pair: setup.pair,
        positionId,
        error: protectionError,
      });

      for (const orderId of placedProtectionOrders) {
        const cancelResult = await cancelOrder(binanceSymbol, orderId);
        if (cancelResult instanceof Error) {
          logger.error("Khong huy duoc lenh conditional trong fail-safe", {
            binanceSymbol,
            orderId,
            error: cancelResult,
          });
        }
      }

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

      const protectionMessage =
        protectionError instanceof Error
          ? protectionError.message
          : String(protectionError);
      if (closeResult instanceof Error) {
        await sendMessage(
          `🚨🚨 *Binance Futures (SMC) — KHẨN CẤP* — ${binanceSymbol}: đặt SL/TP thất bại VÀ lệnh đóng khẩn cấp CŨNG THẤT BẠI.\n⚠️ VỊ THẾ ĐANG MỞ KHÔNG CÓ SL — mở Binance app và ĐÓNG TAY NGAY.\nLỗi đặt SL/TP: ${protectionMessage}\nLỗi đóng: ${closeResult.message}`,
        );
      } else {
        await sendMessage(
          `🚨 *Binance Futures (SMC)* — LỖI khi đặt SL/TP cho ${binanceSymbol}, đã hủy các lệnh treo và đóng khẩn cấp vị thế.\nLỗi: ${protectionMessage}`,
        );
      }
      return;
    }

    // Vi the da co du SL/TP tren san. Loi DB tu day tro di KHONG duoc kich hoat
    // dong khan cap — vi the tren san van khoe manh, chi can alert de user biet.
    try {
      await saveBinanceExecutionDetails(positionId, {
        binanceSymbol,
        binanceLeverage: leverage,
        binanceQuantity: sizing.quantity,
        binanceEntryOrderId: entryOrder.orderId,
        binanceSlOrderId: slOrderId,
        binanceTp1OrderId: tp1OrderId,
        binanceTp2OrderId: tp2OrderId,
        binanceExecutionStatus: "placed",
      });
    } catch (dbError) {
      logger.error("Vi the da mo + du SL/TP tren Binance nhung khong ghi duoc DB", {
        positionId,
        error: dbError,
      });
      await sendMessage(
        `⚠️ *Binance Futures (SMC)* — Vị thế ${binanceSymbol} ĐÃ MỞ và CÓ ĐỦ SL/TP trên sàn, nhưng KHÔNG ghi được thông tin execution vào DB (position #${positionId}).\nBot sẽ không tự quản lý vị thế này (reconcile cần order id trong DB) — theo dõi tay trên Binance app cho tới khi SL/TP tự khớp.\nLỗi DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
      );
      return;
    }

    await sendMessage(
      `✅ *Binance Futures (SMC)* — Đã mở vị thế thật ${setup.direction} ${binanceSymbol}\nQty: ${sizing.quantity} | Leverage: ${leverage}x\nEntry: ${plan.entry} | SL: ${slPrice} | TP1: ${tp1Price} | TP2: ${tp2Price ?? "-"}`,
    );
  } catch (error) {
    // Loi TRUOC khi entry fill (hedge mode / guard / filters / balance / sizing /
    // margin / leverage / entry order) — chua co vi the that nao tren san.
    logger.error("Khong the mo vi the Binance Futures (SMC)", {
      pair: setup.pair,
      positionId,
      error,
    });
    await sendMessage(
      `❌ *Binance Futures (SMC)* — Không thể mở vị thế thật cho ${binanceSymbol} (${setup.direction}).\nLỗi: ${error instanceof Error ? error.message : String(error)}\nVị thế vẫn được track trong hệ thống (chỉ signal), không có lệnh thật trên sàn.`,
    );
  }
}
```

### File 2: `src/charts/smc-index.ts` (sửa)

1. Thêm import ở đầu file (cạnh các import khác, sau dòng `import { CHARTS, getChartsForTimeframeMode } from "./smc-charts.config.js";`):

```ts
import { openBinanceFuturesPosition } from "./binance-execution-smc.js";
import { isBinanceLiveTradingEnabled, isBinanceLiveTradingEnabledSmc } from "./binance-futures-config-env.js";
import { findOpenPositionIdByPair } from "./positions-repository-smc.js";
```

Lưu ý: `saveOpenPosition` đã được import từ `positions-repository-smc.js` ở dòng 2 — thêm `findOpenPositionIdByPair` vào CÙNG import đó (gộp lại thành 1 dòng, không tạo 2 dòng import riêng từ cùng 1 file):
```ts
import { saveOpenPosition /*, savePendingOrder */, findOpenPositionIdByPair } from "./positions-repository-smc.js";
```

2. Trong nhánh `if (shouldAutoTrackAsOpen(setup, threshold))` (khoảng dòng 148-164), ngay sau đoạn:
```ts
        const saved = await saveOpenPosition(setup);
        if (saved) {
          setup.autoTracked = true;
          logger.info("Auto-saved open position", { pair: setup.pair });
        } else {
```
Thêm code gọi Binance execution vào NGAY sau `logger.info("Auto-saved open position", ...)` (bên trong khối `if (saved) { ... }`, TRƯỚC dấu `}` đóng khối if). **Lưu ý: cả 2 kill-switch phải `true` mới trade thật** (master `isBinanceLiveTradingEnabled()` VÀ riêng SMC `isBinanceLiveTradingEnabledSmc()` — xem plan.md mục "Kiến trúc quyết định #5"):

```ts
          if (isBinanceLiveTradingEnabled() && isBinanceLiveTradingEnabledSmc()) {
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
          if (isBinanceLiveTradingEnabled() && isBinanceLiveTradingEnabledSmc()) {
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

- KHÔNG sửa logic `shouldAutoTrackAsOpen`, `validateTradeSetupForOpen`, hay bất kỳ điều kiện auto-track/freshness-guard nào khác trong `smc-index.ts`.
- KHÔNG đụng vào nhánh `else if` (pending order, đang disable có chủ đích).
- `openBinanceFuturesPosition` PHẢI không bao giờ throw ra ngoài (try/catch đã bọc toàn bộ trong code mẫu) — không được làm crash hay dừng vòng lặp xử lý các setup khác.
- Tuân thủ "Quy tắc fail-safe bất biến" trong `tasks/binance-futures-execution-smc/plan.md`: mọi `stopPrice` qua `roundToTickSize`; qty TP1/TP2 qua `splitTpQuantities`; fail-safe hủy lệnh treo + kiểm tra kết quả lệnh đóng; lỗi DB không kích hoạt đóng khẩn cấp; check one-way mode trước mọi lệnh; guard cross-system trước filters.
- KHÔNG sửa `binance-execution-volman.ts`, `smc-charts.config.ts`, `position-engine-smc.ts` trong task này.
- Không thêm cấu hình/feature ngoài scope liệt kê ở trên.

## Cách verify

```bash
npm run build
npm run test
```
`tests/charts/smc-index.test.ts` (nếu có) không được fail — nếu test mock `saveOpenPosition`/`findOpenPositionIdByPair`, đảm bảo `isBinanceLiveTradingEnabled()`/`isBinanceLiveTradingEnabledSmc()` mặc định `false` trong môi trường test (không set env tương ứng) nên nhánh Binance sẽ không chạy, không cần mock thêm gì mới.

## Output

Ghi vào `tasks/binance-futures-execution-smc/03-entry-execution-smc/result.md`:
- Đường dẫn file mới + đoạn diff đã sửa trong `smc-index.ts`
- Kết quả `npm run build && npm run test`

Nếu bị chặn (ví dụ không tìm thấy đúng đoạn code dòng 148-164 như mô tả do file đã đổi khác) → đọc lại file thực tế, tìm đúng vị trí tương đương (nhánh `if (shouldAutoTrackAsOpen(...))` gọi `saveOpenPosition`), áp dụng đúng logic mô tả. Nếu vẫn không xác định được → ghi `blocked.md`.
