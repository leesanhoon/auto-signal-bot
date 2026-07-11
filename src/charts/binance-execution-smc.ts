import {
  createOpenBinanceFuturesPosition,
  createReconcileBinancePosition,
  type BinanceExecutionDetails,
} from "./binance-execution-shared.js";
import { calculateRiskRewardPlan } from "./position-engine-smc.js";
import { saveBinanceExecutionDetails, updateBinanceSlOrder } from "./positions-repository-smc.js";
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
};

export const openBinanceFuturesPosition = createOpenBinanceFuturesPosition<TradeSetup>(config);
export const reconcileBinancePosition = createReconcileBinancePosition<OpenPosition>(config);

export type { PositionDecisionOutcome, OpenPosition };
