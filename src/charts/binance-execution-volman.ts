import {
  createOpenBinanceFuturesPosition,
  createReconcileBinancePosition,
  type BinanceExecutionDetails,
} from "./binance-execution-shared.js";
import { getConfiguredBinanceRiskUsdPerTrade } from "./binance-futures-config-env.js";
import { calculateRiskRewardPlan } from "./position-engine-volman.js";
import { saveBinanceExecutionDetails, updateBinanceSlOrder } from "./positions-repository-volman.js";
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
};

export const openBinanceFuturesPosition = createOpenBinanceFuturesPosition<TradeSetup>(config);
export const reconcileBinancePosition = createReconcileBinancePosition<OpenPosition>(config);

export type { PositionDecisionOutcome, OpenPosition };
