import {
  createOpenBinanceFuturesPosition,
  createReconcileBinancePosition,
  createPollPendingEntryOrder,
  type BinanceExecutionDetails,
} from "./binance-execution-shared.js";
import { calculateRiskRewardPlan } from "./position-engine-smc.js";
import {
  saveBinanceExecutionDetails,
  updateBinanceSlOrder,
  saveBinancePendingEntryOrder,
  updateBinanceEntryOrderStatus,
  getPendingEntryOrderPositions,
  closeExpiredEntryOrderPosition,
} from "./positions-repository-smc.js";
import {
  isBinanceHonorOrderTypeEnabledSmc,
  getConfiguredBinanceEntryOrderExpiryMinutes,
} from "./binance-futures-config-env.js";
import type { PositionDecisionOutcome } from "./position-engine-smc.js";
import type { OpenPosition } from "./positions-repository-smc.js";
import type { TradeSetup } from "./chart-types-smc.js";

const config = {
  systemLabel: "SMC",
  loggerName: "charts:binance-execution-smc",
  calculateRiskRewardPlan: (setup: TradeSetup) => calculateRiskRewardPlan(setup),
  saveBinanceExecutionDetails: (positionId: number, details: BinanceExecutionDetails) =>
    saveBinanceExecutionDetails(positionId, details),
  updateBinanceSlOrder: (positionId: number, orderId: number, stopLoss: string) =>
    updateBinanceSlOrder(positionId, orderId, stopLoss),
  guardFailPrefix: "*Binance Futures (SMC)*",
  failSafeMessagePrefix: "*Binance Futures (SMC)*",
  failSafeEmergencyMessagePrefix: "*Binance Futures (SMC) — KHẨN CẤP*",
  dbErrorPrefix: "*Binance Futures (SMC)*",
  successPrefix: "*Binance Futures (SMC)*",
  entryErrorPrefix: "*Binance Futures (SMC)*",
  closeFailedUrgentPrefix: "*Binance Futures (SMC) — KHẨN CẤP nhắc lại*",
  tp1MoveSLFailPrefix: "*Binance Futures (SMC) — KHẨN CẤP*",
  // Entry order type support (new in subtask 03, wired in subtask 04)
  entryExecutionMode: (isBinanceHonorOrderTypeEnabledSmc() ? "HONOR_ORDER_TYPE" : "MARKET_ONLY") as "MARKET_ONLY" | "HONOR_ORDER_TYPE",
  entryOrderExpiryMinutes: getConfiguredBinanceEntryOrderExpiryMinutes(),
  saveBinancePendingEntryOrder: (positionId: number, details: any) =>
    saveBinancePendingEntryOrder(positionId, details),
  updateBinanceEntryOrderStatus: (positionId: number, status: any) =>
    updateBinanceEntryOrderStatus(positionId, status),
  getPendingEntryOrderPositions: () => getPendingEntryOrderPositions(),
  closeExpiredEntryOrderPosition: (positionId: number) =>
    closeExpiredEntryOrderPosition(positionId),
  isHonorOrderTypeEnabled: () => isBinanceHonorOrderTypeEnabledSmc(),
  entryOrderExpiredPrefix: "*Binance Futures (SMC)*",
};

export const openBinanceFuturesPosition = createOpenBinanceFuturesPosition<TradeSetup>(config);
export const reconcileBinancePosition = createReconcileBinancePosition<OpenPosition>(config);
export const pollPendingEntryOrders = createPollPendingEntryOrder<OpenPosition>(config);

export type { PositionDecisionOutcome, OpenPosition };
