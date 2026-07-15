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
  tradeStage: "open" | "closed" | null;
  riskRewardRatio: number | null;
  minRiskRewardRatio: number | null;
  lastManagementAction: string | null;
  lastManagementComment: string | null;
  lastManagementAt: string | null;
  closeReason: "stop_loss" | "take_profit" | "take_profit_2" | "manual_close" | null;
  realizedRiskRewardRatio: number | null;
  realizedExitPrice: string | null;
  binanceSymbol: string | null;
  binanceLeverage: number | null;
  binanceQuantity: number | null;
  binanceEntryOrderId: number | null;
  binanceSlOrderId: number | null;
  binanceTp1OrderId: number | null;
  binanceExecutionStatus: "pending" | "placed" | "failed" | "close_failed" | null;
  binanceFailureReason: string | null;
  binanceFailureAt: string | null;
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
      "id, pair, direction, setup, entry, stop_loss, take_profit_1, take_profit_2, reasons, opened_at, status, last_decision, last_decision_confidence, last_decision_comment, last_checked_at, closed_at, trade_stage, risk_reward_ratio, min_risk_reward_ratio, last_management_action, last_management_comment, last_management_at, close_reason, realized_risk_reward_ratio, realized_exit_price, binance_symbol, binance_leverage, binance_quantity, binance_entry_order_id, binance_sl_order_id, binance_tp1_order_id, binance_execution_status, binance_failure_reason, binance_failure_at, primary_timeframe",
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
      trade_stage: "open" | "closed" | null;
      risk_reward_ratio: number | null;
      min_risk_reward_ratio: number | null;
      last_management_action: string | null;
      last_management_comment: string | null;
      last_management_at: string | null;
      close_reason?: "stop_loss" | "take_profit" | "take_profit_2" | "manual_close" | null;
      realized_risk_reward_ratio?: number | null;
      realized_exit_price?: string | null;
      binance_symbol: string | null;
      binance_leverage: number | null;
      binance_quantity: number | null;
      binance_entry_order_id: number | null;
      binance_sl_order_id: number | null;
      binance_tp1_order_id: number | null;
      binance_execution_status: "pending" | "placed" | "failed" | "close_failed" | null;
      binance_failure_reason: string | null;
      binance_failure_at: string | null;
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
    riskRewardRatio: row.risk_reward_ratio,
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
    binanceExecutionStatus: row.binance_execution_status ?? null,
    binanceFailureReason: row.binance_failure_reason ?? null,
    binanceFailureAt: row.binance_failure_at ?? null,
  }));
}

export async function loadClosedPositions(since?: string): Promise<ClosedPositionRecord[]> {
  let query = (getDb().from("open_positions_volman") as any)
    .select(
      "id, pair, direction, setup, entry, stop_loss, take_profit_1, take_profit_2, status, closed_at, risk_reward_ratio, last_management_action, close_reason, realized_risk_reward_ratio, realized_exit_price",
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
    risk_reward_ratio: number | null;
    last_management_action: string | null;
    close_reason: "stop_loss" | "take_profit" | "take_profit_2" | "manual_close" | null;
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
    riskRewardRatio: row.risk_reward_ratio,
    lastManagementAction: row.last_management_action,
    closeReason: row.close_reason,
    realizedRiskRewardRatio: row.realized_risk_reward_ratio,
    realizedExitPrice: row.realized_exit_price,
  }));
}

export type TradeOutcome = "win" | "loss" | "breakeven";

export async function getRecentClosedBinanceTradeOutcomes(limit: number): Promise<TradeOutcome[]> {
  const { data, error } = await (getDb().from("open_positions_volman") as any)
    .select("realized_risk_reward_ratio, closed_at")
    .eq("status", "closed")
    .eq("binance_execution_status", "placed")
    .order("closed_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getRecentClosedBinanceTradeOutcomes failed: ${error.message}`);

  return (data ?? []).map((row: { realized_risk_reward_ratio: number | null }) => {
    const r = row.realized_risk_reward_ratio ?? 0;
    if (r > 0) return "win";
    if (r < 0) return "loss";
    return "breakeven";
  });
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
      ...(patch?.lastManagementAction !== undefined ? { last_management_action: patch.lastManagementAction } : {}),
      ...(patch?.lastManagementComment !== undefined ? { last_management_comment: patch.lastManagementComment } : {}),
      ...(patch?.lastManagementAt !== undefined ? { last_management_at: patch.lastManagementAt } : {}),
    })
    .eq("id", id);

  if (error) throw new Error(`updatePositionDecision failed: ${error.message}`);
}

export function buildPositionManagementPatch(
  position: OpenPosition,
  decision: PositionDecisionOutcome,
): { patch: OpenPositionManagementPatch | null; closePosition: boolean } {
  return deriveManagementPatch(decision);
}

export async function closePosition(
  position: OpenPosition,
  decision: PositionDecisionOutcome,
  patch: OpenPositionManagementPatch | null = null,
): Promise<ClosedPositionSnapshot> {
  const closeReason =
    decision.managementAction === "TAKE_PROFIT_CLOSE"
      ? "TAKE_PROFIT_CLOSE"
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
      stopLoss: position.stopLoss,
      takeProfit1: position.takeProfit1,
      takeProfit2: position.takeProfit2,
      status: "closed",
      closedAt: new Date().toISOString(),
      riskRewardRatio: position.riskRewardRatio,
      lastManagementAction: patch?.lastManagementAction ?? position.lastManagementAction,
      closeReason: null,
      realizedRiskRewardRatio: null,
      realizedExitPrice: null,
    },
    closeReason,
    { stopLoss: position.stopLoss },
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

export async function applyBreakevenStopLoss(id: number, entry: string): Promise<void> {
  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({ stop_loss: entry })
    .eq("id", id);

  if (error) throw new Error(`applyBreakevenStopLoss failed: ${error.message}`);
}

export async function applyBinanceBreakevenStopLoss(
  id: number,
  entry: string,
  newSlOrderId: number,
): Promise<void> {
  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({ stop_loss: entry, binance_sl_order_id: newSlOrderId })
    .eq("id", id);

  if (error) throw new Error(`applyBinanceBreakevenStopLoss failed: ${error.message}`);
}

export async function countLiveBinancePositionsVolman(): Promise<number> {
  const { data, error } = await (getDb().from("open_positions_volman") as any)
    .select("id, binance_execution_status, binance_entry_order_status")
    .eq("status", "open");

  if (error) throw new Error(`countLiveBinancePositionsVolman failed: ${error.message}`);

  return (data ?? []).filter(
    (row: { binance_execution_status: string | null; binance_entry_order_status: string | null }) =>
      row.binance_execution_status === "placed" ||
      row.binance_entry_order_status === "working",
  ).length;
}

export type BinanceExecutionDetails = {
  binanceSymbol: string;
  binanceLeverage: number;
  binanceQuantity: number;
  binanceEntryOrderId: number;
  binanceSlOrderId: number | null;
  binanceTp1OrderId: number | null;
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
      binance_execution_status: details.binanceExecutionStatus,
    })
    .eq("id", positionId);

  if (error) throw new Error(`saveBinanceExecutionDetails failed: ${error.message}`);
}

export async function saveBinanceExecutionFailure(
  positionId: number,
  reason: string,
): Promise<void> {
  // KHONG set binance_execution_status "failed" o day — gia tri do mang nghia rieng
  // ("da co lenh that tren san, dat SL/TP fail, bi fail-safe dong khan cap", xem
  // saveBinanceExecutionDetails) va duoc check-open-trades-runner-volman.ts dung de hien thi
  // "dong khan cap fail-safe" trong Telegram. Ham nay duoc goi cho cac guard/catch xay ra
  // TRUOC khi co lenh that (binance_symbol van null) — set "failed" o day se khien vi the
  // signal-only dong binh thuong (cham SL/TP that) bi hien thi nham la fail-safe close.
  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({
      binance_failure_reason: reason.slice(0, 500),
      binance_failure_at: new Date().toISOString(),
    })
    .eq("id", positionId);

  if (error) throw new Error(`saveBinanceExecutionFailure failed: ${error.message}`);
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
