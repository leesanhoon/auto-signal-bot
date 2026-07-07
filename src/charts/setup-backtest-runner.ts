import "../shared/env.js";
import { createLogger } from "../shared/logger.js";
import { CHARTS } from "./charts.config.js";
import { fetchOhlcHistory } from "./ohlc-provider.js";
import { runSetupBacktest } from "./setup-backtest.js";
import type { Candle } from "./ohlc-provider.js";
import type { ChartTimeframe } from "./chart-types.js";

const logger = createLogger("charts:setup-backtest");
const VALID_TIMEFRAMES: ChartTimeframe[] = ["M15", "H4", "D1"];

function parseBacktestTimeframe(value: string | undefined): ChartTimeframe {
  const normalized = value?.trim().toUpperCase();

  if (normalized && VALID_TIMEFRAMES.includes(normalized as ChartTimeframe)) {
    return normalized as ChartTimeframe;
  }

  if (normalized) {
    logger.warn(`Invalid BACKTEST_TIMEFRAME=${value}; falling back to H4`);
  }

  return "H4";
}

function parseBacktestBars(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 500;
  }

  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  logger.warn(`Invalid BACKTEST_BARS=${value}; falling back to 500`);
  return 500;
}

async function main(): Promise<void> {
  logger.info("Setup backtest starting");
  const timeframe = parseBacktestTimeframe(process.env.BACKTEST_TIMEFRAME);
  const bars = parseBacktestBars(process.env.BACKTEST_BARS);

  // Collect unique pairs
  const pairMap = new Map<string, { pair: string; symbol: string }>();
  for (const chart of CHARTS) {
    const pairName = chart.name.replace(` ${chart.timeframe}`, "");
    if (!pairMap.has(pairName)) {
      pairMap.set(pairName, { pair: pairName, symbol: chart.symbol });
    }
  }

  const pairs = Array.from(pairMap.values());
  logger.info(`Pairs to backtest: ${pairs.length}`);

  // For each pair, fetch H4 data and run backtest
  const allReports: Array<{ pair: string; report: Awaited<ReturnType<typeof runSetupBacktest>> }> = [];

  for (const { pair, symbol } of pairs) {
    logger.info(`Fetching ${timeframe} data for ${pair}...`);
    const candlesOrError = await fetchOhlcHistory(symbol, timeframe, bars);

    if (candlesOrError instanceof Error) {
      logger.warn(`  ! Skipping ${pair}: ${candlesOrError.message}`);
      continue;
    }

    const candles = candlesOrError as Candle[];
    if (candles.length < 50) {
      logger.warn(`  ! Skipping ${pair}: only ${candles.length} candles`);
      continue;
    }

    logger.info(`  Running backtest on ${candles.length} candles...`);
    const report = runSetupBacktest(candles, pair, timeframe);
    allReports.push({ pair, report });
  }

  // Print summary
  printReport(allReports, timeframe);
}

function printReport(
  reports: Array<{ pair: string; report: Awaited<ReturnType<typeof runSetupBacktest>> }>,
  timeframe: ChartTimeframe,
): void {
  console.log("\n" + "=".repeat(70));
  console.log(`SETUP BACKTEST REPORT (${timeframe})`);
  console.log("=".repeat(70));

  // Aggregate by setup
  const setupAgg: Record<string, { trades: number; wins: number; totalRr: number }> = {};
  const pairAgg: Record<string, { trades: number; wins: number; totalRr: number }> = {};
  let totalTrades = 0;
  let totalWins = 0;
  let totalRr = 0;

  for (const { pair, report } of reports) {
    for (const trade of report.trades) {
      if (trade.outcome === "open_at_end") continue;

      // By setup
      const key = trade.setup;
      if (!setupAgg[key]) setupAgg[key] = { trades: 0, wins: 0, totalRr: 0 };
      setupAgg[key].trades++;
      setupAgg[key].totalRr += trade.realizedRiskReward;
      if (trade.realizedRiskReward > 0) setupAgg[key].wins++;

      // By pair
      if (!pairAgg[pair]) pairAgg[pair] = { trades: 0, wins: 0, totalRr: 0 };
      pairAgg[pair].trades++;
      pairAgg[pair].totalRr += trade.realizedRiskReward;
      if (trade.realizedRiskReward > 0) pairAgg[pair].wins++;

      totalTrades++;
      if (trade.realizedRiskReward > 0) totalWins++;
      totalRr += trade.realizedRiskReward;
    }
  }

  // Overall
  console.log(`\n📊 OVERALL`);
  console.log(`   Trades: ${totalTrades}`);
  console.log(`   Win Rate: ${totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : "N/A"}%`);
  console.log(`   Avg R: ${totalTrades > 0 ? (totalRr / totalTrades).toFixed(2) : "N/A"}R`);

  // By setup
  console.log(`\n📈 BY SETUP`);
  console.log(`   ${"Setup".padEnd(8)} ${"Trades".padEnd(8)} ${"Win Rate".padEnd(10)} ${"Avg R".padEnd(10)}`);
  console.log(`   ${"-".repeat(36)}`);
  for (const [setup, agg] of Object.entries(setupAgg).sort()) {
    const wr = ((agg.wins / agg.trades) * 100).toFixed(1);
    const avgR = (agg.totalRr / agg.trades).toFixed(2);
    console.log(`   ${setup.padEnd(8)} ${String(agg.trades).padEnd(8)} ${(wr + "%").padEnd(10)} ${(avgR + "R").padEnd(10)}`);
  }

  // By pair
  console.log(`\n📊 BY PAIR`);
  console.log(`   ${"Pair".padEnd(10)} ${"Trades".padEnd(8)} ${"Win Rate".padEnd(10)} ${"Avg R".padEnd(10)}`);
  console.log(`   ${"-".repeat(38)}`);
  for (const [pair, agg] of Object.entries(pairAgg).sort()) {
    const wr = ((agg.wins / agg.trades) * 100).toFixed(1);
    const avgR = (agg.totalRr / agg.trades).toFixed(2);
    console.log(`   ${pair.padEnd(10)} ${String(agg.trades).padEnd(8)} ${(wr + "%").padEnd(10)} ${(avgR + "R").padEnd(10)}`);
  }

  console.log("\n" + "=".repeat(70));
}

main().catch((error) => {
  logger.error("Fatal error", { error });
  process.exit(1);
});
