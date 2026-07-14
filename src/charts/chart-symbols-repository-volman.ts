import { getDb } from "../shared/db.js";

export type ChartSymbolRow = {
  name: string;
  symbol: string;
};

export async function loadActiveChartSymbols(): Promise<ChartSymbolRow[]> {
  const { data, error } = await (getDb().from("chart_symbols_volman") as any)
    .select("name, symbol")
    .eq("is_active", true)
    .order("id", { ascending: true });

  if (error) {
    throw new Error(
      `Không tải được chart_symbols_volman: ${error.message ?? String(error)}`,
    );
  }
  if (!data || data.length === 0) {
    throw new Error("chart_symbols_volman không có symbol nào đang active");
  }

  return data as ChartSymbolRow[];
}
