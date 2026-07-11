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
  getOrderStatus,
} from "./binance-futures-client.js";
import {
  getConfiguredBinanceLeverage,
  getConfiguredBinanceMarginType,
  getConfiguredBinanceRiskPercentPerTrade,
  getConfiguredBinanceRiskUsdPerTrade,
} from "./binance-futures-config-env.js";
import {
  computeOrderQuantity,
  roundToTickSize,
  splitTpQuantities,
} from "./binance-position-sizing.js";
import { calculateRiskRewardPlan } from "./position-engine-volman.js";
import { saveBinanceExecutionDetails, updateBinanceSlOrder } from "./positions-repository-volman.js";
import type { PositionDecisionOutcome } from "./position-engine-volman.js";
import type { OpenPosition } from "./positions-repository-volman.js";
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
  const riskUsdt = getConfiguredBinanceRiskUsdPerTrade();
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

    const filters = await getExchangeInfoFilters(binanceSymbol);
    if (filters instanceof Error) throw filters;

    // Moi gia stopPrice gui len Binance PHAI lam tron theo tickSize — gia tho tu
    // Volman engine se bi Binance tu choi (loi price precision -1111/-4014).
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
      riskUsdt,
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
    // placedProtectionOrders: luu order id da dat de fail-safe huy het lenh treo
    // (SL closePosition=true con treo se dong nham vi the tuong lai cua cung symbol).
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

      // 1. Huy moi lenh conditional da dat duoc (cancelOrder da tolerant -2011)
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

      // 2. Dong vi the — PHAI kiem tra ket qua, khong duoc bao "da dong" khi chua chac
      const positionAmt = await getPositionAmount(binanceSymbol);
      const qtyToClose =
        !(positionAmt instanceof Error) && positionAmt !== 0
          ? Math.abs(positionAmt)
          : sizing.quantity;
      const closeResult = await placeMarketOrder(binanceSymbol, closeSide, qtyToClose, {
        reduceOnly: true,
      });

      // 3. Ghi DB status failed — boc try/catch rieng de loi DB khong nuot mat alert
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

      // 4. Alert dung su that
      const protectionMessage =
        protectionError instanceof Error
          ? protectionError.message
          : String(protectionError);
      if (closeResult instanceof Error) {
        await sendMessage(
          `🚨🚨 *Binance Futures — KHẨN CẤP* — ${binanceSymbol}: đặt SL/TP thất bại VÀ lệnh đóng khẩn cấp CŨNG THẤT BẠI.\n⚠️ VỊ THẾ ĐANG MỞ KHÔNG CÓ SL — mở Binance app và ĐÓNG TAY NGAY.\nLỗi đặt SL/TP: ${protectionMessage}\nLỗi đóng: ${closeResult.message}`,
        );
      } else {
        await sendMessage(
          `🚨 *Binance Futures* — LỖI khi đặt SL/TP cho ${binanceSymbol}, đã hủy các lệnh treo và đóng khẩn cấp vị thế.\nLỗi: ${protectionMessage}`,
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
        `⚠️ *Binance Futures* — Vị thế ${binanceSymbol} ĐÃ MỞ và CÓ ĐỦ SL/TP trên sàn, nhưng KHÔNG ghi được thông tin execution vào DB (position #${positionId}).\nBot sẽ không tự quản lý vị thế này (reconcile cần order id trong DB) — theo dõi tay trên Binance app cho tới khi SL/TP tự khớp.\nLỗi DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
      );
      return;
    }

    await sendMessage(
      `✅ *Binance Futures* — Đã mở vị thế thật ${setup.direction} ${binanceSymbol}\nQty: ${sizing.quantity} | Leverage: ${leverage}x\nEntry: ${plan.entry} | SL: ${slPrice} | TP1: ${tp1Price} | TP2: ${tp2Price ?? "-"}`,
    );
  } catch (error) {
    // Loi TRUOC khi entry fill (hedge mode / filters / balance / sizing / margin /
    // leverage / entry order) — chua co vi the that nao tren san.
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

export async function reconcileBinancePosition(
  position: OpenPosition,
): Promise<PositionDecisionOutcome> {
  const symbol = position.binanceSymbol as string;
  const alreadyPartial = (position.tp1ClosedPercent ?? 0) > 0;

  // Execution "failed" = fail-safe cua task 04 da dong khan cap vi the tren san
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
