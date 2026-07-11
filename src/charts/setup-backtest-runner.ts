import "../shared/env.js";
import { createLogger } from "../shared/logger.js";
import { CHARTS } from "./volman-charts.config.js";
import { fetchOhlcHistory } from "./ohlc-provider.js";
import { runSetupBacktest } from "./setup-backtest.js";
import type { Candle } from "./ohlc-provider.js";
import type { ChartTimeframe } from "./chart-types-common.js";
import type { ExitMode, FillMode } from "./setup-backtest.js";

const logger = createLogger("charts:setup-backtest");
const VALID_TIMEFRAMES: ChartTimeframe[] = ["M15", "H4", "D1"];

function parseExitMode(value: string | undefined): ExitMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "trailing") return "trailing";
  if (normalized === "swing_trail") return "swing_trail";
  return "fixed";
}

function parseTrailBufferR(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseSwingLookback(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 3;
}

function parseFillMode(value: string | undefined): FillMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "pending" ? "pending" : "immediate";
}

function parsePendingExpiryBars(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 2;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 2;
}

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

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  logger.info("Setup backtest starting");
  const timeframe = parseBacktestTimeframe(process.env.BACKTEST_TIMEFRAME);
  const bars = parseBacktestBars(process.env.BACKTEST_BARS);
  const exitMode = parseExitMode(process.env.BACKTEST_EXIT_MODE);
  const trailBufferR = parseTrailBufferR(process.env.BACKTEST_TRAIL_BUFFER_R);
  const swingLookback = parseSwingLookback(process.env.BACKTEST_SWING_LOOKBACK);
  const fillMode = parseFillMode(process.env.BACKTEST_FILL_MODE);
  const pendingExpiryBars = parsePendingExpiryBars(process.env.BACKTEST_PENDING_EXPIRY_BARS);
  const startingCapital = parsePositiveNumber(process.env.BACKTEST_CAPITAL, 10000);
  const riskPerTrade = parsePositiveNumber(process.env.BACKTEST_RISK_PER_TRADE, 50);
  logger.info(
    `Exit mode: ${exitMode}` +
      (exitMode === "trailing" ? `, buffer=${trailBufferR}R` : "") +
      (exitMode === "swing_trail" ? `, lookback=${swingLookback}` : "") +
      `, fill=${fillMode}${fillMode === "pending" ? ` (expiry=${pendingExpiryBars} bars)` : ""}`,
  );

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
  const allReports: Array<{
    pair: string;
    report: Awaited<ReturnType<typeof runSetupBacktest>>;
  }> = [];

  for (const { pair, symbol } of pairs) {
    logger.info(`Fetching ${timeframe} data for ${pair}...`);
    const candlesOrError = await fetchOhlcHistory(symbol, timeframe, bars, {
      bypassCache: true,
    });

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
    const report = runSetupBacktest(
      candles,
      pair,
      timeframe,
      exitMode,
      trailBufferR,
      swingLookback,
      fillMode,
      pendingExpiryBars,
    );
    allReports.push({ pair, report });
  }

  // Print summary
  printReport(allReports, timeframe, exitMode, fillMode);
  printEquityCurve(allReports, startingCapital, riskPerTrade);
}

function printReport(
  reports: Array<{
    pair: string;
    report: Awaited<ReturnType<typeof runSetupBacktest>>;
  }>,
  timeframe: ChartTimeframe,
  exitMode: ExitMode,
  fillMode: FillMode,
): void {
  console.log("\n" + "=".repeat(70));
  console.log(`SETUP BACKTEST REPORT (${timeframe}, exit=${exitMode}, fill=${fillMode})`);
  console.log("=".repeat(70));

  if (exitMode === "trailing" || exitMode === "swing_trail") {
    const outcomeCounts: Record<string, number> = {};
    for (const { report } of reports) {
      for (const trade of report.trades) {
        if (trade.outcome === "open_at_end") continue;
        outcomeCounts[trade.outcome] = (outcomeCounts[trade.outcome] ?? 0) + 1;
      }
    }
    if (exitMode === "trailing") {
      console.log(`\n🔁 EXIT BREAKDOWN (trailing SL: TP1->BE, TP2->TP1)`);
      console.log(`   stop (SL goc, chua cham TP1): ${outcomeCounts.stop ?? 0}`);
      console.log(`   trail_be (cham TP1, dong hoa von): ${outcomeCounts.trail_be ?? 0}`);
      console.log(`   trail_tp1 (cham TP2, dong tai TP1): ${outcomeCounts.trail_tp1 ?? 0}`);
    } else {
      console.log(`\n🔁 EXIT BREAKDOWN (swing trail sau TP1)`);
      console.log(`   stop (SL goc, chua cham TP1): ${outcomeCounts.stop ?? 0}`);
      console.log(`   trail_swing (cham TP1, dong khi giua bi quet swing SL): ${outcomeCounts.trail_swing ?? 0}`);
    }
  }

  // Aggregate by setup
  const setupAgg: Record<
    string,
    { trades: number; wins: number; totalRr: number }
  > = {};
  const pairAgg: Record<
    string,
    { trades: number; wins: number; totalRr: number }
  > = {};
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

  if (fillMode === "pending") {
    let signalsSeen = 0, filled = 0, cancelledBeforeFill = 0, expired = 0;
    for (const { report } of reports) {
      if (!report.pendingStats) continue;
      signalsSeen += report.pendingStats.signalsSeen;
      filled += report.pendingStats.filled;
      cancelledBeforeFill += report.pendingStats.cancelledBeforeFill;
      expired += report.pendingStats.expired;
    }
    console.log(`\n📥 PENDING ORDER STATS`);
    console.log(`   Signals seen: ${signalsSeen}`);
    console.log(`   Filled: ${filled} (${signalsSeen > 0 ? ((filled / signalsSeen) * 100).toFixed(1) : "0.0"}%)`);
    console.log(`   Cancelled before fill (SL touched first): ${cancelledBeforeFill} (${signalsSeen > 0 ? ((cancelledBeforeFill / signalsSeen) * 100).toFixed(1) : "0.0"}%)`);
    console.log(`   Expired (no touch within window): ${expired} (${signalsSeen > 0 ? ((expired / signalsSeen) * 100).toFixed(1) : "0.0"}%)`);
  }

  // Overall
  console.log(`\n📊 OVERALL`);
  console.log(`   Trades: ${totalTrades}`);
  console.log(
    `   Win Rate: ${totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : "N/A"}%`,
  );
  console.log(
    `   Avg R: ${totalTrades > 0 ? (totalRr / totalTrades).toFixed(2) : "N/A"}R`,
  );

  // By setup
  console.log(`\n📈 BY SETUP`);
  console.log(
    `   ${"Setup".padEnd(8)} ${"Trades".padEnd(8)} ${"Win Rate".padEnd(10)} ${"Avg R".padEnd(10)}`,
  );
  console.log(`   ${"-".repeat(36)}`);
  for (const [setup, agg] of Object.entries(setupAgg).sort()) {
    const wr = ((agg.wins / agg.trades) * 100).toFixed(1);
    const avgR = (agg.totalRr / agg.trades).toFixed(2);
    console.log(
      `   ${setup.padEnd(8)} ${String(agg.trades).padEnd(8)} ${(wr + "%").padEnd(10)} ${(avgR + "R").padEnd(10)}`,
    );
  }

  // By pair
  console.log(`\n📊 BY PAIR`);
  console.log(
    `   ${"Pair".padEnd(10)} ${"Trades".padEnd(8)} ${"Win Rate".padEnd(10)} ${"Avg R".padEnd(10)}`,
  );
  console.log(`   ${"-".repeat(38)}`);
  for (const [pair, agg] of Object.entries(pairAgg).sort()) {
    const wr = ((agg.wins / agg.trades) * 100).toFixed(1);
    const avgR = (agg.totalRr / agg.trades).toFixed(2);
    console.log(
      `   ${pair.padEnd(10)} ${String(agg.trades).padEnd(8)} ${(wr + "%").padEnd(10)} ${(avgR + "R").padEnd(10)}`,
    );
  }

  console.log("\n" + "=".repeat(70));
}

/**
 * Replays every closed trade across all pairs in chronological order (by
 * exit time) applying a fixed dollar risk per trade, to see the actual
 * equity path and max drawdown instead of just the aggregate avg R.
 */
function printEquityCurve(
  reports: Array<{
    pair: string;
    report: Awaited<ReturnType<typeof runSetupBacktest>>;
  }>,
  startingCapital: number,
  riskPerTrade: number,
): void {
  const closedTrades = reports
    .flatMap(({ report }) => report.trades)
    .filter((t) => t.outcome !== "open_at_end" && t.exitTime !== null)
    .sort((a, b) => (a.exitTime as number) - (b.exitTime as number));

  if (closedTrades.length === 0) {
    return;
  }

  let balance = startingCapital;
  let peak = startingCapital;
  let maxDrawdownAbs = 0;
  let maxDrawdownPct = 0;
  let wins = 0;
  let losses = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;

  for (const trade of closedTrades) {
    const pnl = trade.realizedRiskReward * riskPerTrade;
    balance += pnl;

    if (trade.realizedRiskReward > 0) {
      wins++;
      currentLossStreak = 0;
    } else if (trade.realizedRiskReward < 0) {
      losses++;
      currentLossStreak++;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    }

    if (balance > peak) {
      peak = balance;
    }
    const drawdownAbs = peak - balance;
    const drawdownPct = peak > 0 ? (drawdownAbs / peak) * 100 : 0;
    if (drawdownAbs > maxDrawdownAbs) maxDrawdownAbs = drawdownAbs;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
  }

  const totalReturnPct = ((balance - startingCapital) / startingCapital) * 100;
  const firstDate = new Date(closedTrades[0].exitTime as number).toISOString().slice(0, 10);
  const lastDate = new Date(
    closedTrades[closedTrades.length - 1].exitTime as number,
  )
    .toISOString()
    .slice(0, 10);

  console.log("\n" + "=".repeat(70));
  console.log(`EQUITY CURVE (theo thu tu thoi gian thuc te, ${firstDate} -> ${lastDate})`);
  console.log("=".repeat(70));
  console.log(`   Von ban dau: $${startingCapital.toLocaleString()}`);
  console.log(`   Risk moi lenh: $${riskPerTrade.toLocaleString()} (${((riskPerTrade / startingCapital) * 100).toFixed(2)}% von goc)`);
  console.log(`   Von cuoi: $${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`   Tong loi nhuan: ${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(1)}%`);
  console.log(`   Max drawdown: $${maxDrawdownAbs.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${maxDrawdownPct.toFixed(1)}% tu dinh)`);
  console.log(`   Chuoi thua lien tiep dai nhat: ${maxLossStreak} lenh`);
  console.log(`   Thang/Thua: ${wins}/${losses}`);
  console.log("=".repeat(70));
}

main().catch((error) => {
  logger.error("Fatal error", { error });
  process.exit(1);
});
