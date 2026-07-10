import type { ChartTimeframe } from "../chart-types-common.js";
import type { Candle } from "../ohlc-provider.js";
import { analyzeSmcSignalsAtIndex } from "./smc-pipeline.js";
import type { SmcGrade, SmcSetupName, SmcSignal } from "./smc-types.js";
import type { HtfContext } from "./smc-htf-context.js";

const loggerName = "charts:smc-backtest";

export type SmcBacktestOutcomeCounts = {
  tp1: number;
  tp2: number;
  tp3: number;
  stop: number;
  expired: number;
  open_at_end: number;
};

export type SmcBacktestTrade = {
  setup: SmcSetupName;
  pair: string;
  timeframe: ChartTimeframe;
  direction: "LONG" | "SHORT";
  entryIndex: number;
  entryPrice: number;
  exitIndex: number | null;
  exitPrice: number | null;
  outcome: "tp1" | "tp2" | "tp3" | "stop" | "expired" | "open_at_end";
  realizedRiskReward: number;
  confidence: number;
  grade?: SmcGrade;
};

export type SmcBacktestDetailedStats = {
  signals: number;
  skippedWhileOpen: number;
  attemptedTrades: number;
  filledTrades: number;
  closedTrades: number;
  winRate: number;
  avgRiskReward: number;
  avgBarsHeld: number;
  outcomes: SmcBacktestOutcomeCounts;
};

export type SmcBacktestReport = {
  signals: number;
  bySetup: Record<string, { trades: number; winRate: number; avgRiskReward: number }>;
  byPair: Record<string, { trades: number; winRate: number; avgRiskReward: number }>;
  byGrade?: Record<string, { trades: number; winRate: number; avgRiskReward: number }>;
  bySetupStats: Record<string, SmcBacktestDetailedStats>;
  byPairStats: Record<string, SmcBacktestDetailedStats>;
  outcomes: SmcBacktestOutcomeCounts;
  overall: { trades: number; winRate: number; avgRiskReward: number; avgBarsHeld: number };
  trades: SmcBacktestTrade[];
  assumptions: string[];
};

type FilledSignal = SmcSignal & { fillIndex: number };

function createOutcomeCounts(): SmcBacktestOutcomeCounts {
  return {
    tp1: 0,
    tp2: 0,
    tp3: 0,
    stop: 0,
    expired: 0,
    open_at_end: 0,
  };
}

function createDetailedStats(): SmcBacktestDetailedStats {
  return {
    signals: 0,
    skippedWhileOpen: 0,
    attemptedTrades: 0,
    filledTrades: 0,
    closedTrades: 0,
    winRate: 0,
    avgRiskReward: 0,
    avgBarsHeld: 0,
    outcomes: createOutcomeCounts(),
  };
}

function stableFingerprint(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableFingerprint(item)).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableFingerprint(nested)}`);

  return `{${entries.join(",")}}`;
}

function signalFingerprint(signal: SmcSignal): string {
  return stableFingerprint({
    setup: signal.setup,
    direction: signal.direction,
    entry: signal.entry,
    stopLoss: signal.stopLoss,
    takeProfit1: signal.takeProfit1,
    takeProfit2: signal.takeProfit2,
    takeProfit3: signal.takeProfit3,
    entryZone: signal.entryZone,
    structureEvent: signal.structureEvent,
    liquiditySweep: signal.liquiditySweep,
    orderBlock: signal.orderBlock,
    fairValueGap: signal.fairValueGap,
    confidence: signal.confidence,
    grade: signal.grade,
    score: signal.score,
    ruleTrace: signal.ruleTrace,
    market: signal.market,
    session: signal.session,
    sessionLabel: signal.sessionLabel,
    capitalManagement: signal.capitalManagement,
    noSetupReason: signal.noSetupReason,
  });
}

function finalizeDetailedStats(stats: SmcBacktestDetailedStats): SmcBacktestDetailedStats {
  return {
    ...stats,
    winRate: stats.closedTrades > 0 ? stats.winRate / stats.closedTrades : 0,
    avgRiskReward: stats.closedTrades > 0 ? stats.avgRiskReward / stats.closedTrades : 0,
    avgBarsHeld: stats.filledTrades > 0 ? stats.avgBarsHeld / stats.filledTrades : 0,
  };
}

function recordTrade(stats: SmcBacktestDetailedStats, trade: SmcBacktestTrade, candlesLength: number): void {
  stats.attemptedTrades += 1;
  stats.outcomes[trade.outcome] += 1;

  if (trade.outcome !== "expired") {
    stats.filledTrades += 1;
    const barsHeld = trade.exitIndex !== null
      ? Math.max(0, trade.exitIndex - trade.entryIndex)
      : Math.max(0, candlesLength - trade.entryIndex - 1);
    stats.avgBarsHeld += barsHeld;
  }

  if (trade.outcome !== "expired" && trade.outcome !== "open_at_end") {
    stats.closedTrades += 1;
    stats.winRate += trade.realizedRiskReward > 0 ? 1 : 0;
    stats.avgRiskReward += trade.realizedRiskReward;
  }
}

function scanOutcome(
  candles: Candle[],
  signal: FilledSignal,
): Pick<SmcBacktestTrade, "exitIndex" | "exitPrice" | "outcome" | "realizedRiskReward"> {
  const { direction, entry, stopLoss, takeProfit1, takeProfit2, takeProfit3, fillIndex } = signal;
  for (let i = fillIndex; i < candles.length; i += 1) {
    const { high, low } = candles[i];
    if (direction === "LONG") {
      if (low <= stopLoss) {
        return { exitIndex: i, exitPrice: stopLoss, outcome: "stop", realizedRiskReward: (stopLoss - entry) / (entry - stopLoss) };
      }
      if (takeProfit3 !== undefined && high >= takeProfit3) {
        return { exitIndex: i, exitPrice: takeProfit3, outcome: "tp3", realizedRiskReward: (takeProfit3 - entry) / (entry - stopLoss) };
      }
      if (high >= takeProfit2) {
        return { exitIndex: i, exitPrice: takeProfit2, outcome: "tp2", realizedRiskReward: (takeProfit2 - entry) / (entry - stopLoss) };
      }
      if (high >= takeProfit1) {
        return { exitIndex: i, exitPrice: takeProfit1, outcome: "tp1", realizedRiskReward: (takeProfit1 - entry) / (entry - stopLoss) };
      }
    } else {
      if (high >= stopLoss) {
        return { exitIndex: i, exitPrice: stopLoss, outcome: "stop", realizedRiskReward: (entry - stopLoss) / (stopLoss - entry) };
      }
      if (takeProfit3 !== undefined && low <= takeProfit3) {
        return { exitIndex: i, exitPrice: takeProfit3, outcome: "tp3", realizedRiskReward: (entry - takeProfit3) / (stopLoss - entry) };
      }
      if (low <= takeProfit2) {
        return { exitIndex: i, exitPrice: takeProfit2, outcome: "tp2", realizedRiskReward: (entry - takeProfit2) / (stopLoss - entry) };
      }
      if (low <= takeProfit1) {
        return { exitIndex: i, exitPrice: takeProfit1, outcome: "tp1", realizedRiskReward: (entry - takeProfit1) / (stopLoss - entry) };
      }
    }
  }
  return { exitIndex: null, exitPrice: null, outcome: "open_at_end", realizedRiskReward: 0 };
}

function fillSignal(candles: Candle[], signal: SmcSignal, maxLookahead = 5): FilledSignal | null {
  const start = Math.max(0, signal.triggerIndex);
  const end = Math.min(candles.length - 1, start + maxLookahead);
  const zoneLow = signal.entryZone ? Math.min(signal.entryZone.low, signal.entryZone.high) : signal.entry;
  const zoneHigh = signal.entryZone ? Math.max(signal.entryZone.low, signal.entryZone.high) : signal.entry;

  for (let i = start; i <= end; i += 1) {
    const c = candles[i];
    if (signal.direction === "LONG" && c.low <= zoneHigh && c.high >= zoneLow) {
      return { ...signal, fillIndex: i };
    }
    if (signal.direction === "SHORT" && c.high >= zoneLow && c.low <= zoneHigh) {
      return { ...signal, fillIndex: i };
    }
  }
  return null;
}

export function runSmcBacktest(candles: Candle[], pair: string, timeframe: ChartTimeframe, htfContexts?: (HtfContext | null)[]): SmcBacktestReport {
  if (candles.length < 30) {
    return {
      signals: 0,
      bySetup: {},
      byPair: {},
      bySetupStats: {},
      byPairStats: {},
      outcomes: createOutcomeCounts(),
      overall: { trades: 0, winRate: 0, avgRiskReward: 0, avgBarsHeld: 0 },
      trades: [],
      assumptions: [
        "Chỉ dùng candle đóng.",
        "Limit entry được xem là fill nếu giá chạm entry zone trong 5 candle sau tín hiệu.",
        "TP1/TP2/TP3 được tính theo ưu tiên TP3 > TP2 > TP1; nếu không fill thì trade open_at_end.",
        "HTF context (bias/dealing-range) được tính lại theo từng thời điểm lịch sử (rolling), chỉ dùng nến HTF đã đóng tính đến thời điểm đó — không look-ahead.",
      ],
    };
  }

  const trades: SmcBacktestTrade[] = [];
  let openTradeUntilIndex = -1;
  let signalsCount = 0;
  let skippedWhileOpen = 0;
  const pairStats = createDetailedStats();
  const setupStats = new Map<string, SmcBacktestDetailedStats>();
  const lastTakenFingerprintBySetup = new Map<string, string>();

  for (let index = 30; index < candles.length; index += 1) {
    const windowSignals = analyzeSmcSignalsAtIndex(candles, pair, timeframe, index, htfContexts?.[index] ?? null);
    if (windowSignals.length === 0) continue;

    signalsCount += windowSignals.length;
    pairStats.signals += windowSignals.length;
    for (const candidate of windowSignals) {
      const candidateBucket = setupStats.get(candidate.setup) ?? createDetailedStats();
      candidateBucket.signals += 1;
      setupStats.set(candidate.setup, candidateBucket);
    }

    const signal = windowSignals[0];
    const setupBucket = setupStats.get(signal.setup) ?? createDetailedStats();
    const currentFingerprint = signalFingerprint(signal);

    if (index <= openTradeUntilIndex) {
      skippedWhileOpen += windowSignals.length;
      pairStats.skippedWhileOpen += windowSignals.length;
      for (const candidate of windowSignals) {
        const candidateBucket = setupStats.get(candidate.setup) ?? createDetailedStats();
        candidateBucket.skippedWhileOpen += 1;
        setupStats.set(candidate.setup, candidateBucket);
      }
      continue;
    }

    const lastFingerprint = lastTakenFingerprintBySetup.get(signal.setup);
    if (lastFingerprint === currentFingerprint) {
      continue;
    }

    const filled = fillSignal(candles, signal);
    if (!filled) {
      const expiredTrade: SmcBacktestTrade = {
        setup: signal.setup,
        pair,
        timeframe,
        direction: signal.direction,
        entryIndex: signal.triggerIndex,
        entryPrice: signal.entry,
        exitIndex: null,
        exitPrice: null,
        outcome: "expired",
        realizedRiskReward: 0,
        confidence: signal.confidence,
        grade: signal.grade,
      };
      trades.push(expiredTrade);
      recordTrade(pairStats, expiredTrade, candles.length);
      recordTrade(setupBucket, expiredTrade, candles.length);
      setupStats.set(signal.setup, setupBucket);
      continue;
    }

    const outcome = scanOutcome(candles, filled);
    const trade: SmcBacktestTrade = {
      setup: signal.setup,
      pair,
      timeframe,
      direction: signal.direction,
      entryIndex: filled.fillIndex,
      entryPrice: signal.entry,
      ...outcome,
      confidence: signal.confidence,
      grade: signal.grade,
    };
    trades.push(trade);
    recordTrade(pairStats, trade, candles.length);
    recordTrade(setupBucket, trade, candles.length);
    setupStats.set(signal.setup, setupBucket);
    openTradeUntilIndex = outcome.exitIndex ?? candles.length - 1;
    lastTakenFingerprintBySetup.set(signal.setup, currentFingerprint);
  }

  pairStats.skippedWhileOpen = skippedWhileOpen;

  return computeReport(trades, signalsCount, pair, pairStats, setupStats, candles.length);
}

function computeBucket(items: SmcBacktestTrade[]) {
  const closed = items.filter((t) => t.outcome !== "open_at_end" && t.outcome !== "expired");
  const wins = closed.filter((t) => t.realizedRiskReward > 0);
  return {
    trades: closed.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    avgRiskReward: closed.length ? closed.reduce((sum, t) => sum + t.realizedRiskReward, 0) / closed.length : 0,
  };
}

function computeReport(
  trades: SmcBacktestTrade[],
  signals: number,
  pair: string,
  pairStats: SmcBacktestDetailedStats,
  setupStats: Map<string, SmcBacktestDetailedStats>,
  candlesLength: number,
): SmcBacktestReport {
  const bySetup: SmcBacktestReport["bySetup"] = {};
  const byPair: SmcBacktestReport["byPair"] = {};
  const byGrade: NonNullable<SmcBacktestReport["byGrade"]> = {};
  const byPairStats: SmcBacktestReport["byPairStats"] = {};
  const bySetupStats: SmcBacktestReport["bySetupStats"] = {};
  const closedTrades = trades.filter((t) => t.outcome !== "open_at_end" && t.outcome !== "expired");
  const outcomes = createOutcomeCounts();

  for (const trade of closedTrades) {
    bySetup[trade.setup] = computeBucket(closedTrades.filter((t) => t.setup === trade.setup));
    byPair[trade.pair] = computeBucket(closedTrades.filter((t) => t.pair === trade.pair));
    if (trade.grade) byGrade[trade.grade] = computeBucket(closedTrades.filter((t) => t.grade === trade.grade));
  }

  for (const trade of trades) {
    outcomes[trade.outcome] += 1;
  }

  byPairStats[pair] = finalizeDetailedStats(pairStats);
  for (const [setup, stats] of setupStats.entries()) {
    bySetupStats[setup] = finalizeDetailedStats(stats);
  }

  const closedTradeCount = closedTrades.length;
  const overallRiskReward = closedTradeCount
    ? closedTrades.reduce((sum, trade) => sum + trade.realizedRiskReward, 0) / closedTradeCount
    : 0;
  const overallBarsHeld = closedTradeCount
    ? closedTrades.reduce((sum, trade) => sum + Math.max(0, (trade.exitIndex ?? candlesLength - 1) - trade.entryIndex), 0) / closedTradeCount
    : 0;
  const overall = computeBucket(closedTrades);

  return {
    signals,
    bySetup,
    byPair,
    byGrade: Object.keys(byGrade).length ? byGrade : undefined,
    bySetupStats,
    byPairStats,
    outcomes,
    overall: {
      ...overall,
      winRate: overall.winRate,
      avgRiskReward: overallRiskReward,
      avgBarsHeld: overallBarsHeld,
    },
    trades,
    assumptions: [
      "Chỉ dùng candle đóng và không mô phỏng order book.",
      "Limit entry fill nếu giá chạm entry zone trong 5 candle sau tín hiệu.",
      "SL/TP được kiểm tra theo high/low của candle và ưu tiên TP3 > TP2 > TP1.",
      "HTF context (bias/dealing-range) được tính lại theo từng thời điểm lịch sử (rolling), chỉ dùng nến HTF đã đóng tính đến thời điểm đó — không look-ahead.",
    ],
  };
}

export function __smcBacktestLoggerName(): string {
  return loggerName;
}
