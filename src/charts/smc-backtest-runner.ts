import "../shared/env.js";
import { createLogger } from "../shared/logger.js";
import { CHARTS } from "./smc-charts.config.js";
import { fetchOhlcHistory } from "./ohlc-provider.js";
import { buildRollingHtfContexts, getHtfTimeframeFor } from "./smc/smc-htf-context.js";
import { runSmcBacktest } from "./smc/smc-backtest.js";
import type { Candle } from "./ohlc-provider.js";
import type { ChartTimeframe } from "./chart-types-common.js";
import type { SmcBacktestReport } from "./smc/smc-backtest.js";

const logger = createLogger("charts:smc-backtest-runner");
const VALID_TIMEFRAMES: ChartTimeframe[] = ["M15", "H1", "H4", "D1"];

function parseBacktestTimeframe(value: string | undefined): ChartTimeframe {
  const normalized = value?.trim().toUpperCase();
  return normalized && VALID_TIMEFRAMES.includes(normalized as ChartTimeframe) ? (normalized as ChartTimeframe) : "H4";
}

function parseBacktestBars(value: string | undefined): number {
  const parsed = Number(value ?? "500");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 500;
}

function parseBacktestEndTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function formatPairSummary(pair: string, report: SmcBacktestReport) {
  const pairStats = report.byPairStats[pair];
  return {
    pair,
    signals: report.signals,
    trades: report.overall.trades,
    winRatePct: round(report.overall.winRate * 100),
    avgRiskReward: round(report.overall.avgRiskReward),
    avgBarsHeld: round(report.overall.avgBarsHeld),
    attemptedTrades: pairStats?.attemptedTrades ?? 0,
    skippedWhileOpen: pairStats?.skippedWhileOpen ?? 0,
    outcomes: {
      tp1: report.outcomes.tp1,
      tp2: report.outcomes.tp2,
      tp3: report.outcomes.tp3,
      stop: report.outcomes.stop,
      expired: report.outcomes.expired,
      expiredHold: report.outcomes.expired_hold,
      openAtEnd: report.outcomes.open_at_end,
    },
  };
}

function summarizeReports(reports: SmcBacktestReport[]) {
  const totals = {
    pairs: reports.length,
    signals: 0,
    trades: 0,
    attemptedTrades: 0,
    skippedWhileOpen: 0,
    weightedRiskReward: 0,
    weightedBarsHeld: 0,
    wins: 0,
    outcomes: {
      tp1: 0,
      tp2: 0,
      tp3: 0,
      stop: 0,
      expired: 0,
      expiredHold: 0,
      openAtEnd: 0,
    },
  };

  for (const report of reports) {
    totals.signals += report.signals;
    totals.trades += report.overall.trades;
    totals.weightedRiskReward += report.overall.avgRiskReward * report.overall.trades;
    totals.weightedBarsHeld += report.overall.avgBarsHeld * report.overall.trades;
    totals.outcomes.tp1 += report.outcomes.tp1;
    totals.outcomes.tp2 += report.outcomes.tp2;
    totals.outcomes.tp3 += report.outcomes.tp3;
    totals.outcomes.stop += report.outcomes.stop;
    totals.outcomes.expired += report.outcomes.expired;
    totals.outcomes.expiredHold += report.outcomes.expired_hold;
    totals.outcomes.openAtEnd += report.outcomes.open_at_end;

    for (const stats of Object.values(report.byPairStats)) {
      totals.attemptedTrades += stats.attemptedTrades;
      totals.skippedWhileOpen += stats.skippedWhileOpen;
      totals.wins += stats.outcomes.tp1 + stats.outcomes.tp2 + stats.outcomes.tp3;
    }
  }

  return {
    pairs: totals.pairs,
    signals: totals.signals,
    trades: totals.trades,
    attemptedTrades: totals.attemptedTrades,
    skippedWhileOpen: totals.skippedWhileOpen,
    winRatePct: totals.trades === 0 ? 0 : round((totals.wins / totals.trades) * 100),
    avgRiskReward: totals.trades === 0 ? 0 : round(totals.weightedRiskReward / totals.trades),
    avgBarsHeld: totals.trades === 0 ? 0 : round(totals.weightedBarsHeld / totals.trades),
    outcomes: totals.outcomes,
  };
}

function summarizeBySetupAndGrade(reports: SmcBacktestReport[]) {
  const allTrades = reports.flatMap((r) => r.trades);
  const closedTrades = allTrades.filter((t) => t.outcome !== "open_at_end" && t.outcome !== "expired");

  function bucket(items: typeof closedTrades) {
    const wins = items.filter((t) => t.realizedRiskReward > 0);
    return {
      trades: items.length,
      winRatePct: items.length ? round((wins.length / items.length) * 100) : 0,
      avgRiskReward: items.length ? round(items.reduce((s, t) => s + t.realizedRiskReward, 0) / items.length) : 0,
    };
  }

  const bySetup: Record<string, ReturnType<typeof bucket>> = {};
  for (const setup of new Set(closedTrades.map((t) => t.setup))) {
    bySetup[setup] = bucket(closedTrades.filter((t) => t.setup === setup));
  }

  const byGrade: Record<string, ReturnType<typeof bucket>> = {};
  for (const trade of closedTrades) {
    if (!trade.grade) continue;
    if (!byGrade[trade.grade]) byGrade[trade.grade] = bucket(closedTrades.filter((t) => t.grade === trade.grade));
  }

  return { bySetup, byGrade };
}

async function main(): Promise<void> {
  const timeframe = parseBacktestTimeframe(process.env.BACKTEST_TIMEFRAME);
  const bars = parseBacktestBars(process.env.BACKTEST_BARS);
  const endTimeMs = parseBacktestEndTime(process.env.BACKTEST_END_TIME);
  logger.info("SMC backtest starting", { timeframe, bars, endTime: process.env.BACKTEST_END_TIME ?? "latest" });
  const pairs = Array.from(new Map(CHARTS.map((chart) => [chart.name.replace(` ${chart.timeframe}`, ""), { pair: chart.name.replace(` ${chart.timeframe}`, ""), symbol: chart.symbol }])).values());
  const reports: SmcBacktestReport[] = [];
  const pairSummaries: ReturnType<typeof formatPairSummary>[] = [];
  for (const { pair, symbol } of pairs) {
    const candlesOrError = await fetchOhlcHistory(symbol, timeframe, bars, { bypassCache: true, endTimeMs });
    if (candlesOrError instanceof Error) {
      logger.warn(`Skip ${pair}: ${candlesOrError.message}`);
      continue;
    }
    const candles = candlesOrError as Candle[];
    const htfTimeframe = getHtfTimeframeFor(timeframe);
    let htfContexts: ReturnType<typeof buildRollingHtfContexts> | undefined;
    if (htfTimeframe) {
      const htfCandlesOrError = await fetchOhlcHistory(symbol, htfTimeframe, 300, { bypassCache: true, endTimeMs });
      if (!(htfCandlesOrError instanceof Error)) {
        htfContexts = buildRollingHtfContexts(htfTimeframe, htfCandlesOrError as Candle[], candles);
      }
    }
    const report = runSmcBacktest(candles, pair, timeframe, htfContexts);
    reports.push(report);
    pairSummaries.push(formatPairSummary(pair, report));
    logger.info("SMC backtest pair complete", { pair, signals: report.signals, trades: report.overall.trades });
    logger.info("SMC backtest pair summary", {
      pair,
      signals: report.signals,
      closedTrades: report.overall.trades,
      winRate: report.overall.winRate,
      avgRiskReward: report.overall.avgRiskReward,
      avgBarsHeld: report.overall.avgBarsHeld,
      skippedWhileOpen: report.byPairStats[pair]?.skippedWhileOpen ?? 0,
      attemptedTrades: report.byPairStats[pair]?.attemptedTrades ?? 0,
      expired: report.outcomes.expired,
      expiredHold: report.outcomes.expired_hold,
      openAtEnd: report.outcomes.open_at_end,
      stop: report.outcomes.stop,
      tp1: report.outcomes.tp1,
      tp2: report.outcomes.tp2,
      tp3: report.outcomes.tp3,
    });
  }

  const setupGradeBreakdown = summarizeBySetupAndGrade(reports);
  console.log(
    JSON.stringify(
      {
        timeframe,
        bars,
        summary: summarizeReports(reports),
        bySetup: setupGradeBreakdown.bySetup,
        byGrade: setupGradeBreakdown.byGrade,
        pairs: pairSummaries,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  logger.error("Fatal error", { error });
  process.exit(1);
});
