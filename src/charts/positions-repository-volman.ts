import { getDb } from "../shared/db.js";
import { createLogger } from "../shared/logger.js";
import type { PendingOrder, PendingOrderStatus } from "./chart-types-common.js";
import type { TradeSetup } from "./chart-types-volman.js";
import { getConfiguredPendingOrderExpiryRuns } from "./volman-config-env.js";
import {
  buildOpenPositionInsertRow,
  deriveManagementPatch,
  type OpenPositionManagementPatch,
  type PositionDecisionOutcome,
} from "./position-engine-volman.js";
import { buildClosedPositionSnapshot, type ClosedPositionRecord, type ClosedPositionSnapshot } from "./performance-tracking-volman.js";
import {
  createSaveBinancePendingEntryOrder,
  createUpdateBinanceEntryOrderStatus,
  createGetPendingEntryOrderPositions,
  createCloseExpiredEntryOrderPosition,
} from "./positions-repository-binance-entry-order-shared.js";

const logger = createLogger("charts:positions-repository");

export type OpenPosition = {
  id: number;
  pair: string;
  direction: "LONG" | "SHORT";
  setup: string | null;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string | null;
  reasons: string[] | null;
  openedAt: string;
  status: "open" | "closed";
  primaryTimeframe: "M15" | "M30" | "H1" | "H4" | "D1" | null;
  lastDecision: "HOLD" | "CLOSE" | "STOP" | null;
  lastDecisionConfidence: number | null;
  lastDecisionComment: string | null;
  lastCheckedAt: string | null;
  closedAt: string | null;
  tradeStage: "open" | "tp1_partial" | "trailing" | "closed" | null;
  tp1ClosePercent: number | null;
  tp1ClosedPercent: number | null;
  tp1ClosedAt: string | null;
  trailingStopLoss: string | null;
  trailingStartedAt: string | null;
  riskRewardRatio: number | null;
  tp1RiskRewardRatio: number | null;
  tp2RiskRewardRatio: number | null;
  minRiskRewardRatio: number | null;
  lastManagementAction: string | null;
  lastManagementComment: string | null;
  lastManagementAt: string | null;
  closeReason: "stop_loss" | "take_profit_2" | "manual_close" | null;
  realizedRiskRewardRatio: number | null;
  realizedExitPrice: string | null;
  binanceSymbol: string | null;
  binanceLeverage: number | null;
  binanceQuantity: number | null;
  binanceEntryOrderId: number | null;
  binanceSlOrderId: number | null;
  binanceTp1OrderId: number | null;
  binanceTp2OrderId: number | null;
  binanceExecutionStatus: "pending" | "placed" | "failed" | "close_failed" | null;
};

export type PendingOrderUpdate = {
  status?: PendingOrderStatus;
  runCount?: number;
  resolvedAt?: string | null;
  resolvedReason?: string | null;
  triggeredPositionId?: number | null;
};

export async function saveOpenPosition(setup: TradeSetup): Promise<boolean> {
  const row = buildOpenPositionInsertRow(setup);
  if (!row) {
    logger.warn("Rejected open position due to invalid risk/reward", { pair: setup.pair });
    return false;
  }

  const { data: existing, error: existingError } = await (getDb().from("open_positions_volman") as any)
    .select("id")
    .eq("status", "open")
    .eq("pair", setup.pair)
    .limit(1);

  if (existingError) throw new Error(`saveOpenPosition lookup failed: ${existingError.message}`);
  if ((existing ?? []).length > 0) return false;

  const { error } = await (getDb().from("open_positions_volman") as any).insert(row);
  if (error) throw new Error(`saveOpenPosition insert failed: ${error.message}`);
  return true;
}

function buildPendingOrderInsertRow(setup: TradeSetup): Record<string, unknown> {
  const primaryTimeframe = setup.primaryTimeframe ?? "H4";
  const sourceChartFilepath =
    setup.telegramChart?.filepath ??
    setup.sourceCharts?.find((chart) => chart.timeframe === primaryTimeframe)?.filepath ??
    setup.sourceCharts?.[0]?.filepath ??
    null;

  return {
    pair: setup.pair,
    direction: setup.direction,
    setup: setup.setup,
    order_type: setup.orderType ?? (setup.direction === "SHORT" ? "SELL_STOP" : "BUY_STOP"),
    entry: setup.entry,
    stop_loss: setup.stopLoss,
    take_profit_1: setup.takeProfit1,
    take_profit_2: setup.takeProfit2 || null,
    confidence: setup.confidence,
    reasons: setup.reasons,
    risks: setup.risks,
    primary_timeframe: primaryTimeframe,
    source_chart_filepath: sourceChartFilepath,
    status: "PENDING",
    run_count: 0,
    expiry_runs: getConfiguredPendingOrderExpiryRuns(),
    resolved_at: null,
    resolved_reason: null,
    triggered_position_id: null,
  };
}

export async function savePendingOrder(setup: TradeSetup): Promise<boolean> {
  const row = buildPendingOrderInsertRow(setup);
  const { data: existing, error: existingError } = await (getDb().from("pending_orders_volman") as any)
    .select("id")
    .eq("status", "PENDING")
    .eq("pair", setup.pair)
    .limit(1);

  if (existingError) throw new Error(`savePendingOrder lookup failed: ${existingError.message}`);
  if ((existing ?? []).length > 0) return false;

  const { error } = await (getDb().from("pending_orders_volman") as any).insert(row);
  if (error) throw new Error(`savePendingOrder insert failed: ${error.message}`);
  return true;
}

export async function loadPendingOrders(): Promise<PendingOrder[]> {
  const { data, error } = await (getDb().from("pending_orders_volman") as any)
    .select(
      "id, pair, direction, setup, order_type, entry, stop_loss, take_profit_1, take_profit_2, confidence, reasons, risks, primary_timeframe, source_chart_filepath, status, run_count, expiry_runs, created_at, resolved_at, resolved_reason, triggered_position_id",
    )
    .eq("status", "PENDING")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`loadPendingOrders failed: ${error.message}`);

  return (
    (data ?? []) as Array<{
      id: number;
      pair: string;
      direction: "LONG" | "SHORT";
      setup: string | null;
      order_type: "BUY_STOP" | "SELL_STOP" | "BUY_LIMIT" | "SELL_LIMIT" | "WAIT_FOR_CONFIRMATION";
      entry: string;
      stop_loss: string;
      take_profit_1: string;
      take_profit_2: string | null;
      confidence: number | null;
      reasons: string[] | null;
      risks: string[] | null;
      primary_timeframe: "D1" | "H4" | "M15" | null;
      source_chart_filepath: string | null;
      status: PendingOrderStatus;
      run_count: number;
      expiry_runs: number;
      created_at: string;
      resolved_at: string | null;
      resolved_reason: string | null;
      triggered_position_id: number | null;
    }>
  ).map((row) => ({
    id: row.id,
    pair: row.pair,
    direction: row.direction,
    setup: row.setup,
    orderType: row.order_type,
    entry: row.entry,
    stopLoss: row.stop_loss,
    takeProfit1: row.take_profit_1,
    takeProfit2: row.take_profit_2,
    confidence: row.confidence,
    reasons: row.reasons,
    risks: row.risks,
    primaryTimeframe: row.primary_timeframe,
    sourceChartFilepath: row.source_chart_filepath,
    status: row.status,
    runCount: row.run_count,
    expiryRuns: row.expiry_runs,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedReason: row.resolved_reason,
    triggeredPositionId: row.triggered_position_id,
  }));
}

export async function updatePendingOrder(id: number, patch: PendingOrderUpdate): Promise<void> {
  const { error } = await (getDb().from("pending_orders_volman") as any)
    .update({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.runCount !== undefined ? { run_count: patch.runCount } : {}),
      ...(patch.resolvedAt !== undefined ? { resolved_at: patch.resolvedAt } : {}),
      ...(patch.resolvedReason !== undefined ? { resolved_reason: patch.resolvedReason } : {}),
      ...(patch.triggeredPositionId !== undefined ? { triggered_position_id: patch.triggeredPositionId } : {}),
    })
    .eq("id", id);

  if (error) throw new Error(`updatePendingOrder failed: ${error.message}`);
}

export async function findOpenPositionIdByPair(pair: string): Promise<number | null> {
  const { data, error } = await (getDb().from("open_positions_volman") as any)
    .select("id")
    .eq("status", "open")
    .eq("pair", pair)
    .order("opened_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(`findOpenPositionIdByPair failed: ${error.message}`);
  return (data ?? [])[0]?.id ?? null;
}

export async function loadOpenPairs(): Promise<Set<string>> {
  const { data, error } = await (getDb().from("open_positions_volman") as any)
    .select("pair")
    .eq("status", "open");

  if (error) throw new Error(`loadOpenPairs failed: ${error.message}`);
  return new Set((data ?? []).map((row: { pair: string }) => row.pair));
}

export async function loadOpenPositions(timeframe: "M15" | "M30" | "H1" | "H4" | "D1"): Promise<OpenPosition[]> {
  const { data, error } = await (getDb().from("open_positions_volman") as any)
    .select(
      "id, pair, direction, setup, entry, stop_loss, take_profit_1, take_profit_2, reasons, opened_at, status, last_decision, last_decision_confidence, last_decision_comment, last_checked_at, closed_at, trade_stage, tp1_close_percent, tp1_closed_percent, tp1_closed_at, trailing_stop_loss, trailing_started_at, risk_reward_ratio, tp1_risk_reward_ratio, tp2_risk_reward_ratio, min_risk_reward_ratio, last_management_action, last_management_comment, last_management_at, close_reason, realized_risk_reward_ratio, realized_exit_price, binance_symbol, binance_leverage, binance_quantity, binance_entry_order_id, binance_sl_order_id, binance_tp1_order_id, binance_tp2_order_id, binance_execution_status, primary_timeframe",
    )
    .eq("status", "open")
    .eq("primary_timeframe", timeframe)
    .order("opened_at", { ascending: true });

  if (error) throw new Error(`loadOpenPositions failed: ${error.message}`);
  return (
    (data ?? []) as Array<{
      id: number;
      pair: string;
      direction: "LONG" | "SHORT";
      setup: string | null;
      entry: string;
      stop_loss: string;
      take_profit_1: string;
      take_profit_2: string | null;
      reasons: string[] | null;
      opened_at: string;
      status: "open" | "closed";
      last_decision: "HOLD" | "CLOSE" | "STOP" | null;
      last_decision_confidence: number | null;
      last_decision_comment: string | null;
      last_checked_at: string | null;
      closed_at: string | null;
      trade_stage: "open" | "tp1_partial" | "trailing" | "closed" | null;
      tp1_close_percent: number | null;
      tp1_closed_percent: number | null;
      tp1_closed_at: string | null;
      trailing_stop_loss: string | null;
      trailing_started_at: string | null;
      risk_reward_ratio: number | null;
      tp1_risk_reward_ratio: number | null;
      tp2_risk_reward_ratio: number | null;
      min_risk_reward_ratio: number | null;
      last_management_action: string | null;
      last_management_comment: string | null;
      last_management_at: string | null;
      close_reason?: "stop_loss" | "take_profit_2" | "manual_close" | null;
      realized_risk_reward_ratio?: number | null;
      realized_exit_price?: string | null;
      binance_symbol: string | null;
      binance_leverage: number | null;
      binance_quantity: number | null;
      binance_entry_order_id: number | null;
      binance_sl_order_id: number | null;
      binance_tp1_order_id: number | null;
      binance_tp2_order_id: number | null;
      binance_execution_status: "pending" | "placed" | "failed" | "close_failed" | null;
      primary_timeframe: "M15" | "H1" | "H4" | "D1" | null;
    }>
  ).map((row) => ({
    id: row.id,
    pair: row.pair,
    direction: row.direction,
    setup: row.setup,
    entry: row.entry,
    stopLoss: row.stop_loss,
    takeProfit1: row.take_profit_1,
    takeProfit2: row.take_profit_2,
    reasons: row.reasons,
    openedAt: row.opened_at,
    status: row.status,
    primaryTimeframe: row.primary_timeframe,
    lastDecision: row.last_decision,
    lastDecisionConfidence: row.last_decision_confidence,
    lastDecisionComment: row.last_decision_comment,
    lastCheckedAt: row.last_checked_at,
    closedAt: row.closed_at,
    tradeStage: row.trade_stage,
    tp1ClosePercent: row.tp1_close_percent,
    tp1ClosedPercent: row.tp1_closed_percent,
    tp1ClosedAt: row.tp1_closed_at,
    trailingStopLoss: row.trailing_stop_loss,
    trailingStartedAt: row.trailing_started_at,
    riskRewardRatio: row.risk_reward_ratio,
    tp1RiskRewardRatio: row.tp1_risk_reward_ratio,
    tp2RiskRewardRatio: row.tp2_risk_reward_ratio,
    minRiskRewardRatio: row.min_risk_reward_ratio,
    lastManagementAction: row.last_management_action,
    lastManagementComment: row.last_management_comment,
    lastManagementAt: row.last_management_at,
    closeReason: row.close_reason ?? null,
    realizedRiskRewardRatio: row.realized_risk_reward_ratio ?? null,
    realizedExitPrice: row.realized_exit_price ?? null,
    binanceSymbol: row.binance_symbol ?? null,
    binanceLeverage: row.binance_leverage ?? null,
    binanceQuantity: row.binance_quantity ?? null,
    binanceEntryOrderId: row.binance_entry_order_id ?? null,
    binanceSlOrderId: row.binance_sl_order_id ?? null,
    binanceTp1OrderId: row.binance_tp1_order_id ?? null,
    binanceTp2OrderId: row.binance_tp2_order_id ?? null,
    binanceExecutionStatus: row.binance_execution_status ?? null,
  }));
}

export async function loadClosedPositions(since?: string): Promise<ClosedPositionRecord[]> {
  let query = (getDb().from("open_positions_volman") as any)
    .select(
      "id, pair, direction, setup, entry, stop_loss, take_profit_1, take_profit_2, status, closed_at, tp1_closed_percent, trailing_stop_loss, risk_reward_ratio, tp1_risk_reward_ratio, tp2_risk_reward_ratio, last_management_action, close_reason, realized_risk_reward_ratio, realized_exit_price",
    )
    .eq("status", "closed")
    .order("closed_at", { ascending: true });

  if (since) {
    query = query.gte("closed_at", since);
  }

  const { data, error } = await query;
  if (error) throw new Error(`loadClosedPositions failed: ${error.message}`);

  return ((data ?? []) as Array<{
    id: number;
    pair: string;
    direction: "LONG" | "SHORT";
    setup: string | null;
    entry: string;
    stop_loss: string;
    take_profit_1: string;
    take_profit_2: string | null;
    status: "closed";
    closed_at: string;
    tp1_closed_percent: number | null;
    trailing_stop_loss: string | null;
    risk_reward_ratio: number | null;
    tp1_risk_reward_ratio: number | null;
    tp2_risk_reward_ratio: number | null;
    last_management_action: string | null;
    close_reason: "stop_loss" | "take_profit_2" | "manual_close" | null;
    realized_risk_reward_ratio: number | null;
    realized_exit_price: string | null;
  }>).map((row) => ({
    id: row.id,
    pair: row.pair,
    direction: row.direction,
    setup: row.setup,
    entry: row.entry,
    stopLoss: row.stop_loss,
    takeProfit1: row.take_profit_1,
    takeProfit2: row.take_profit_2,
    status: row.status,
    closedAt: row.closed_at,
    tp1ClosedPercent: row.tp1_closed_percent,
    trailingStopLoss: row.trailing_stop_loss,
    riskRewardRatio: row.risk_reward_ratio,
    tp1RiskRewardRatio: row.tp1_risk_reward_ratio,
    tp2RiskRewardRatio: row.tp2_risk_reward_ratio,
    lastManagementAction: row.last_management_action,
    closeReason: row.close_reason,
    realizedRiskRewardRatio: row.realized_risk_reward_ratio,
    realizedExitPrice: row.realized_exit_price,
  }));
}

export async function updatePositionDecision(
  id: number,
  decision: PositionDecisionOutcome,
  patch: OpenPositionManagementPatch | null = null,
): Promise<void> {
  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({
      last_decision: decision.decision,
      last_decision_confidence: decision.confidence,
      last_decision_comment: decision.comment,
      last_checked_at: new Date().toISOString(),
      ...(patch?.tradeStage !== undefined ? { trade_stage: patch.tradeStage } : {}),
      ...(patch?.tp1ClosedPercent !== undefined ? { tp1_closed_percent: patch.tp1ClosedPercent } : {}),
      ...(patch?.tp1ClosedAt !== undefined ? { tp1_closed_at: patch.tp1ClosedAt } : {}),
      ...(patch?.trailingStopLoss !== undefined ? { trailing_stop_loss: patch.trailingStopLoss } : {}),
      ...(patch?.trailingStartedAt !== undefined ? { trailing_started_at: patch.trailingStartedAt } : {}),
      ...(patch?.lastManagementAction !== undefined ? { last_management_action: patch.lastManagementAction } : {}),
      ...(patch?.lastManagementComment !== undefined ? { last_management_comment: patch.lastManagementComment } : {}),
      ...(patch?.lastManagementAt !== undefined ? { last_management_at: patch.lastManagementAt } : {}),
      ...(patch?.stopLoss !== undefined ? { stop_loss: patch.stopLoss } : {}),
    })
    .eq("id", id);

  if (error) throw new Error(`updatePositionDecision failed: ${error.message}`);
}

export function buildPositionManagementPatch(
  position: OpenPosition,
  decision: PositionDecisionOutcome,
): { patch: OpenPositionManagementPatch | null; closePosition: boolean } {
  return deriveManagementPatch(position.stopLoss, position.entry, decision, {
    partialClosePercent: position.tp1ClosePercent ?? undefined,
    existingTp1ClosedPercent: position.tp1ClosedPercent ?? 0,
  });
}

export async function closePosition(
  position: OpenPosition,
  decision: PositionDecisionOutcome,
  patch: OpenPositionManagementPatch | null = null,
): Promise<ClosedPositionSnapshot> {
  const closeReason =
    decision.tp2Reached || decision.managementAction === "TP2_CLOSE"
      ? "TP2_CLOSE"
      : decision.decision === "CLOSE"
        ? "MANUAL_CLOSE"
        : "STOP";

  const snapshot = buildClosedPositionSnapshot(
    {
      id: position.id,
      pair: position.pair,
      direction: position.direction,
      setup: position.setup,
      entry: position.entry,
      stopLoss: patch?.stopLoss ?? position.stopLoss,
      takeProfit1: position.takeProfit1,
      takeProfit2: position.takeProfit2,
      status: "closed",
      closedAt: new Date().toISOString(),
      tp1ClosedPercent: patch?.tp1ClosedPercent ?? position.tp1ClosedPercent,
      trailingStopLoss: patch?.trailingStopLoss ?? position.trailingStopLoss,
      riskRewardRatio: position.riskRewardRatio,
      tp1RiskRewardRatio: position.tp1RiskRewardRatio,
      tp2RiskRewardRatio: position.tp2RiskRewardRatio,
      lastManagementAction: patch?.lastManagementAction ?? position.lastManagementAction,
      closeReason: null,
      realizedRiskRewardRatio: null,
      realizedExitPrice: null,
    },
    closeReason,
    { stopLoss: patch?.stopLoss ?? position.stopLoss },
  );

  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      trade_stage: "closed",
      close_reason: snapshot.closeReason,
      realized_risk_reward_ratio: snapshot.realizedRiskRewardRatio,
      realized_exit_price: snapshot.realizedExitPrice,
    })
    .eq("id", position.id);

  if (error) throw new Error(`closePosition failed: ${error.message}`);

  return snapshot;
}

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

export async function saveBinanceExecutionDetails(
  positionId: number,
  details: BinanceExecutionDetails,
): Promise<void> {
  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({
      binance_symbol: details.binanceSymbol,
      binance_leverage: details.binanceLeverage,
      binance_quantity: details.binanceQuantity,
      binance_entry_order_id: details.binanceEntryOrderId,
      binance_sl_order_id: details.binanceSlOrderId,
      binance_tp1_order_id: details.binanceTp1OrderId,
      binance_tp2_order_id: details.binanceTp2OrderId,
      binance_execution_status: details.binanceExecutionStatus,
    })
    .eq("id", positionId);

  if (error) throw new Error(`saveBinanceExecutionDetails failed: ${error.message}`);
}

export async function updateBinanceSlOrder(
  positionId: number,
  newSlOrderId: number,
  newStopLoss: string,
): Promise<void> {
  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({
      binance_sl_order_id: newSlOrderId,
      stop_loss: newStopLoss,
    })
    .eq("id", positionId);

  if (error) throw new Error(`updateBinanceSlOrder failed: ${error.message}`);
}

export {
  type BinanceEntryOrderDetails,
  type PendingEntryOrderPosition,
} from "./positions-repository-binance-entry-order-shared.js";

export const saveBinancePendingEntryOrder = createSaveBinancePendingEntryOrder(
  "open_positions_volman",
);
export const updateBinanceEntryOrderStatus = createUpdateBinanceEntryOrderStatus(
  "open_positions_volman",
);
export const getPendingEntryOrderPositions = createGetPendingEntryOrderPositions(
  "open_positions_volman",
  true,
);
export const closeExpiredEntryOrderPosition = createCloseExpiredEntryOrderPosition(
  "open_positions_volman",
);
