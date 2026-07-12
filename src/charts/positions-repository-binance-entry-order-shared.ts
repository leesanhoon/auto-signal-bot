import { getDb } from "../shared/db.js";

// Factory shared bởi positions-repository-smc.ts và positions-repository-volman.ts —
// logic pending-entry-order tracking giống hệt nhau giữa 2 hệ, chỉ khác tên bảng.

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
  // Chi co gia tri thuc su khi table nay co cot primary_timeframe (hien chi
  // open_positions_volman co, open_positions_smc KHONG co) — xem includeTimeframe.
  primaryTimeframe?: "M15" | "M30" | "H1" | "H4" | "D1" | null;
};

export function createSaveBinancePendingEntryOrder(table: string) {
  return async function saveBinancePendingEntryOrder(
    positionId: number,
    details: BinanceEntryOrderDetails,
  ): Promise<void> {
    const { error } = await (getDb().from(table) as any)
      .update({
        binance_symbol: details.binanceSymbol,
        binance_leverage: details.binanceLeverage,
        binance_quantity: details.binanceQuantity,
        binance_entry_order_id: details.binanceEntryOrderId,
        binance_entry_order_type: details.binanceEntryOrderType,
        binance_entry_order_status: "working",
        binance_entry_order_placed_at: new Date().toISOString(),
        binance_execution_status: "pending",
      })
      .eq("id", positionId);

    if (error) throw new Error(`saveBinancePendingEntryOrder failed: ${error.message}`);
  };
}

export function createUpdateBinanceEntryOrderStatus(table: string) {
  return async function updateBinanceEntryOrderStatus(
    positionId: number,
    status: "working" | "filled" | "expired" | "cancelled",
  ): Promise<void> {
    const { error } = await (getDb().from(table) as any)
      .update({
        binance_entry_order_status: status,
      })
      .eq("id", positionId);

    if (error) throw new Error(`updateBinanceEntryOrderStatus failed: ${error.message}`);
  };
}

// includeTimeframe: chi truyen true cho table co cot primary_timeframe that
// (hien chi open_positions_volman — open_positions_smc KHONG co cot nay, select
// them se loi "column does not exist").
export function createGetPendingEntryOrderPositions(table: string, includeTimeframe = false) {
  return async function getPendingEntryOrderPositions(): Promise<PendingEntryOrderPosition[]> {
    const baseColumns =
      "id, pair, binance_symbol, binance_entry_order_id, binance_entry_order_type, binance_entry_order_placed_at, direction, stop_loss, take_profit_1, take_profit_2, binance_quantity, binance_leverage, tp1_close_percent";
    const { data, error } = await (getDb().from(table) as any)
      .select(includeTimeframe ? `${baseColumns}, primary_timeframe` : baseColumns)
      .eq("status", "open")
      .eq("binance_entry_order_status", "working")
      .order("binance_entry_order_placed_at", { ascending: true });

    if (error) throw new Error(`getPendingEntryOrderPositions failed: ${error.message}`);

    return (
      (data ?? []) as Array<{
        id: number;
        pair: string;
        binance_symbol: string;
        binance_entry_order_id: number;
        binance_entry_order_type: string;
        binance_entry_order_placed_at: string;
        direction: "LONG" | "SHORT";
        stop_loss: string;
        take_profit_1: string;
        take_profit_2: string | null;
        binance_quantity: number;
        binance_leverage: number | null;
        tp1_close_percent: number | null;
        primary_timeframe?: "M15" | "M30" | "H1" | "H4" | "D1" | null;
      }>
    ).map((row) => ({
      id: row.id,
      pair: row.pair,
      binanceSymbol: row.binance_symbol,
      binanceEntryOrderId: row.binance_entry_order_id,
      binanceEntryOrderType: row.binance_entry_order_type,
      binanceEntryOrderPlacedAt: row.binance_entry_order_placed_at,
      direction: row.direction,
      stopLoss: row.stop_loss,
      takeProfit1: row.take_profit_1,
      takeProfit2: row.take_profit_2,
      binanceQuantity: row.binance_quantity,
      binanceLeverage: row.binance_leverage ?? 1,
      partialClosePercent: row.tp1_close_percent,
      ...(includeTimeframe ? { primaryTimeframe: row.primary_timeframe ?? null } : {}),
    }));
  };
}

// Position ma entry order het han truoc khi khop — chua bao gio thuc su mo tren san,
// khong co snapshot/realized PnL nhu closePosition() day du (dung cho vi the da tung mo).
export function createCloseExpiredEntryOrderPosition(table: string) {
  return async function closeExpiredEntryOrderPosition(positionId: number): Promise<void> {
    const { error } = await (getDb().from(table) as any)
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        trade_stage: "closed",
        close_reason: null,
      })
      .eq("id", positionId);

    if (error) throw new Error(`closeExpiredEntryOrderPosition failed: ${error.message}`);
  };
}
