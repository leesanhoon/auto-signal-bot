import {
  createOpenBinanceFuturesPosition,
  createReconcileBinancePosition,
  createPollPendingEntryOrder,
  type BinanceExecutionDetails,
} from "./binance-execution-shared.js";
import {
  getConfiguredBinanceRiskUsdPerTrade,
  isBinanceHonorOrderTypeEnabledVolman,
  getConfiguredBinanceEntryOrderExpiryMinutes,
} from "./binance-futures-config-env.js";
import { calculateRiskRewardPlan } from "./position-engine-volman.js";
import {
  saveBinanceExecutionDetails,
  updateBinanceSlOrder,
  saveBinancePendingEntryOrder,
  updateBinanceEntryOrderStatus,
  getPendingEntryOrderPositions,
  closeExpiredEntryOrderPosition,
} from "./positions-repository-volman.js";
import type { PositionDecisionOutcome } from "./position-engine-volman.js";
import type { OpenPosition } from "./positions-repository-volman.js";
import type { TradeSetup } from "./chart-types-volman.js";

const config = {
  systemLabel: "Volman",
  loggerName: "charts:binance-execution",
  calculateRiskRewardPlan: (setup: TradeSetup) => calculateRiskRewardPlan(setup),
  saveBinanceExecutionDetails: (positionId: number, details: BinanceExecutionDetails) =>
    saveBinanceExecutionDetails(positionId, details),
  updateBinanceSlOrder: (positionId: number, orderId: number, stopLoss: string) =>
    updateBinanceSlOrder(positionId, orderId, stopLoss),
  getConfiguredRiskUsdt: getConfiguredBinanceRiskUsdPerTrade,
  // Volman has inconsistent labels: some messages use (Volman), others don't
  guardFailPrefix: "*Binance Futures (Volman)*",
  failSafeMessagePrefix: "*Binance Futures*",
  failSafeEmergencyMessagePrefix: "*Binance Futures — KHẨN CẤP*",
  dbErrorPrefix: "*Binance Futures*",
  successPrefix: "*Binance Futures*",
  entryErrorPrefix: "*Binance Futures*",
  closeFailedUrgentPrefix: "*Binance Futures (Volman) — KHẨN CẤP nhắc lại*",
  tp1MoveSLFailPrefix: "*Binance Futures (Volman) — KHẨN CẤP*",
  // Entry order type support (new in subtask 03, wired in subtask 05)
  entryExecutionMode: (isBinanceHonorOrderTypeEnabledVolman() ? "HONOR_ORDER_TYPE" : "MARKET_ONLY") as "MARKET_ONLY" | "HONOR_ORDER_TYPE",
  entryOrderExpiryMinutes: getConfiguredBinanceEntryOrderExpiryMinutes(),
  saveBinancePendingEntryOrder: (positionId: number, details: any) =>
    saveBinancePendingEntryOrder(positionId, details),
  updateBinanceEntryOrderStatus: (positionId: number, status: any) =>
    updateBinanceEntryOrderStatus(positionId, status),
  getPendingEntryOrderPositions: () => getPendingEntryOrderPositions(),
  closeExpiredEntryOrderPosition: (positionId: number) =>
    closeExpiredEntryOrderPosition(positionId),
  isHonorOrderTypeEnabled: () => isBinanceHonorOrderTypeEnabledVolman(),
  entryOrderExpiredPrefix: "*Binance Futures (Volman)*",
};

export const openBinanceFuturesPosition = createOpenBinanceFuturesPosition<TradeSetup>(config);
export const reconcileBinancePosition = createReconcileBinancePosition<OpenPosition>(config);
export const pollPendingEntryOrders = createPollPendingEntryOrder<OpenPosition>(config);

export type { PositionDecisionOutcome, OpenPosition };
