import "../shared/env.js";
import { createLogger } from "../shared/logger.js";
import { CHARTS } from "./volman-charts.config.js";
import { fetchOhlcHistory } from "./ohlc-provider.js";
import { runSetupBacktest } from "./setup-backtest.js";
import type { Candle } from "./ohlc-provider.js";
import type { ChartTimeframe } from "./chart-types-common.js";
import type { ExitMode, SetupBacktestReport } from "./setup-backtest.js";

const logger = createLogger("charts:setup-backtest-compare");
const VALID_TIMEFRAMES: ChartTimeframe[] = ["M15", "H1", "H4", "D1"];

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Agg = { trades: number; wins: number; totalRr: number };

type AggregationResult = {
  overall: Agg;
  bySetup: Record<string, Agg>;
  byPair: Record<string, Agg>;
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function aggregate(
  reports: Array<{ pair: string; report: SetupBacktestReport }>,
): AggregationResult {
  const setupAgg: Record<string, Agg> = {};
  const pairAgg: Record<string, Agg> = {};
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

  return {
    overall: { trades: totalTrades, wins: totalWins, totalRr },
    bySetup: setupAgg,
    byPair: pairAgg,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function getWinRate(wins: number, trades: number): number {
  return trades > 0 ? wins / trades : 0;
}

function getAvgR(totalRr: number, trades: number): number {
  return trades > 0 ? totalRr / trades : 0;
}

function formatWinRatePct(rate: number): string {
  return (rate * 100).toFixed(1) + "%";
}

function formatAvgR(avgR: number): string {
  return avgR.toFixed(2) + "R";
}

function formatDelta(value: number, isPercent: boolean = false): string {
  const sign = value >= 0 ? "+" : "";
  if (isPercent) {
    return sign + value.toFixed(1) + " pp";
  }
  return sign + value.toFixed(2);
}

// ---------------------------------------------------------------------------
// Comparison table printing
// ---------------------------------------------------------------------------

function printComparisonTable(
  label: string,
  immediateAgg: AggregationResult,
  pendingAgg: AggregationResult,
): void {
  console.log("\n" + "=".repeat(100));
  console.log(label);
  console.log("=".repeat(100));

  // Header
  console.log(
    `${"Label".padEnd(15)} ${"Trades (i/p)".padEnd(15)} ${"Win Rate (i/p, Δ pp)".padEnd(25)} ${"Avg R (i/p, Δ)".padEnd(25)}`,
  );
  console.log(`${"-".repeat(100)}`);

  // Overall
  const immOverall = immediateAgg.overall;
  const pendOverall = pendingAgg.overall;
  const immWr = getWinRate(immOverall.wins, immOverall.trades);
  const pendWr = getWinRate(pendOverall.wins, pendOverall.trades);
  const immAvgR = getAvgR(immOverall.totalRr, immOverall.trades);
  const pendAvgR = getAvgR(pendOverall.totalRr, pendOverall.trades);
  const deltaWrPct = (pendWr - immWr) * 100;
  const deltaAvgR = pendAvgR - immAvgR;

  console.log(
    `${"OVERALL".padEnd(15)} ${`${immOverall.trades}/${pendOverall.trades}`.padEnd(15)} ${`${formatWinRatePct(immWr)}/${formatWinRatePct(pendWr)}, ${formatDelta(deltaWrPct, true)}`.padEnd(25)} ${`${formatAvgR(immAvgR)}/${formatAvgR(pendAvgR)}, ${formatDelta(deltaAvgR)}`.padEnd(25)}`,
  );

  // By Setup
  const allSetups = new Set([
    ...Object.keys(immediateAgg.bySetup),
    ...Object.keys(pendingAgg.bySetup),
  ]);
  for (const setup of Array.from(allSetups).sort()) {
    const immSetup = immediateAgg.bySetup[setup];
    const pendSetup = pendingAgg.bySetup[setup];

    const immTrades = immSetup?.trades ?? 0;
    const pendTrades = pendSetup?.trades ?? 0;
    const immWins = immSetup?.wins ?? 0;
    const pendWins = pendSetup?.wins ?? 0;
    const immTotalRr = immSetup?.totalRr ?? 0;
    const pendTotalRr = pendSetup?.totalRr ?? 0;

    const immWr2 = getWinRate(immWins, immTrades);
    const pendWr2 = getWinRate(pendWins, pendTrades);
    const immAvgR2 = getAvgR(immTotalRr, immTrades);
    const pendAvgR2 = getAvgR(pendTotalRr, pendTrades);
    const deltaWrPct2 = (pendWr2 - immWr2) * 100;
    const deltaAvgR2 = pendAvgR2 - immAvgR2;

    const tradesStr = `${immTrades}/${pendTrades}`;
    const wrStr = immTrades > 0 || pendTrades > 0
      ? `${formatWinRatePct(immWr2)}/${formatWinRatePct(pendWr2)}, ${formatDelta(deltaWrPct2, true)}`
      : "N/A";
    const avgRStr = immTrades > 0 || pendTrades > 0
      ? `${formatAvgR(immAvgR2)}/${formatAvgR(pendAvgR2)}, ${formatDelta(deltaAvgR2)}`
      : "N/A";

    console.log(
      `${(`  ${setup}`).padEnd(15)} ${tradesStr.padEnd(15)} ${wrStr.padEnd(25)} ${avgRStr.padEnd(25)}`,
    );
  }

  // By Pair
  const allPairs = new Set([
    ...Object.keys(immediateAgg.byPair),
    ...Object.keys(pendingAgg.byPair),
  ]);
  console.log("");
  for (const pair of Array.from(allPairs).sort()) {
    const immPair = immediateAgg.byPair[pair];
    const pendPair = pendingAgg.byPair[pair];

    const immTrades = immPair?.trades ?? 0;
    const pendTrades = pendPair?.trades ?? 0;
    const immWins = immPair?.wins ?? 0;
    const pendWins = pendPair?.wins ?? 0;
    const immTotalRr = immPair?.totalRr ?? 0;
    const pendTotalRr = pendPair?.totalRr ?? 0;

    const immWr3 = getWinRate(immWins, immTrades);
    const pendWr3 = getWinRate(pendWins, pendTrades);
    const immAvgR3 = getAvgR(immTotalRr, immTrades);
    const pendAvgR3 = getAvgR(pendTotalRr, pendTrades);
    const deltaWrPct3 = (pendWr3 - immWr3) * 100;
    const deltaAvgR3 = pendAvgR3 - immAvgR3;

    const tradesStr = `${immTrades}/${pendTrades}`;
    const wrStr = immTrades > 0 || pendTrades > 0
      ? `${formatWinRatePct(immWr3)}/${formatWinRatePct(pendWr3)}, ${formatDelta(deltaWrPct3, true)}`
      : "N/A";
    const avgRStr = immTrades > 0 || pendTrades > 0
      ? `${formatAvgR(immAvgR3)}/${formatAvgR(pendAvgR3)}, ${formatDelta(deltaAvgR3)}`
      : "N/A";

    console.log(
      `${(`  ${pair}`).padEnd(15)} ${tradesStr.padEnd(15)} ${wrStr.padEnd(25)} ${avgRStr.padEnd(25)}`,
    );
  }

  console.log("=".repeat(100));
}

// ---------------------------------------------------------------------------
// Pending stats aggregation and printing
// ---------------------------------------------------------------------------

function aggregatePendingStats(reports: Array<{ pair: string; report: SetupBacktestReport }>): {
  signalsSeen: number;
  filled: number;
  cancelledBeforeFill: number;
  expired: number;
} {
  let signalsSeen = 0;
  let filled = 0;
  let cancelledBeforeFill = 0;
  let expired = 0;

  for (const { report } of reports) {
    if (report.pendingStats) {
      signalsSeen += report.pendingStats.signalsSeen;
      filled += report.pendingStats.filled;
      cancelledBeforeFill += report.pendingStats.cancelledBeforeFill;
      expired += report.pendingStats.expired;
    }
  }

  return { signalsSeen, filled, cancelledBeforeFill, expired };
}

function printPendingStats(stats: {
  signalsSeen: number;
  filled: number;
  cancelledBeforeFill: number;
  expired: number;
}): void {
  console.log("\n" + "=".repeat(70));
  console.log("PENDING ORDER STATS");
  console.log("=".repeat(70));
  console.log(`Signals seen: ${stats.signalsSeen}`);
  console.log(`Filled: ${stats.filled}`);
  console.log(`Cancelled before fill: ${stats.cancelledBeforeFill}`);
  console.log(`Expired: ${stats.expired}`);

  if (stats.signalsSeen > 0) {
    const filledPct = ((stats.filled / stats.signalsSeen) * 100).toFixed(1);
    const cancelledPct = ((stats.cancelledBeforeFill / stats.signalsSeen) * 100).toFixed(1);
    const expiredPct = ((stats.expired / stats.signalsSeen) * 100).toFixed(1);
    console.log(`Fill rate: ${filledPct}%`);
    console.log(`Cancellation rate: ${cancelledPct}%`);
    console.log(`Expiry rate: ${expiredPct}%`);
  }
  console.log("=".repeat(70));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.info("Setup backtest compare starting");
  const timeframe = parseBacktestTimeframe(process.env.BACKTEST_TIMEFRAME);
  const bars = parseBacktestBars(process.env.BACKTEST_BARS);
  const exitMode = parseExitMode(process.env.BACKTEST_EXIT_MODE);
  const trailBufferR = parseTrailBufferR(process.env.BACKTEST_TRAIL_BUFFER_R);
  const swingLookback = parseSwingLookback(process.env.BACKTEST_SWING_LOOKBACK);
  const pendingExpiryBars = parsePendingExpiryBars(process.env.BACKTEST_PENDING_EXPIRY_BARS);

  logger.info(
    `Config: ${timeframe}, ${bars} bars, exit=${exitMode}` +
      (exitMode === "trailing" ? `, buffer=${trailBufferR}R` : "") +
      (exitMode === "swing_trail" ? `, lookback=${swingLookback}` : "") +
      `, pendingExpiryBars=${pendingExpiryBars}`,
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

  const immediateReports: Array<{ pair: string; report: SetupBacktestReport }> = [];
  const pendingReports: Array<{ pair: string; report: SetupBacktestReport }> = [];

  // For each pair, fetch candles once and run both modes
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

    logger.info(`  Running backtest on ${candles.length} candles (both modes)...`);

    // Run immediate mode
    const immediateReport = runSetupBacktest(
      candles,
      pair,
      timeframe,
      exitMode,
      trailBufferR,
      swingLookback,
      "immediate",
    );
    immediateReports.push({ pair, report: immediateReport });

    // Run pending mode
    const pendingReport = runSetupBacktest(
      candles,
      pair,
      timeframe,
      exitMode,
      trailBufferR,
      swingLookback,
      "pending",
      pendingExpiryBars,
    );
    pendingReports.push({ pair, report: pendingReport });
  }

  // Aggregate results
  const immediateAgg = aggregate(immediateReports);
  const pendingAgg = aggregate(pendingReports);

  // Print comparison tables
  printComparisonTable(
    "BACKTEST A/B COMPARISON: IMMEDIATE vs PENDING",
    immediateAgg,
    pendingAgg,
  );
  printComparisonTable("BY SETUP", immediateAgg, pendingAgg);
  printComparisonTable("BY PAIR", immediateAgg, pendingAgg);

  // Print pending stats
  const pendingStats = aggregatePendingStats(pendingReports);
  printPendingStats(pendingStats);

  // Output JSON summary
  const immOverall = immediateAgg.overall;
  const pendOverall = pendingAgg.overall;
  const immWr = getWinRate(immOverall.wins, immOverall.trades);
  const pendWr = getWinRate(pendOverall.wins, pendOverall.trades);
  const immAvgR = getAvgR(immOverall.totalRr, immOverall.trades);
  const pendAvgR = getAvgR(pendOverall.totalRr, pendOverall.trades);

  const jsonOutput = {
    timeframe,
    bars,
    exitMode,
    trailBufferR,
    swingLookback,
    pendingExpiryBars,
    overall: {
      immediate: {
        trades: immOverall.trades,
        winRate: Math.round(immWr * 10000) / 10000,
        avgR: Math.round(immAvgR * 100) / 100,
      },
      pending: {
        trades: pendOverall.trades,
        winRate: Math.round(pendWr * 10000) / 10000,
        avgR: Math.round(pendAvgR * 100) / 100,
      },
      deltaWinRatePct: Math.round((pendWr - immWr) * 10000) / 100,
      deltaAvgR: Math.round((pendAvgR - immAvgR) * 100) / 100,
      deltaTrades: pendOverall.trades - immOverall.trades,
    },
    bySetup: Object.fromEntries(
      Array.from(
        new Set([
          ...Object.keys(immediateAgg.bySetup),
          ...Object.keys(pendingAgg.bySetup),
        ]),
      ).map((setup) => {
        const immSetup = immediateAgg.bySetup[setup];
        const pendSetup = pendingAgg.bySetup[setup];
        const immTrades = immSetup?.trades ?? 0;
        const pendTrades = pendSetup?.trades ?? 0;
        const immWins = immSetup?.wins ?? 0;
        const pendWins = pendSetup?.wins ?? 0;
        const immTotalRr = immSetup?.totalRr ?? 0;
        const pendTotalRr = pendSetup?.totalRr ?? 0;
        const immWr2 = getWinRate(immWins, immTrades);
        const pendWr2 = getWinRate(pendWins, pendTrades);
        const immAvgR2 = getAvgR(immTotalRr, immTrades);
        const pendAvgR2 = getAvgR(pendTotalRr, pendTrades);
        return [
          setup,
          {
            immediate: {
              trades: immTrades,
              winRate: Math.round(immWr2 * 10000) / 10000,
              avgR: Math.round(immAvgR2 * 100) / 100,
            },
            pending: {
              trades: pendTrades,
              winRate: Math.round(pendWr2 * 10000) / 10000,
              avgR: Math.round(pendAvgR2 * 100) / 100,
            },
          },
        ];
      }),
    ),
    byPair: Object.fromEntries(
      Array.from(
        new Set([...Object.keys(immediateAgg.byPair), ...Object.keys(pendingAgg.byPair)]),
      ).map((pair) => {
        const immPair = immediateAgg.byPair[pair];
        const pendPair = pendingAgg.byPair[pair];
        const immTrades = immPair?.trades ?? 0;
        const pendTrades = pendPair?.trades ?? 0;
        const immWins = immPair?.wins ?? 0;
        const pendWins = pendPair?.wins ?? 0;
        const immTotalRr = immPair?.totalRr ?? 0;
        const pendTotalRr = pendPair?.totalRr ?? 0;
        const immWr3 = getWinRate(immWins, immTrades);
        const pendWr3 = getWinRate(pendWins, pendTrades);
        const immAvgR3 = getAvgR(immTotalRr, immTrades);
        const pendAvgR3 = getAvgR(pendTotalRr, pendTrades);
        return [
          pair,
          {
            immediate: {
              trades: immTrades,
              winRate: Math.round(immWr3 * 10000) / 10000,
              avgR: Math.round(immAvgR3 * 100) / 100,
            },
            pending: {
              trades: pendTrades,
              winRate: Math.round(pendWr3 * 10000) / 10000,
              avgR: Math.round(pendAvgR3 * 100) / 100,
            },
          },
        ];
      }),
    ),
    pendingStats,
  };

  console.log("\n" + JSON.stringify(jsonOutput, null, 2));
}

main().catch((error) => {
  logger.error("Fatal error", { error });
  process.exit(1);
});
