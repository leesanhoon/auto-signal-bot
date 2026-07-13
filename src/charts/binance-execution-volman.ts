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
  saveBinanceExecutionFailure,
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
  saveBinanceExecutionFailure: (positionId: number, reason: string) =>
    saveBinanceExecutionFailure(positionId, reason),
  getConfiguredRiskUsdt: getConfiguredBinanceRiskUsdPerTrade,
  guardFailPrefix: "*Binance Futures (Volman)*",
  failSafeMessagePrefix: "*Binance Futures (Volman)*",
  failSafeEmergencyMessagePrefix: "*Binance Futures (Volman) — KHẨN CẤP*",
  dbErrorPrefix: "*Binance Futures (Volman)*",
  successPrefix: "*Binance Futures (Volman)*",
  entryErrorPrefix: "*Binance Futures (Volman)*",
  closeFailedUrgentPrefix: "*Binance Futures (Volman) — KHẨN CẤP nhắc lại*",
  silentFailureWarnPrefix: "*Binance Futures (Volman)*",
  // Entry order type support (new in subtask 03, wired in subtask 05)
  entryExecutionMode: (isBinanceHonorOrderTypeEnabledVolman() ? "HONOR_ORDER_TYPE" : "MARKET_ONLY") as "MARKET_ONLY" | "HONOR_ORDER_TYPE",
  entryOrderExpiryMinutes: getConfiguredBinanceEntryOrderExpiryMinutes(),
  // RB/ARB/IRB khong biet huong lenh truoc khi breakout xay ra (khac BB, huong da xac
  // dinh tu trend) — neu dat LIMIT/STOP that bai (vd -2021 vi gia da vuot muc), fallback
  // sang MARKET NOW thay vi bo lo tin hieu hoan toan.
  entryFallbackToMarketForSetups: ["RB", "ARB", "IRB"],
  saveBinancePendingEntryOrder: (positionId: number, details: any) =>
    saveBinancePendingEntryOrder(positionId, details),
  updateBinanceEntryOrderStatus: (positionId: number, status: any) =>
    updateBinanceEntryOrderStatus(positionId, status),
  getPendingEntryOrderPositions: () => getPendingEntryOrderPositions(),
  closeExpiredEntryOrderPosition: (positionId: number) =>
    closeExpiredEntryOrderPosition(positionId),
  isHonorOrderTypeEnabled: () => isBinanceHonorOrderTypeEnabledVolman(),
  entryOrderExpiredPrefix: "*Binance Futures (Volman)*",
  getEmaExitTimeframe: (position: OpenPosition) => position.primaryTimeframe ?? "H4",
};

export const openBinanceFuturesPosition = createOpenBinanceFuturesPosition<TradeSetup>(config);
export const reconcileBinancePosition = createReconcileBinancePosition<OpenPosition>(config);
export const pollPendingEntryOrders = createPollPendingEntryOrder<OpenPosition>(config);

export type { PositionDecisionOutcome, OpenPosition };
