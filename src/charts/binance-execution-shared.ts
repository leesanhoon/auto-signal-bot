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
} from "./binance-position-sizing.js";
import { toBinanceSymbol, fetchOhlcHistory } from "./ohlc-provider.js";
import { sendMessage } from "../shared/telegram-client.js";
import { createLogger } from "../shared/logger.js";
import type { ChartTimeframe } from "./chart-types-common.js";
import { isEmaExitEnabled, getEmaExitPeriod } from "./volman-config-env.js";
import { calculateLatestEma, resolveEmaExitDecision } from "./position-ema-exit.js";

// -4509 "TIF GTE can only be used with open positions" xay ra khi dat SL (closePosition:true,
// TIF mac dinh GTE_GTC) ngay sau khi entry order FILLED — status order da cap nhat nhanh hon
// trang thai position tren Binance (getPositionAmount van tra ve 0 tam thoi). Day la do tre
// dong bo thoang qua (verify thuc te qua log JTOUSDT 2026-07-12: positionAmtResult 0 ngay
// truoc loi -4509), KHONG phai loi logic — retry ngan se tu het vi position kip dong bo.
async function sendCleanupWarning(
  config: BinanceExecutionSystemConfig<any, any, any>,
  symbolOrPair: string,
  detail: string,
): Promise<void> {
  await sendMessage(
    `⚠️ ${config.silentFailureWarnPrefix} — ${symbolOrPair}: ${detail}`,
  );
}

async function placeStopMarketOrderRetryOn4509(
  symbol: string,
  side: "BUY" | "SELL",
  stopPrice: number,
  options: { workingType?: "MARK_PRICE" | "CONTRACT_PRICE" },
  logger: ReturnType<typeof createLogger>,
): Promise<Awaited<ReturnType<typeof placeStopMarketOrder>>> {
  const maxAttempts = 3;
  const delayMs = 700;
  let lastResult: Awaited<ReturnType<typeof placeStopMarketOrder>>;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await placeStopMarketOrder(symbol, side, stopPrice, options);
    if (!(lastResult instanceof Error)) return lastResult;
    if (!lastResult.message.includes("code -4509") || attempt === maxAttempts) {
      return lastResult;
    }
    logger.warn(
      `Dat SL that bai voi -4509 (vi the chua kip dong bo tren Binance sau entry fill) — retry ${attempt}/${maxAttempts} sau ${delayMs}ms`,
      { symbol, side, stopPrice, attempt },
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return lastResult!;
}

export type RiskRewardPlan = {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
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
  binanceQuantity: number;
  binanceLeverage: number;
  // Chi co gia tri thuc su khi getPendingEntryOrderPositions duoc build voi
  // includeTimeframe=true (xem positions-repository-binance-entry-order-shared.ts)
  primaryTimeframe?: "M15" | "M30" | "H1" | "H4" | "D1" | null;
};

export type BinanceExecutionDetails = {
  binanceSymbol: string;
  binanceLeverage: number;
  binanceQuantity: number;
  binanceEntryOrderId: number;
  binanceSlOrderId: number | null;
  binanceTp1OrderId: number | null;
  binanceExecutionStatus: "pending" | "placed" | "failed" | "close_failed";
};

export type OpenPosition = {
  id: number;
  pair: string;
  direction: "LONG" | "SHORT";
  entry: string;
  binanceSymbol: string | null;
  binanceSlOrderId: number | null;
  binanceTp1OrderId: number | null;
  binanceExecutionStatus?: "pending" | "placed" | "failed" | "close_failed" | null;
  primaryTimeframe?: "M15" | "M30" | "H1" | "H4" | "D1" | null;
};

export type PositionDecisionOutcome = {
  decision: "HOLD" | "STOP" | "CLOSE";
  confidence: number;
  comment: string;
  managementAction: "NONE" | "TAKE_PROFIT_CLOSE";
};

export type BinanceExecutionSystemConfig<TSetup, TOpenPosition, TDecisionOutcome> = {
  systemLabel: string;
  loggerName: string;
  calculateRiskRewardPlan: (setup: TSetup) => RiskRewardPlan | null;
  saveBinanceExecutionDetails: (
    positionId: number,
    details: BinanceExecutionDetails,
  ) => Promise<void>;
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
  // Ten cac setup (setup.setup, vd "RB"/"ARB"/"IRB") KHONG the pre-position that su
  // (huong lenh chi biet duoc luc breakout xay ra) — neu dat LIMIT/STOP that bai (vd
  // -2021 "Order would immediately trigger" vi gia da vuot muc), tu dong fallback sang
  // MARKET NOW thay vi bo lo tin hieu. BB KHONG nam trong danh sach nay vi bien
  // truoc duoc breakout that (setup.direction xac dinh tu trend).
  entryFallbackToMarketForSetups?: string[];
  // Ghi lai ly do fail khi loi xay ra TRUOC luc dat duoc entry order (hedge mode / guard /
  // filters / balance / sizing / margin / entry order) — cac truong hop nay khong the goi
  // saveBinanceExecutionDetails vi chua co day du entryOrderId/quantity that. Optional de
  // khong pha vo test hien co chua wire field nay.
  saveBinanceExecutionFailure?: (positionId: number, reason: string) => Promise<void>;
  // Telegram message prefixes to preserve exact strings across systems
  guardFailPrefix: string;
  failSafeMessagePrefix: string;
  failSafeEmergencyMessagePrefix: string;
  dbErrorPrefix: string;
  successPrefix: string;
  entryErrorPrefix: string;
  closeFailedUrgentPrefix: string;
  entryOrderExpiredPrefix?: string;
  silentFailureWarnPrefix: string;
  // Timeframe dung de tinh EMA cho EMA-exit check. Optional vi khong phai
  // he thong nao cung co du lieu timeframe cua position -- neu khong cung cap,
  // EMA-exit se bi bo qua cho he do.
  getEmaExitTimeframe?: (position: TOpenPosition) => ChartTimeframe;
};

async function recordExecutionFailure(
  config: BinanceExecutionSystemConfig<any, any, any>,
  positionId: number,
  reason: string,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  if (!config.saveBinanceExecutionFailure) return;
  try {
    await config.saveBinanceExecutionFailure(positionId, reason);
  } catch (dbError) {
    logger.error("Khong ghi duoc binance_failure_reason vao DB", {
      positionId,
      reason,
      error: dbError,
    });
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
        await recordExecutionFailure(
          config,
          positionId,
          `cannot_verify_existing_position: ${existingPositionAmt.message}`,
          logger,
        );
        await sendMessage(
          `⚠️ ${config.guardFailPrefix} — Bỏ qua mở vị thế thật ${binanceSymbol}: không xác minh được vị thế hiện tại trên sàn (lỗi API). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn để tránh rủi ro mở đè lên vị thế của hệ khác.\nLỗi: ${existingPositionAmt.message}`,
        );
        return;
      }
      if (existingPositionAmt !== 0) {
        const setupTimeframe = (setup as any).primaryTimeframe ?? "unknown";
        logger.warn("Bo qua entry Binance — symbol da co vi the mo (co the do he khac/timeframe khac)", {
          pair: setup.pair,
          binanceSymbol,
          existingPositionAmt,
          setupTimeframe,
        });
        await recordExecutionFailure(
          config,
          positionId,
          `symbol_already_has_position (timeframe: ${setupTimeframe})`,
          logger,
        );
        await sendMessage(
          `⚠️ ${config.guardFailPrefix} — Bỏ qua mở vị thế thật ${binanceSymbol}: symbol này đã có vị thế đang mở trên sàn (timeframe hiện tại: ${setupTimeframe}). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn.`,
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
      const tpPrice = roundToTickSize(plan.takeProfit1, filters.tickSize);

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
      const preferredEntryType: "MARKET" | "LIMIT" | "STOP_MARKET" = (() => {
        if (!isHonorOrderType || !setup.orderType) return "MARKET";
        if (setup.orderType === "BUY_LIMIT" || setup.orderType === "SELL_LIMIT")
          return "LIMIT";
        if (setup.orderType === "BUY_STOP" || setup.orderType === "SELL_STOP")
          return "STOP_MARKET";
        return "MARKET";
      })();

      // resolvedEntryType co the khac preferredEntryType neu dat LIMIT/STOP that bai
      // va setup nam trong danh sach entryFallbackToMarketForSetups (vd RB/ARB/IRB —
      // huong lenh chi biet duoc luc breakout xay ra nen khong the "cho san" nhu BB,
      // gia thuong da vuot muc entry -> Binance tu choi lenh dieu kien voi -2021).
      let resolvedEntryType: "MARKET" | "LIMIT" | "STOP_MARKET" = preferredEntryType;
      let fellBackToMarket = false;

      if (preferredEntryType === "LIMIT" || preferredEntryType === "STOP_MARKET") {
        try {
          if (preferredEntryType === "LIMIT") {
            const entryPrice = roundToTickSize(plan.entry, filters.tickSize);
            const limitResult = await placeLimitOrder(binanceSymbol, side, entryPrice, sizing.quantity);
            if (limitResult instanceof Error) throw limitResult;
            entryOrder = limitResult;
          } else {
            const stopPrice = roundToTickSize(plan.entry, filters.tickSize);
            const workingType = getConfiguredBinanceWorkingType();
            const stopResult = await placeStopMarketEntryOrder(
              binanceSymbol,
              side,
              stopPrice,
              sizing.quantity,
              workingType ? { workingType } : {},
            );
            if (stopResult instanceof Error) throw stopResult;
            entryOrder = stopResult;
          }
        } catch (pendingEntryError) {
          const setupKind = (setup as any).setup as string | undefined;
          const fallbackEligible =
            !!setupKind && !!config.entryFallbackToMarketForSetups?.includes(setupKind);
          if (!fallbackEligible) throw pendingEntryError;

          logger.warn(
            `Dat lenh ${preferredEntryType} that bai cho setup ${setupKind} (khong the pre-position that su vi huong lenh chi biet khi breakout xay ra) — fallback sang MARKET`,
            {
              pair: setup.pair,
              binanceSymbol,
              error:
                pendingEntryError instanceof Error
                  ? pendingEntryError.message
                  : String(pendingEntryError),
            },
          );
          resolvedEntryType = "MARKET";
          fellBackToMarket = true;
        }
      }

      if (resolvedEntryType === "MARKET") {
        if (!entryOrder) {
          entryOrder = await placeMarketOrder(binanceSymbol, side, sizing.quantity);
          if (entryOrder instanceof Error) throw entryOrder;
        }

        // Tu day tro di, vi the DA THAT SU MO tren Binance — moi loi khi dat SL/TP
        // phai duoc fail-safe dong lai ngay, khong duoc de vi the "tran" (khong co SL).
        await placeProtectionOrdersAndFinalize(
          config,
          binanceSymbol,
          closeSide,
          slPrice,
          tpPrice,
          entryOrder.orderId,
          positionId,
          sizing,
          leverage,
          logger,
        );

        await sendMessage(
          `✅ ${config.successPrefix} — Đã mở vị thế thật ${setup.direction} ${binanceSymbol}${fellBackToMarket ? " (fallback MARKET — lệnh chờ khớp không đặt được)" : ""}\nQty: ${sizing.quantity} | Leverage: ${leverage}x\nEntry: ${plan.entry} | SL: ${slPrice} | TP: ${tpPrice}`,
        );
      } else if (resolvedEntryType === "LIMIT") {
        const entryPrice = roundToTickSize(plan.entry, filters.tickSize);

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
          `⏳ ${config.successPrefix} — Đã đặt lệnh LIMIT ${setup.direction} ${binanceSymbol}\nGiá: ${entryPrice} | Qty: ${sizing.quantity} | Leverage: ${leverage}x\nSL: ${slPrice} | TP: ${tpPrice}\nChờ khớp...`,
        );
      } else if (resolvedEntryType === "STOP_MARKET") {
        const stopPrice = roundToTickSize(plan.entry, filters.tickSize);

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
          `⏳ ${config.successPrefix} — Đã đặt lệnh STOP_MARKET ${setup.direction} ${binanceSymbol}\nGiá trigger: ${stopPrice} | Qty: ${sizing.quantity} | Leverage: ${leverage}x\nSL: ${slPrice} | TP: ${tpPrice}\nChờ khớp...`,
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
      await recordExecutionFailure(
        config,
        positionId,
        error instanceof Error ? error.message : String(error),
        logger,
      );
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
  tpPrice: number,
  entryOrderId: number,
  positionId: number,
  sizing: { quantity: number },
  leverage: number,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const placedProtectionOrders: number[] = [];
  let slOrderId: number | null = null;
  let tpOrderId: number | null = null;
  const workingType = getConfiguredBinanceWorkingType();
  const workingTypeOption = workingType ? { workingType } : {};

  try {
    const slOrder = await placeStopMarketOrderRetryOn4509(binanceSymbol, closeSide, slPrice, workingTypeOption, logger);
    if (slOrder instanceof Error) throw slOrder;
    slOrderId = slOrder.orderId;
    placedProtectionOrders.push(slOrder.orderId);

    const tpOrder = await placeTakeProfitMarketOrder(
      binanceSymbol,
      closeSide,
      tpPrice,
      workingTypeOption,
    );
    if (tpOrder instanceof Error) throw tpOrder;
    tpOrderId = tpOrder.orderId;
    placedProtectionOrders.push(tpOrder.orderId);
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
      binanceTp1OrderId: tpOrderId,
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
    const hold = (comment: string, confidence = 100): PositionDecisionOutcome => ({
      decision: "HOLD",
      confidence,
      comment,
      managementAction: "NONE",
    });
    const close = (
      comment: string,
      managementAction: PositionDecisionOutcome["managementAction"] = "NONE",
    ): PositionDecisionOutcome => ({
      decision: "CLOSE",
      confidence: 100,
      comment,
      managementAction,
    });
    const cancelTrackedOrder = async (
      orderId: number | null,
      label: "SL" | "TP",
    ): Promise<void> => {
      if (!orderId) return;
      const result = await cancelOrder(symbol, orderId);
      if (result instanceof Error) {
        logger.warn(`Khong huy duoc ${label} order con lai`, {
          pair: position.pair,
          id: position.id,
          orderId,
          error: result,
        });
        await sendCleanupWarning(
          config,
          position.pair,
          `Khong huy duoc ${label} order ${orderId}; kiem tra orphan order tren san.`,
        );
      }
    };

    if (position.binanceExecutionStatus === "close_failed") {
      const positionAmt = await getPositionAmount(symbol);
      if (positionAmt instanceof Error) {
        return hold(
          "Execution Binance close_failed va khong xac minh duoc trang thai vi the tren san",
          30,
        );
      }
      if (positionAmt === 0) {
        return close("Vi the fail-safe da duoc dong tren Binance");
      }
      await sendMessage(
        `🚨🚨 ${config.closeFailedUrgentPrefix} — ${symbol}: vi the van dang mo tren san KHONG CO SL. Mo Binance app va dong tay hoac dat SL ngay.`,
      );
      return hold(
        "Execution Binance close_failed; vi the van dang mo tren san khong co SL",
        20,
      );
    }

    if (position.binanceExecutionStatus === "failed") {
      return close("Execution Binance that bai; vi the da duoc fail-safe dong tren san");
    }

    if (isEmaExitEnabled() && config.getEmaExitTimeframe) {
      const timeframe = config.getEmaExitTimeframe(position);
      const period = getEmaExitPeriod();
      const candlesResult = await fetchOhlcHistory(symbol, timeframe, period + 5);
      if (!(candlesResult instanceof Error) && candlesResult.length > 0) {
        const emaValue = calculateLatestEma(candlesResult, period);
        const lastClose = candlesResult[candlesResult.length - 1].close;
        const emaDecision = resolveEmaExitDecision(
          position.direction,
          lastClose,
          emaValue,
          period,
        );
        if (emaDecision) {
          const positionAmt = await getPositionAmount(symbol);
          if (positionAmt instanceof Error || positionAmt === 0) {
            logger.warn("Khong xac dinh duoc khoi luong de dong vi the theo EMA exit", {
              pair: position.pair,
              id: position.id,
              positionAmt,
            });
          } else {
            await cancelTrackedOrder(position.binanceSlOrderId, "SL");
            await cancelTrackedOrder(position.binanceTp1OrderId, "TP");
            const closeSide: "BUY" | "SELL" =
              position.direction === "LONG" ? "SELL" : "BUY";
            const closeResult = await placeMarketOrder(
              symbol,
              closeSide,
              Math.abs(positionAmt),
              { reduceOnly: true },
            );
            if (!(closeResult instanceof Error)) return emaDecision;

            logger.error("Dong vi the theo EMA exit that bai sau khi da huy SL/TP", {
              pair: position.pair,
              id: position.id,
              error: closeResult,
            });
            await sendMessage(
              `🚨🚨 ${config.failSafeEmergencyMessagePrefix} — ${symbol}: EMA exit da huy SL/TP nhung dong MARKET that bai. Vi the dang mo khong co bao ve; can thiep tay ngay. Loi: ${closeResult.message}`,
            );
            return hold("EMA exit that bai sau khi huy SL/TP; can can thiep tay", 20);
          }
        }
      } else if (candlesResult instanceof Error) {
        logger.warn("Khong fetch duoc candles cho EMA exit check", {
          pair: position.pair,
          id: position.id,
          error: candlesResult,
        });
      }
    }

    if (position.binanceSlOrderId) {
      const slStatus = await getOrderStatus(symbol, position.binanceSlOrderId);
      if (!(slStatus instanceof Error) && slStatus.status === "FILLED") {
        await cancelTrackedOrder(position.binanceTp1OrderId, "TP");
        return {
          decision: "STOP",
          confidence: 100,
          comment: "SL da khop tren Binance Futures",
          managementAction: "NONE",
        };
      }
    }

    if (position.binanceTp1OrderId) {
      const tpStatus = await getOrderStatus(symbol, position.binanceTp1OrderId);
      if (!(tpStatus instanceof Error) && tpStatus.status === "FILLED") {
        await cancelTrackedOrder(position.binanceSlOrderId, "SL");
        return close("TP da khop tren Binance Futures", "TAKE_PROFIT_CLOSE");
      }
    }

    const hasProtectionOrder =
      Boolean(position.binanceSlOrderId) || Boolean(position.binanceTp1OrderId);
    const positionAmt = await getPositionAmount(symbol);
    if (
      !(positionAmt instanceof Error) &&
      positionAmt === 0 &&
      hasProtectionOrder
    ) {
      await cancelTrackedOrder(position.binanceSlOrderId, "SL");
      await cancelTrackedOrder(position.binanceTp1OrderId, "TP");
      return close("Vi the da duoc dong thu cong tren Binance");
    }

    return hold("Vi the dang mo tren Binance Futures, chua co lenh SL/TP nao khop");
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
  return async function pollPendingEntryOrders(timeframe?: "M15" | "M30" | "H1" | "H4" | "D1"): Promise<void> {
    const logger = createLogger(config.loggerName);

    if (config.isHonorOrderTypeEnabled && !config.isHonorOrderTypeEnabled()) {
      return;
    }

    if (!config.getPendingEntryOrderPositions) {
      logger.debug("getPendingEntryOrderPositions not configured, skip polling");
      return;
    }

    let pending = await config.getPendingEntryOrderPositions();

    // Filter by timeframe if provided (only meaningful when getPendingEntryOrderPositions
    // was built with includeTimeframe=true — currently Volman only, see
    // positions-repository-binance-entry-order-shared.ts)
    if (timeframe) {
      pending = pending.filter((p) => p.primaryTimeframe === timeframe);
    }

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
          await sendCleanupWarning(
            config,
            position.pair,
            `Không xác nhận được trạng thái LIMIT entry order (orderId ${position.binanceEntryOrderId}) — bỏ qua lượt kiểm tra này, sẽ thử lại cycle sau.`,
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
          await sendCleanupWarning(
            config,
            position.pair,
            `Không xác nhận được trạng thái STOP_MARKET entry order (orderId ${position.binanceEntryOrderId}) — bỏ qua lượt kiểm tra này, sẽ thử lại cycle sau.`,
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
        const tpPrice = roundToTickSize(Number(position.takeProfit1), filters.tickSize);

        // Quantity THAT SU tren san — quan trong nhat cho STOP_MARKET (algo order khong
        // bao gio tra ve executedQty nen "FILLED" co the la fill mot phan).
        const actualQuantity = await resolveFilledQuantity(
          symbol,
          position.binanceQuantity,
          logger,
        );
        const sizing = { quantity: actualQuantity };

        try {
          await placeProtectionOrdersAndFinalize(
            config,
            symbol,
            closeSide,
            slPrice,
            tpPrice,
            position.binanceEntryOrderId,
            position.id,
            sizing,
            position.binanceLeverage,
            logger,
          );

          await sendMessage(
            `✅ ${config.successPrefix} — Lệnh entry ${symbol} đã khớp, đã đặt SL/TP\nQty: ${actualQuantity} | Leverage: ${position.binanceLeverage}x\nSL: ${slPrice} | TP: ${tpPrice}`,
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
              await sendCleanupWarning(
                config,
                position.pair,
                `Không hủy được phần LIMIT order còn lại chưa khớp sau partial fill (orderId ${position.binanceEntryOrderId}) — có thể tiếp tục khớp thêm ngoài dự kiến, kiểm tra tay.`,
              );
            }
          }

          // Place SL/TP for partial fill
          const closeSide: "BUY" | "SELL" =
            position.direction === "LONG" ? "SELL" : "BUY";
          const filters = await getExchangeInfoFilters(symbol);
          if (!(filters instanceof Error)) {
            const slPrice = roundToTickSize(Number(position.stopLoss), filters.tickSize);
            const tpPrice = roundToTickSize(Number(position.takeProfit1), filters.tickSize);

            const sizing = { quantity: executedQty };
            try {
              await placeProtectionOrdersAndFinalize(
                config,
                symbol,
                closeSide,
                slPrice,
                tpPrice,
                position.binanceEntryOrderId,
                position.id,
                sizing,
                position.binanceLeverage,
                logger,
              );

              await sendMessage(
                `✅ ${config.successPrefix} — Lệnh entry ${symbol} khớp một phần khi hết hạn (qty ${executedQty}), đã đặt SL/TP cho phần đã khớp\nSL: ${slPrice} | TP: ${tpPrice}`,
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
              await sendCleanupWarning(
                config,
                position.pair,
                `Không hủy được LIMIT entry order khi hết hạn (orderId ${position.binanceEntryOrderId}) — bot sẽ thử lại cycle sau.`,
              );
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
              await sendCleanupWarning(
                config,
                position.pair,
                `Không hủy được STOP_MARKET entry order khi hết hạn (orderId ${position.binanceEntryOrderId}) — bot sẽ thử lại cycle sau.`,
              );
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
