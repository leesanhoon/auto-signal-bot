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
} from "./binance-futures-config-env.js";
import {
  computeOrderQuantity,
  roundToTickSize,
  splitTpQuantities,
} from "./binance-position-sizing.js";
import { toBinanceSymbol } from "./ohlc-provider.js";
import { sendMessage } from "../shared/telegram-client.js";
import { createLogger } from "../shared/logger.js";

export type RiskRewardPlan = {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  partialClosePercent: number;
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
  // Telegram message prefixes to preserve exact strings across systems
  guardFailPrefix: string; // "*Binance Futures (SMC|Volman)*"
  failSafeMessagePrefix: string; // "*Binance Futures (SMC)*" or "*Binance Futures*"
  failSafeEmergencyMessagePrefix: string; // "*Binance Futures (SMC) — KHẨN CẤP*" or "*Binance Futures — KHẨN CẤP*"
  dbErrorPrefix: string; // "*Binance Futures (SMC)*" or "*Binance Futures*"
  successPrefix: string; // "*Binance Futures (SMC)*" or "*Binance Futures*"
  entryErrorPrefix: string; // "*Binance Futures (SMC)*" or "*Binance Futures*"
  closeFailedUrgentPrefix: string; // "*Binance Futures (SMC) — KHẨN CẤP nhắc lại*" or "*Binance Futures (Volman) — KHẨN CẤP nhắc lại*"
  tp1MoveSLFailPrefix: string; // "*Binance Futures (SMC) — KHẨN CẤP*" or "*Binance Futures (Volman) — KHẨN CẤP*"
};

export function createOpenBinanceFuturesPosition<TSetup extends { pair: string; direction: "LONG" | "SHORT" }>(
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

    const leverage = getConfiguredBinanceLeverage();
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

        // "failed" = da dong an toan tren san (closeResult thanh cong), reconcile duoc
        // phep CLOSE ban ghi DB. "close_failed" = dong khan cap CUNG that bai, vi the co
        // the van dang mo tren san KHONG CO SL — reconcile phai tiep tuc theo doi qua
        // getPositionAmount, KHONG duoc coi la da dong.
        const executionStatusAfterFailSafe: "failed" | "close_failed" =
          closeResult instanceof Error ? "close_failed" : "failed";

        try {
          await config.saveBinanceExecutionDetails(positionId, {
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
        return;
      }

      // Vi the da co du SL/TP tren san. Loi DB tu day tro di KHONG duoc kich hoat
      // dong khan cap — vi the tren san van khoe manh, chi can alert de user biet.
      try {
        await config.saveBinanceExecutionDetails(positionId, {
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
          `⚠️ ${config.dbErrorPrefix} — Vị thế ${binanceSymbol} ĐÃ MỞ và CÓ ĐỦ SL/TP trên sàn, nhưng KHÔNG ghi được thông tin execution vào DB (position #${positionId}).\nBot sẽ không tự quản lý vị thế này (reconcile cần order id trong DB) — theo dõi tay trên Binance app cho tới khi SL/TP tự khớp.\nLỗi DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
        );
        return;
      }

      await sendMessage(
        `✅ ${config.successPrefix} — Đã mở vị thế thật ${setup.direction} ${binanceSymbol}\nQty: ${sizing.quantity} | Leverage: ${leverage}x\nEntry: ${plan.entry} | SL: ${slPrice} | TP1: ${tp1Price} | TP2: ${tp2Price ?? "-"}`,
      );
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
        let newSl = await placeStopMarketOrder(symbol, closeSide, bePrice);
        for (let attempt = 2; newSl instanceof Error && attempt <= 3; attempt++) {
          newSl = await placeStopMarketOrder(symbol, closeSide, bePrice);
        }

        if (newSl instanceof Error) {
          logger.error(
            "KHAN CAP: da huy SL cu nhung khong dat lai duoc SL moi sau 3 lan thu — vi the dang KHONG CO SL",
            { pair: position.pair, id: position.id, error: newSl },
          );
          await sendMessage(
            `🚨🚨 ${config.tp1MoveSLFailPrefix} — ${symbol}: đã hủy SL cũ để dời breakeven nhưng KHÔNG đặt lại được SL mới sau 3 lần thử.\n⚠️ VỊ THẾ ĐANG KHÔNG CÓ SL — mở Binance app và đặt SL tay NGAY LẬP TỨC.\nLỗi: ${newSl.message}`,
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
        }

        await config.updateBinanceSlOrder(position.id, newSl.orderId, String(bePrice));
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
