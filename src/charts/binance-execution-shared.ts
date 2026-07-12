import {
  getExchangeInfoFilters,
  getAvailableBalanceUsdt,
  setMarginType,
  setLeverage,
  getMaxLeverageForSymbol,
  placeMarketOrder,
  placeStopMarketOrder,
  placeTakeProfitMarketOrder,
  getPositionAmount,
  cancelOrder,
  isHedgeModeEnabled,
  getOrderStatus,
  placeLimitOrder,
  placeStopMarketEntryOrder,
  getRegularOrderStatus,
  cancelRegularOrder,
} from "./binance-futures-client.js";
import {
  getConfiguredBinanceLeverage,
  getConfiguredBinanceMarginType,
  getConfiguredBinanceRiskPercentPerTrade,
  getConfiguredBinanceWorkingType,
} from "./binance-futures-config-env.js";
import {
  computeOrderQuantity,
  roundToTickSize,
  splitTpQuantities,
} from "./binance-position-sizing.js";
import { toBinanceSymbol, fetchOhlcHistory } from "./ohlc-provider.js";
import type { ChartTimeframe } from "./chart-types-common.js";
import { sendMessage } from "../shared/telegram-client.js";
import { createLogger } from "../shared/logger.js";

export type RiskRewardPlan = {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  partialClosePercent: number;
};

export type BinanceEntryOrderDetails = {
  binanceSymbol: string;
  binanceLeverage: number;
  binanceQuantity: number;
  binanceEntryOrderId: number;
  binanceEntryOrderType: "MARKET" | "LIMIT" | "STOP_MARKET";
};

export type PendingEntryOrderPosition = {
  id: number;
  pair: string;
  binanceSymbol: string;
  binanceEntryOrderId: number;
  binanceEntryOrderType: string;
  binanceEntryOrderPlacedAt: string;
  direction: "LONG" | "SHORT";
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string | null;
  binanceQuantity: number;
  binanceLeverage: number;
  partialClosePercent: number | null;
};

export type BinanceExecutionDetails = {
  binanceSymbol: string;
  binanceLeverage: number;
  binanceQuantity: number;
  binanceEntryOrderId: number;
  binanceSlOrderId: number | null;
  binanceTp1OrderId: number | null;
  binanceTp2OrderId: number | null;
  binanceExecutionStatus: "pending" | "placed" | "failed" | "close_failed";
};

export type OpenPosition = {
  id: number;
  pair: string;
  direction: "LONG" | "SHORT";
  entry: string;
  tp1ClosePercent?: number | null;
  tp1ClosedPercent?: number | null;
  binanceSymbol: string | null;
  binanceSlOrderId: number | null;
  binanceTp1OrderId: number | null;
  binanceTp2OrderId: number | null;
  binanceExecutionStatus?: "pending" | "placed" | "failed" | "close_failed" | null;
};

export type PositionDecisionOutcome = {
  decision: "HOLD" | "STOP" | "CLOSE";
  confidence: number;
  comment: string;
  managementAction: "NONE" | "PARTIAL_TP1" | "TP2_CLOSE" | "MOVE_SL_TO_BE" | "TRAIL_SL";
  partialClosePercent: number;
  newStopLoss: string | null;
  tp1Reached: boolean;
  tp2Reached: boolean;
  riskReward: number | null;
  tp1RiskReward: number | null;
  tp2RiskReward: number | null;
};

export type BinanceExecutionSystemConfig<TSetup, TOpenPosition, TDecisionOutcome> = {
  systemLabel: string; // "SMC" | "Volman"
  loggerName: string; // "charts:binance-execution-smc" | "charts:binance-execution"
  calculateRiskRewardPlan: (setup: TSetup) => RiskRewardPlan | null;
  saveBinanceExecutionDetails: (
    positionId: number,
    details: BinanceExecutionDetails,
  ) => Promise<void>;
  updateBinanceSlOrder: (positionId: number, orderId: number, stopLoss: string) => Promise<void>;
  getConfiguredRiskUsdt?: () => number | undefined;
  // Entry order type support (new in subtask 03, optional for backward compat)
  entryExecutionMode?: "MARKET_ONLY" | "HONOR_ORDER_TYPE";
  entryOrderExpiryMinutes?: number; // e.g., 60
  saveBinancePendingEntryOrder?: (
    positionId: number,
    details: BinanceEntryOrderDetails,
  ) => Promise<void>;
  updateBinanceEntryOrderStatus?: (
    positionId: number,
    status: "working" | "filled" | "expired" | "cancelled",
  ) => Promise<void>;
  getPendingEntryOrderPositions?: () => Promise<PendingEntryOrderPosition[]>;
  // Dong ban ghi DB khi entry order het han khong khop — vi the chua bao gio thuc su
  // mo tren san nen khong dung closePosition() day du (can PositionDecisionOutcome).
  closeExpiredEntryOrderPosition?: (positionId: number) => Promise<void>;
  // Cho pollPendingEntryOrders no-op ngay tu dau (khong query DB) khi feature dang tat —
  // tranh 1 Supabase round-trip vo ich moi cron cycle.
  isHonorOrderTypeEnabled?: () => boolean;
  // Telegram message prefixes to preserve exact strings across systems
  guardFailPrefix: string; // "*Binance Futures (SMC|Volman)*"
  failSafeMessagePrefix: string; // "*Binance Futures (SMC)*" or "*Binance Futures*"
  failSafeEmergencyMessagePrefix: string; // "*Binance Futures (SMC) — KHẨN CẤP*" or "*Binance Futures — KHẨN CẤP*"
  dbErrorPrefix: string; // "*Binance Futures (SMC)*" or "*Binance Futures*"
  successPrefix: string; // "*Binance Futures (SMC)*" or "*Binance Futures*"
  entryErrorPrefix: string; // "*Binance Futures (SMC)*" or "*Binance Futures*"
  closeFailedUrgentPrefix: string; // "*Binance Futures (SMC) — KHẨN CẤP nhắc lại*" or "*Binance Futures (Volman) — KHẨN CẤP nhắc lại*"
  tp1MoveSLFailPrefix: string; // "*Binance Futures (SMC) — KHẨN CẤP*" or "*Binance Futures (Volman) — KHẨN CẤP*"
  entryOrderExpiredPrefix?: string; // "*Binance Futures (SMC|Volman)*" prefix cho entry order expiry alert
};

// ---------------------------------------------------------------------------
// Helper functions for swing trailing SL after TP1
// ---------------------------------------------------------------------------

/**
 * Get the next higher timeframe.
 * M15 → H1, M30 → H1, H1 → H4, H4 → D1, D1 → D1
 */
function getHigherTimeframe(timeframe: ChartTimeframe): ChartTimeframe {
  switch (timeframe) {
    case "M15":
    case "M30":
      return "H1";
    case "H1":
      return "H4";
    case "H4":
      return "D1";
    case "D1":
      return "D1"; // D1 is the highest, no higher available
    default:
      return timeframe;
  }
}

/**
 * Calculate swing support from OHLC data.
 * Finds the lowest low in the data as a support level.
 * If price has barely broken above entry, use a Fib-like level instead.
 */
function calculateSwingSupportLevel(
  ohlcData: Array<{ high: number; low: number }>,
  entryPrice: number,
  direction: "LONG" | "SHORT",
): number | null {
  if (!ohlcData || ohlcData.length === 0) {
    return null;
  }

  if (direction === "LONG") {
    // For LONG: find lowest low in recent candles
    let swingLow = ohlcData[0].low;
    for (const candle of ohlcData) {
      if (candle.low < swingLow) {
        swingLow = candle.low;
      }
    }
    // If swing low is too close to entry or above it, use a conservative level
    if (swingLow >= entryPrice) {
      return null; // No valid swing support, fall back to breakeven
    }
    return swingLow;
  } else {
    // For SHORT: find highest high in recent candles
    let swingHigh = ohlcData[0].high;
    for (const candle of ohlcData) {
      if (candle.high > swingHigh) {
        swingHigh = candle.high;
      }
    }
    // If swing high is too close to entry or below it, use a conservative level
    if (swingHigh <= entryPrice) {
      return null; // No valid swing support, fall back to breakeven
    }
    return swingHigh;
  }
}

export function createOpenBinanceFuturesPosition<
  TSetup extends { pair: string; direction: "LONG" | "SHORT"; orderType?: string },
>(
  config: BinanceExecutionSystemConfig<TSetup, any, any>,
) {
  return async function openBinanceFuturesPosition(
    setup: TSetup,
    positionId: number,
    chartSymbol: string,
  ): Promise<void> {
    const logger = createLogger(config.loggerName);
    const binanceSymbol = toBinanceSymbol(chartSymbol);
    if (!binanceSymbol) {
      logger.warn("Symbol khong phai Binance, bo qua execution", {
        pair: setup.pair,
        chartSymbol,
      });
      return;
    }

    const plan = config.calculateRiskRewardPlan(setup);
    if (!plan) {
      logger.error("Khong tinh duoc RiskRewardPlan cho execution", {
        pair: setup.pair,
        positionId,
      });
      return;
    }

    let leverage = getConfiguredBinanceLeverage();
    const marginType = getConfiguredBinanceMarginType();
    const riskPercent = getConfiguredBinanceRiskPercentPerTrade();
    const riskUsdt = config.getConfiguredRiskUsdt?.();
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
      // tren san — neu he khac da co vi the mo tren cung symbol, KHONG duoc
      // mo them (xem plan.md muc "Kien truc quyet dinh #1").
      const existingPositionAmt = await getPositionAmount(binanceSymbol);
      if (existingPositionAmt instanceof Error) {
        logger.error(
          "Khong xac minh duoc vi the hien tai tren san — bo qua entry (fail-closed)",
          { pair: setup.pair, binanceSymbol, error: existingPositionAmt },
        );
        await sendMessage(
          `⚠️ ${config.guardFailPrefix} — Bỏ qua mở vị thế thật ${binanceSymbol}: không xác minh được vị thế hiện tại trên sàn (lỗi API). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn để tránh rủi ro mở đè lên vị thế của hệ khác.\nLỗi: ${existingPositionAmt.message}`,
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
          `⚠️ ${config.guardFailPrefix} — Bỏ qua mở vị thế thật ${binanceSymbol}: symbol này đã có vị thế đang mở trên sàn (có thể do hệ khác đặt). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn.`,
        );
        return;
      }

      const filters = await getExchangeInfoFilters(binanceSymbol);
      if (filters instanceof Error) throw filters;

      // Moi symbol co gioi han leverage rieng tren Binance (altcoin thanh khoan
      // thap thuong thap hon nhieu so voi cau hinh BINANCE_LEVERAGE chung) — kep
      // xuong muc toi da san cho phep de tranh loi -4028 "Leverage X is not valid".
      const maxLeverage = await getMaxLeverageForSymbol(binanceSymbol);
      if (maxLeverage instanceof Error) throw maxLeverage;
      if (leverage > maxLeverage) {
        logger.warn(
          `Leverage cau hinh (${leverage}x) vuot muc toi da Binance cho phep voi ${binanceSymbol} (${maxLeverage}x) — kep xuong ${maxLeverage}x`,
          { pair: setup.pair, binanceSymbol },
        );
        leverage = maxLeverage;
      }

      // Moi gia stopPrice gui len Binance PHAI lam tron theo tickSize — gia tho tu
      // engine se bi Binance tu choi (loi price precision -1111/-4014).
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

      // Entry order branching: MARKET vs LIMIT/STOP
      const isHonorOrderType =
        (config.entryExecutionMode ?? "MARKET_ONLY") === "HONOR_ORDER_TYPE" &&
        setup.orderType &&
        setup.orderType !== "MARKET_NOW";

      let entryOrder: any;
      const entryOrderType: "MARKET" | "LIMIT" | "STOP_MARKET" = (() => {
        if (!isHonorOrderType || !setup.orderType) return "MARKET";
        if (setup.orderType === "BUY_LIMIT" || setup.orderType === "SELL_LIMIT")
          return "LIMIT";
        if (setup.orderType === "BUY_STOP" || setup.orderType === "SELL_STOP")
          return "STOP_MARKET";
        return "MARKET";
      })();

      if (entryOrderType === "MARKET" || !isHonorOrderType) {
        // MARKET_ONLY mode: keep exact current behavior
        entryOrder = await placeMarketOrder(binanceSymbol, side, sizing.quantity);
        if (entryOrder instanceof Error) throw entryOrder;

        // Tu day tro di, vi the DA THAT SU MO tren Binance — moi loi khi dat SL/TP
        // phai duoc fail-safe dong lai ngay, khong duoc de vi the "tran" (khong co SL).
        await placeProtectionOrdersAndFinalize(
          config,
          binanceSymbol,
          closeSide,
          slPrice,
          tp1Price,
          tp2Price,
          tp1Quantity,
          tp2Quantity,
          entryOrder.orderId,
          positionId,
          sizing,
          leverage,
          logger,
        );

        await sendMessage(
          `✅ ${config.successPrefix} — Đã mở vị thế thật ${setup.direction} ${binanceSymbol}\nQty: ${sizing.quantity} | Leverage: ${leverage}x\nEntry: ${plan.entry} | SL: ${slPrice} | TP1: ${tp1Price} | TP2: ${tp2Price ?? "-"}`,
        );
      } else if (entryOrderType === "LIMIT") {
        // LIMIT entry order
        const entryPrice = roundToTickSize(plan.entry, filters.tickSize);
        entryOrder = await placeLimitOrder(
          binanceSymbol,
          side,
          entryPrice,
          sizing.quantity,
        );
        if (entryOrder instanceof Error) throw entryOrder;

        // Lưu entry order vào DB, chưa đặt SL/TP
        if (config.saveBinancePendingEntryOrder) {
          try {
            await config.saveBinancePendingEntryOrder(positionId, {
              binanceSymbol,
              binanceLeverage: leverage,
              binanceQuantity: sizing.quantity,
              binanceEntryOrderId: entryOrder.orderId,
              binanceEntryOrderType: "LIMIT",
            });
          } catch (dbError) {
            // Lenh LIMIT DA THAT SU dat tren san (entryOrder.orderId that) nhung ghi DB
            // that bai — KHONG duoc de loi nay roi xuong catch ngoai cung (message o do
            // noi sai "khong co lenh that tren san"). Bao dong rieng kem orderId that de
            // operator huy tay, vi getPendingEntryOrderPositions() se khong bao gio tim
            // thay order nay (binance_entry_order_status chua duoc set "working").
            logger.error("Khong ghi duoc pending entry order vao DB — lenh van dang song tren san", {
              positionId,
              orderId: entryOrder.orderId,
              error: dbError,
            });
            await sendMessage(
              `🚨🚨 ${config.dbErrorPrefix} — Lệnh LIMIT ${setup.direction} ${binanceSymbol} ĐÃ ĐẶT THẬT trên sàn (orderId: ${entryOrder.orderId}) nhưng KHÔNG ghi được vào DB.\n⚠️ Bot KHÔNG THỂ tự theo dõi/hủy lệnh này — mở Binance app kiểm tra và hủy tay nếu cần (Giá: ${entryPrice} | Qty: ${sizing.quantity}).\nLỗi DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
            );
            return;
          }
        }

        await sendMessage(
          `⏳ ${config.successPrefix} — Đã đặt lệnh LIMIT ${setup.direction} ${binanceSymbol}\nGiá: ${entryPrice} | Qty: ${sizing.quantity} | Leverage: ${leverage}x\nSL: ${slPrice} | TP1: ${tp1Price} | TP2: ${tp2Price ?? "-"}\nChờ khớp...`,
        );
      } else if (entryOrderType === "STOP_MARKET") {
        // STOP_MARKET entry order
        const stopPrice = roundToTickSize(plan.entry, filters.tickSize);
        const workingType = getConfiguredBinanceWorkingType();
        entryOrder = await placeStopMarketEntryOrder(
          binanceSymbol,
          side,
          stopPrice,
          sizing.quantity,
          workingType ? { workingType } : {},
        );
        if (entryOrder instanceof Error) throw entryOrder;

        // Lưu entry order vào DB, chưa đặt SL/TP
        if (config.saveBinancePendingEntryOrder) {
          try {
            await config.saveBinancePendingEntryOrder(positionId, {
              binanceSymbol,
              binanceLeverage: leverage,
              binanceQuantity: sizing.quantity,
              binanceEntryOrderId: entryOrder.orderId,
              binanceEntryOrderType: "STOP_MARKET",
            });
          } catch (dbError) {
            // Xem giai thich o nhanh LIMIT phia tren — cung ap dung o day: lenh STOP_MARKET
            // da that su song tren san (qua Algo Order API), khong duoc de rot xuong
            // catch ngoai (message sai "khong co lenh that tren san").
            logger.error("Khong ghi duoc pending entry order vao DB — lenh van dang song tren san", {
              positionId,
              orderId: entryOrder.orderId,
              error: dbError,
            });
            await sendMessage(
              `🚨🚨 ${config.dbErrorPrefix} — Lệnh STOP_MARKET ${setup.direction} ${binanceSymbol} ĐÃ ĐẶT THẬT trên sàn (orderId: ${entryOrder.orderId}) nhưng KHÔNG ghi được vào DB.\n⚠️ Bot KHÔNG THỂ tự theo dõi/hủy lệnh này — mở Binance app kiểm tra và hủy tay nếu cần (Giá trigger: ${stopPrice} | Qty: ${sizing.quantity}).\nLỗi DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
            );
            return;
          }
        }

        await sendMessage(
          `⏳ ${config.successPrefix} — Đã đặt lệnh STOP_MARKET ${setup.direction} ${binanceSymbol}\nGiá trigger: ${stopPrice} | Qty: ${sizing.quantity} | Leverage: ${leverage}x\nSL: ${slPrice} | TP1: ${tp1Price} | TP2: ${tp2Price ?? "-"}\nChờ khớp...`,
        );
      }
    } catch (error) {
      // Loi TRUOC khi entry fill (hedge mode / guard / filters / balance / sizing /
      // margin / leverage / entry order) — chua co vi the that nao tren san.
      logger.error(`Khong the mo vi the Binance Futures`, {
        pair: setup.pair,
        positionId,
        error,
      });
      await sendMessage(
        `❌ ${config.entryErrorPrefix} — Không thể mở vị thế thật cho ${binanceSymbol} (${setup.direction}).\nLỗi: ${error instanceof Error ? error.message : String(error)}\nVị thế vẫn được track trong hệ thống (chỉ signal), không có lệnh thật trên sàn.`,
      );
    }
  };
}

async function placeProtectionOrdersAndFinalize(
  config: BinanceExecutionSystemConfig<any, any, any>,
  binanceSymbol: string,
  closeSide: "BUY" | "SELL",
  slPrice: number,
  tp1Price: number,
  tp2Price: number | null,
  tp1Quantity: number,
  tp2Quantity: number,
  entryOrderId: number,
  positionId: number,
  sizing: { quantity: number },
  leverage: number,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const placedProtectionOrders: number[] = [];
  let slOrderId: number | null = null;
  let tp1OrderId: number | null = null;
  let tp2OrderId: number | null = null;
  const workingType = getConfiguredBinanceWorkingType();
  const workingTypeOption = workingType ? { workingType } : {};

  try {
    const slOrder = await placeStopMarketOrder(binanceSymbol, closeSide, slPrice, workingTypeOption);
    if (slOrder instanceof Error) throw slOrder;
    slOrderId = slOrder.orderId;
    placedProtectionOrders.push(slOrder.orderId);

    const tp1Order = await placeTakeProfitMarketOrder(
      binanceSymbol,
      closeSide,
      tp1Price,
      tp1Quantity,
      workingTypeOption,
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
        workingTypeOption,
      );
      if (tp2Order instanceof Error) throw tp2Order;
      tp2OrderId = tp2Order.orderId;
      placedProtectionOrders.push(tp2Order.orderId);
    }
  } catch (protectionError) {
    logger.error("Dat SL/TP that bai sau entry, dong vi the fail-safe", {
      binanceSymbol,
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

    const executionStatusAfterFailSafe: "failed" | "close_failed" =
      closeResult instanceof Error ? "close_failed" : "failed";

    try {
      await config.saveBinanceExecutionDetails(positionId, {
        binanceSymbol,
        binanceLeverage: leverage,
        binanceQuantity: sizing.quantity,
        binanceEntryOrderId: entryOrderId,
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

    const protectionMessage =
      protectionError instanceof Error
        ? protectionError.message
        : String(protectionError);
    if (closeResult instanceof Error) {
      await sendMessage(
        `🚨🚨 ${config.failSafeEmergencyMessagePrefix} — ${binanceSymbol}: đặt SL/TP thất bại VÀ lệnh đóng khẩn cấp CŨNG THẤT BẠI.\n⚠️ VỊ THẾ ĐANG MỞ KHÔNG CÓ SL — mở Binance app và ĐÓNG TAY NGAY.\nLỗi đặt SL/TP: ${protectionMessage}\nLỗi đóng: ${closeResult.message}`,
      );
    } else {
      await sendMessage(
        `🚨 ${config.failSafeMessagePrefix} — LỖI khi đặt SL/TP cho ${binanceSymbol}, đã hủy các lệnh treo và đóng khẩn cấp vị thế.\nLỗi: ${protectionMessage}`,
      );
    }
    throw protectionError;
  }

  try {
    await config.saveBinanceExecutionDetails(positionId, {
      binanceSymbol,
      binanceLeverage: leverage,
      binanceQuantity: sizing.quantity,
      binanceEntryOrderId: entryOrderId,
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
      `⚠️ ${config.dbErrorPrefix} — Vị thế ${binanceSymbol} ĐÃ MỞ và CÓ ĐỦ SL/TP trên sàn, nhưng KHÔNG ghi được thông tin execution vào DB (position #${positionId}).\nBot sẽ không tự quản lý vị thế này (reconcile cần order id trong DB) — theo dõi tay trên Binance app cho tới khi SL/TP tự khớp.\nLỗi DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
    );
    throw dbError;
  }
}

export function createReconcileBinancePosition<TOpenPosition extends OpenPosition>(
  config: BinanceExecutionSystemConfig<any, TOpenPosition, any>,
) {
  return async function reconcileBinancePosition(
    position: TOpenPosition,
  ): Promise<PositionDecisionOutcome> {
    const logger = createLogger(config.loggerName);
    const symbol = position.binanceSymbol as string;
    const alreadyPartial = (position.tp1ClosedPercent ?? 0) > 0;

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
        `🚨🚨 ${config.closeFailedUrgentPrefix} — ${symbol}: vị thế VẪN ĐANG MỞ trên sàn KHÔNG CÓ SL (đóng khẩn cấp trước đó thất bại). Mở Binance app và ĐÓNG TAY hoặc đặt SL NGAY.`,
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

    // Execution "failed" = fail-safe da dong khan cap vi the tren san
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
          const cancelTp1 = await cancelOrder(symbol, position.binanceTp1OrderId);
          if (cancelTp1 instanceof Error) {
            logger.error("Khong huy duoc TP1 order con lai sau khi SL filled — co the con orphan order tren san", {
              pair: position.pair,
              id: position.id,
              orderId: position.binanceTp1OrderId,
              error: cancelTp1,
            });
          }
        }
        if (position.binanceTp2OrderId) {
          const cancelTp2 = await cancelOrder(symbol, position.binanceTp2OrderId);
          if (cancelTp2 instanceof Error) {
            logger.error("Khong huy duoc TP2 order con lai sau khi SL filled — co the con orphan order tren san", {
              pair: position.pair,
              id: position.id,
              orderId: position.binanceTp2OrderId,
              error: cancelTp2,
            });
          }
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
          const cancelSl = await cancelOrder(symbol, position.binanceSlOrderId);
          if (cancelSl instanceof Error) {
            logger.error("Khong huy duoc SL order con lai sau khi TP2 filled — co the con orphan order tren san", {
              pair: position.pair,
              id: position.id,
              orderId: position.binanceSlOrderId,
              error: cancelSl,
            });
          }
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

        // THU TU: HUY SL CU TRUOC, dat SL moi SAU. Verify thuc te tren testnet
        // 2026-07-11: Binance TU CHOI dat 2 lenh STOP_MARKET closePosition=true cung
        // chieu dong thoi ton tai (loi -4130 "An open stop or take profit order with
        // GTE and closePosition in the direction is existing") — gia dinh cu ("Binance
        // cho phep 2 lenh cung ton tai") SAI, khien dời SL về BE luôn thất bại vĩnh viễn.
        // Chap nhan mot khoang trong that (round-trip API, thuong <1s) khong co SL nao
        // tren san giua luc huy SL cu va dat SL moi — retry ngay lap tuc (khong doi
        // cycle check sau) + alert Telegram khan cap neu dat lai van fail sau retry.
        const filters = await getExchangeInfoFilters(symbol);
        const entryPrice = Number(position.entry);
        const bePrice =
          filters instanceof Error
            ? entryPrice
            : roundToTickSize(entryPrice, filters.tickSize);

        if (position.binanceSlOrderId) {
          const cancelResult = await cancelOrder(symbol, position.binanceSlOrderId);
          if (cancelResult instanceof Error) {
            // Khong huy duoc SL cu -> SL cu (gia goc) VAN CON hieu luc tren san, vi the
            // van co bao ve. KHONG dat SL moi (tranh tao 2 SL cung ton tai lai bi -4130).
            // Thu lai dời BE ở lần check sau.
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
          }
        }

        // Tu day: SL cu DA bi huy — vi the dang KHONG CO SL nao tren san. Retry dat
        // SL moi toi da 3 lan trong cung 1 lan goi (khong de treo den cycle sau).

        // Attempt to calculate swing support for trailing SL after TP1
        // Falls back to breakeven if swing calculation fails or is not available
        let slPrice = bePrice;
        let slMethod = "breakeven"; // "breakeven", "swing_support", or "fallback"

        try {
          // Get primary timeframe from env or default to H4
          const primaryTimeframe = (process.env.CHART_PRIMARY_TIMEFRAME as ChartTimeframe | undefined) || "H4";
          const higherTimeframe = getHigherTimeframe(primaryTimeframe);

          // Attempt to fetch OHLC data for swing support calculation
          // Look back 10 candles to find swing low/high
          const ohlcResult = await fetchOhlcHistory(
            symbol,
            higherTimeframe,
            10, // number of candles
          );

          if (!(ohlcResult instanceof Error) && ohlcResult.length > 0) {
            const swingLevel = calculateSwingSupportLevel(
              ohlcResult,
              entryPrice,
              position.direction,
            );

            if (swingLevel !== null) {
              slPrice = filters instanceof Error
                ? swingLevel
                : roundToTickSize(swingLevel, filters.tickSize);
              slMethod = "swing_support";
              logger.info(`Calculated swing ${position.direction === "LONG" ? "support" : "resistance"} for trailing SL after TP1: ${slPrice.toFixed(5)}`, {
                pair: position.pair,
                method: slMethod,
                swingLevel,
              });
            }
          }
        } catch (error) {
          // If swing calculation fails, fall back to breakeven
          logger.warn(
            "Swing support calculation failed after TP1 — falling back to breakeven",
            { pair: position.pair, error: error instanceof Error ? error.message : String(error) },
          );
          slPrice = bePrice;
          slMethod = "fallback";
        }

        let newSl = await placeStopMarketOrder(symbol, closeSide, slPrice);
        for (let attempt = 2; newSl instanceof Error && attempt <= 3; attempt++) {
          newSl = await placeStopMarketOrder(symbol, closeSide, slPrice);
        }

        if (newSl instanceof Error) {
          logger.error(
            "KHAN CAP: da huy SL cu nhung khong dat lai duoc SL moi sau 3 lan thu — vi the dang KHONG CO SL",
            { pair: position.pair, id: position.id, error: newSl },
          );
          await sendMessage(
            `🚨🚨 ${config.tp1MoveSLFailPrefix} — ${symbol}: đã hủy SL cũ để dời SL (${slMethod}) nhưng KHÔNG đặt lại được SL mới sau 3 lần thử.\n⚠️ VỊ THẾ ĐANG KHÔNG CÓ SL — mở Binance app và đặt SL tay NGAY LẬP TỨC.\nLỗi: ${newSl.message}`,
          );
          // QUAN TRONG: xem giai thich o nhanh fail phia tren (3a) — cung ap dung o day.
          return {
            decision: "HOLD",
            confidence: 90,
            comment:
              "TP1 đã khớp trên Binance Futures, dời SL THẤT BẠI SAU KHI ĐÃ HỦY SL CŨ — vị thế đang KHÔNG CÓ SL, cần đặt tay khẩn cấp",
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

        await config.updateBinanceSlOrder(position.id, newSl.orderId, String(slPrice));
        const slTypeLabel = slMethod === "swing_support" ? "swing support" : (slMethod === "breakeven" ? "breakeven" : "fallback");
        return {
          decision: "HOLD",
          confidence: 90,
          comment: `TP1 đã khớp trên Binance Futures, dời SL đến ${slTypeLabel}`,
          managementAction: "PARTIAL_TP1",
          partialClosePercent: position.tp1ClosePercent ?? 50,
          newStopLoss: String(slPrice),
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
  };
}

// Uu tien lay quantity THAT SU tren san (getPositionAmount) thay vi tin tuong
// quantity du kien luc dat entry — can thiet cho STOP_MARKET vi getOrderStatus()
// (algo order) khong bao gio tra ve executedQty, nen "FILLED" co the thuc chat la
// mot fill mot phan (thanh khoan mong) ma code khong co cach nao khac de phat hien.
async function resolveFilledQuantity(
  symbol: string,
  fallbackQuantity: number,
  logger: ReturnType<typeof createLogger>,
): Promise<number> {
  const positionAmt = await getPositionAmount(symbol);
  if (!(positionAmt instanceof Error) && positionAmt !== 0) {
    return Math.abs(positionAmt);
  }
  logger.warn(
    "Khong xac minh duoc quantity thuc te tren san sau fill, dung quantity du kien luc dat entry",
    { symbol, fallbackQuantity, positionAmtResult: positionAmt },
  );
  return fallbackQuantity;
}

export function createPollPendingEntryOrder<TOpenPosition extends OpenPosition>(
  config: BinanceExecutionSystemConfig<any, TOpenPosition, any>,
) {
  return async function pollPendingEntryOrders(): Promise<void> {
    const logger = createLogger(config.loggerName);

    if (config.isHonorOrderTypeEnabled && !config.isHonorOrderTypeEnabled()) {
      return;
    }

    if (!config.getPendingEntryOrderPositions) {
      logger.debug("getPendingEntryOrderPositions not configured, skip polling");
      return;
    }

    const pending = await config.getPendingEntryOrderPositions();

    for (const position of pending) {
      const symbol = position.binanceSymbol;
      const placedAtMs = new Date(position.binanceEntryOrderPlacedAt).getTime();
      const nowMs = Date.now();
      const elapsedMinutes = (nowMs - placedAtMs) / 1000 / 60;
      const expiryMinutes = config.entryOrderExpiryMinutes ?? 60;
      const isExpired = elapsedMinutes > expiryMinutes;

      // Fetch order status via appropriate endpoint
      let orderStatus: { status: string; executedQty?: string } | Error;
      if (position.binanceEntryOrderType === "LIMIT") {
        orderStatus = await getRegularOrderStatus(symbol, position.binanceEntryOrderId);
        if (orderStatus instanceof Error) {
          logger.error(
            "Khong xac nhan duoc trang thai LIMIT entry order, bo qua kiem tra nay",
            {
              pair: position.pair,
              orderId: position.binanceEntryOrderId,
              error: orderStatus,
            },
          );
          continue;
        }
      } else if (position.binanceEntryOrderType === "STOP_MARKET") {
        orderStatus = await getOrderStatus(symbol, position.binanceEntryOrderId);
        if (orderStatus instanceof Error) {
          logger.error(
            "Khong xac nhan duoc trang thai STOP_MARKET entry order, bo qua kiem tra nay",
            {
              pair: position.pair,
              orderId: position.binanceEntryOrderId,
              error: orderStatus,
            },
          );
          continue;
        }
      } else {
        logger.warn("Unknown entry order type, skip", {
          pair: position.pair,
          type: position.binanceEntryOrderType,
        });
        continue;
      }

      // Decision: filled (fully or partially), expired, or still working
      if (orderStatus.status === "FILLED") {
        // Entry order filled — place SL/TP using persisted prices
        logger.info("Entry order filled, placing SL/TP", {
          pair: position.pair,
          orderId: position.binanceEntryOrderId,
        });

        const closeSide: "BUY" | "SELL" =
          position.direction === "LONG" ? "SELL" : "BUY";
        const filters = await getExchangeInfoFilters(symbol);
        if (filters instanceof Error) {
          logger.error(
            "Khong lay tron size, khong dat SL/TP nay",
            { pair: position.pair, symbol, error: filters },
          );
          continue;
        }

        const slPrice = roundToTickSize(Number(position.stopLoss), filters.tickSize);
        const tp1Price = roundToTickSize(Number(position.takeProfit1), filters.tickSize);
        const tp2Price =
          position.takeProfit2 !== null
            ? roundToTickSize(Number(position.takeProfit2), filters.tickSize)
            : null;

        // Quantity THAT SU tren san — quan trong nhat cho STOP_MARKET (algo order khong
        // bao gio tra ve executedQty nen "FILLED" co the la fill mot phan).
        const actualQuantity = await resolveFilledQuantity(
          symbol,
          position.binanceQuantity,
          logger,
        );
        const partialClosePercent = position.partialClosePercent ?? 50;
        const { tp1Quantity, tp2Quantity } = splitTpQuantities(
          actualQuantity,
          partialClosePercent,
          filters.stepSize,
        );

        const sizing = { quantity: actualQuantity };

        try {
          await placeProtectionOrdersAndFinalize(
            config,
            symbol,
            closeSide,
            slPrice,
            tp1Price,
            tp2Price,
            tp1Quantity,
            tp2Quantity,
            position.binanceEntryOrderId,
            position.id,
            sizing,
            position.binanceLeverage,
            logger,
          );

          if (config.updateBinanceEntryOrderStatus) {
            try {
              await config.updateBinanceEntryOrderStatus(position.id, "filled");
            } catch (dbError) {
              logger.error("Khong cap nhat entry order status khi filled", {
                positionId: position.id,
                error: dbError,
              });
            }
          }
        } catch (protectionError) {
          logger.error("Khong dat duoc SL/TP sau khi entry fill", {
            pair: position.pair,
            error: protectionError,
          });
          // Entry order DA THUC SU FILLED tren san (khong doi trang thai nay o lan poll
          // sau nua) — placeProtectionOrdersAndFinalize da tu fail-safe dong vi the va
          // ghi binanceExecutionStatus "failed"/"close_failed" qua saveBinanceExecutionDetails.
          // Giu "working" o day se khien lan poll sau xu ly lai y het FILLED nay, goi lai
          // fail-safe cho mot vi the co the da dong, gay canh bao khan cap gia lap lai vo han.
          if (config.updateBinanceEntryOrderStatus) {
            try {
              await config.updateBinanceEntryOrderStatus(position.id, "filled");
            } catch (dbError) {
              logger.error("Khong cap nhat entry order status sau khi protection that bai", {
                positionId: position.id,
                error: dbError,
              });
            }
          }
        }
      } else if (
        isExpired &&
        (orderStatus.status === "NEW" || orderStatus.status === "PARTIALLY_FILLED")
      ) {
        // Entry order expired — cancel it with partial fill handling
        const executedQty = orderStatus.executedQty
          ? Number(orderStatus.executedQty)
          : 0;

        if (orderStatus.status === "PARTIALLY_FILLED" && executedQty > 0) {
          logger.info("Entry order partially filled at expiry, keeping filled portion", {
            pair: position.pair,
            orderId: position.binanceEntryOrderId,
            executedQty,
          });

          // Huy phan CHUA KHOP con lai cua chinh order nay TRUOC — neu khong, order van
          // nam tren so lenh va co the tiep tuc khop sau, lam vi the phinh to hon
          // executedQty ma SL/TP sap dat chi bao ve dung executedQty (chi ap dung cho
          // LIMIT — day la nhanh duy nhat co the that thuc su reachable cho PARTIALLY_FILLED,
          // xem comment o getRegularOrderStatus/getOrderStatus).
          if (position.binanceEntryOrderType === "LIMIT") {
            const cancelRemainder = await cancelRegularOrder(symbol, position.binanceEntryOrderId);
            if (cancelRemainder instanceof Error) {
              logger.error(
                "Khong huy duoc phan LIMIT order con lai chua khop sau partial fill — co the tiep tuc khop them ngoai du kien",
                { pair: position.pair, orderId: position.binanceEntryOrderId, error: cancelRemainder },
              );
            }
          }

          // Place SL/TP for partial fill
          const closeSide: "BUY" | "SELL" =
            position.direction === "LONG" ? "SELL" : "BUY";
          const filters = await getExchangeInfoFilters(symbol);
          if (!(filters instanceof Error)) {
            const slPrice = roundToTickSize(Number(position.stopLoss), filters.tickSize);
            const tp1Price = roundToTickSize(Number(position.takeProfit1), filters.tickSize);
            const tp2Price =
              position.takeProfit2 !== null
                ? roundToTickSize(Number(position.takeProfit2), filters.tickSize)
                : null;

            const partialClosePercent = position.partialClosePercent ?? 50;
            const { tp1Quantity, tp2Quantity } = splitTpQuantities(
              executedQty,
              partialClosePercent,
              filters.stepSize,
            );

            const sizing = { quantity: executedQty };
            try {
              await placeProtectionOrdersAndFinalize(
                config,
                symbol,
                closeSide,
                slPrice,
                tp1Price,
                tp2Price,
                tp1Quantity,
                tp2Quantity,
                position.binanceEntryOrderId,
                position.id,
                sizing,
                position.binanceLeverage,
                logger,
              );

              if (config.updateBinanceEntryOrderStatus) {
                try {
                  await config.updateBinanceEntryOrderStatus(position.id, "filled");
                } catch (dbError) {
                  logger.error("Khong cap nhat entry order status", {
                    positionId: position.id,
                    error: dbError,
                  });
                }
              }
            } catch (protectionError) {
              logger.error("Khong dat duoc SL/TP cho partial fill", {
                pair: position.pair,
                error: protectionError,
              });
              // Remainder da huy o tren, quantity se khong doi o lan poll sau — danh dau
              // "filled" de tranh retry vo han giong nhu nhanh FILLED day du.
              if (config.updateBinanceEntryOrderStatus) {
                try {
                  await config.updateBinanceEntryOrderStatus(position.id, "filled");
                } catch (dbError) {
                  logger.error("Khong cap nhat entry order status sau khi protection that bai (partial fill)", {
                    positionId: position.id,
                    error: dbError,
                  });
                }
              }
            }
          }
        } else {
          // Fully expired without fill — cancel the order. Neu huy that bai vi mot ly
          // do THAT (khong phai -2011 "da huy/khop roi" — 2 ham cancel* da tu tra ve
          // true cho case do), KHONG duoc danh dau expired/dong DB o cycle nay: order co
          // the van con song tren san (hoac vua khop dung luc goi cancel), thu lai o
          // cycle sau thay vi bo mac mot order/vi the khong con duoc theo doi.
          let cancelSucceeded = true;
          if (position.binanceEntryOrderType === "LIMIT") {
            const cancelResult = await cancelRegularOrder(symbol, position.binanceEntryOrderId);
            if (cancelResult instanceof Error) {
              cancelSucceeded = false;
              logger.error("Khong huy duoc LIMIT entry order khi het han, thu lai lan sau", {
                pair: position.pair,
                orderId: position.binanceEntryOrderId,
                error: cancelResult,
              });
            }
          } else if (position.binanceEntryOrderType === "STOP_MARKET") {
            const cancelResult = await cancelOrder(symbol, position.binanceEntryOrderId);
            if (cancelResult instanceof Error) {
              cancelSucceeded = false;
              logger.error("Khong huy duoc STOP_MARKET entry order khi het han, thu lai lan sau", {
                pair: position.pair,
                orderId: position.binanceEntryOrderId,
                error: cancelResult,
              });
            }
          }

          if (!cancelSucceeded) {
            continue;
          }

          if (config.updateBinanceEntryOrderStatus) {
            try {
              await config.updateBinanceEntryOrderStatus(position.id, "expired");
            } catch (dbError) {
              logger.error("Khong cap nhat entry order status khi expired", {
                positionId: position.id,
                error: dbError,
              });
            }
          }

          // Vi the chua bao gio thuc su mo tren san (entry het han truoc khi khop) —
          // dong ban ghi DB de tranh mo coi mai mai (reconcileBinancePosition se coi
          // day la "van dang mo, chua co SL/TP" vinh vien neu khong dong o day).
          if (config.closeExpiredEntryOrderPosition) {
            try {
              await config.closeExpiredEntryOrderPosition(position.id);
            } catch (dbError) {
              logger.error("Khong dong duoc ban ghi DB sau khi entry order het han", {
                positionId: position.id,
                error: dbError,
              });
            }
          }

          logger.info("Entry order expired and cancelled", {
            pair: position.pair,
            orderId: position.binanceEntryOrderId,
            elapsedMinutes: Math.round(elapsedMinutes),
          });
          const expiredPrefix = config.entryOrderExpiredPrefix ?? config.guardFailPrefix;
          await sendMessage(
            `⏱️ ${expiredPrefix} — Lệnh entry ${position.binanceEntryOrderType} cho ${symbol} đã hết hạn (${Math.round(elapsedMinutes)} phút) và đã bị hủy.\nVị thế vẫn được track, có thể thử lại entry tay hoặc chờ tín hiệu tiếp theo.`,
          );
        }
      } else {
        // Still working — no action
        logger.debug("Entry order still working", {
          pair: position.pair,
          orderId: position.binanceEntryOrderId,
          elapsedMinutes: Math.round(elapsedMinutes),
        });
      }
    }
  };
}
