import "../shared/infra/env.js";
import { loadActiveChartSymbols } from "../charts/chart-symbols-repository-volman.js";
import { toBinanceSymbol } from "../charts/ohlc-provider.js";
import { getExchangeInfoFilters } from "../charts/binance-futures-client.js";
import { notifyError } from "../shared/notification/telegram-client.js";

async function main(): Promise<void> {
  const symbols = await loadActiveChartSymbols();
  const cryptoSymbols = symbols.filter((s) => toBinanceSymbol(s.symbol) !== null);

  console.log("=== Verify chart symbols (Binance Futures) ===");
  console.log(`Checking ${cryptoSymbols.length} active crypto symbol(s)...`);

  const failures: Array<{ name: string; symbol: string; reason: string }> = [];

  for (const { name, symbol } of cryptoSymbols) {
    const futuresSymbol = toBinanceSymbol(symbol)!;
    const result = await getExchangeInfoFilters(futuresSymbol);
    if (result instanceof Error) {
      failures.push({ name, symbol, reason: result.message });
      console.log(`[FAIL] ${name} (${symbol}): ${result.message}`);
    } else {
      console.log(`[PASS] ${name} (${symbol})`);
    }
  }

  if (failures.length > 0) {
    const summary = failures.map((f) => `- ${f.name} (${f.symbol}): ${f.reason}`).join("\n");
    console.error(
      `\n${failures.length} symbol(s) không còn tradeable trên Binance Futures:\n${summary}`,
    );
    await notifyError(
      "Verify chart symbols",
      `${failures.length} symbol đang is_active=true nhưng không còn tradeable trên Binance Futures:\n${summary}\n\nVào Supabase Dashboard (bảng chart_symbols_volman) để tắt/sửa.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nTất cả ${cryptoSymbols.length} symbol crypto đều hợp lệ trên Binance Futures.`);
}

main().catch((error) => {
  console.error(`[FATAL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
