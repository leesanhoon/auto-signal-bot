import type { ChartTimeframe } from "../chart-types-common.js";
import type { Candle } from "../ohlc-provider.js";
import { analyzeSmcSignalsAtIndex } from "./smc-pipeline.js";
import type { SmcGrade, SmcSetupName, SmcSignal } from "./smc-types.js";
import type { HtfContext } from "./smc-htf-context.js";

const loggerName = "charts:smc-backtest";
const MAX_HOLD_BARS = 96;

const PARTIAL_WEIGHTS_WITH_TP3 = { tp1: 0.5, tp2: 0.3, tp3: 0.2 } as const;
const PARTIAL_WEIGHTS_NO_TP3 = { tp1: 0.5, tp2: 0.5 } as const;

const FEE_RATE = Number(process.env.BACKTEST_FEE_RATE ?? "0.001");
const SLIPPAGE_RATE = Number(process.env.BACKTEST_SLIPPAGE_RATE ?? "0.0002");
const TOTAL_COST_RATE = isNaN(FEE_RATE) || FEE_RATE < 0 ? 0.001 : FEE_RATE;
const TOTAL_SLIPPAGE_RATE = isNaN(SLIPPAGE_RATE) || SLIPPAGE_RATE < 0 ? 0.0002 : SLIPPAGE_RATE;
const COST_PER_DIRECTION = Math.max(0, TOTAL_COST_RATE + TOTAL_SLIPPAGE_RATE);

const EXCLUDED_SETUPS = new Set(
  (process.env.BACKTEST_EXCLUDE_SETUPS ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0),
);

const MIN_RISK_PCT = (() => {
  const parsed = Number(process.env.BACKTEST_MIN_RISK_PCT ?? "0");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
})();

function passesMinRisk(signal: SmcSignal): boolean {
  if (MIN_RISK_PCT === 0) return true;
  if (signal.entry === 0) return false;
  const riskPct = (Math.abs(signal.entry - signal.stopLoss) / Math.abs(signal.entry)) * 100;
  return riskPct >= MIN_RISK_PCT;
}

export type SmcBacktestOutcomeCounts = {
  tp1: number;
  tp2: number;
  tp3: number;
  stop: number;
  expired: number;
  expired_hold: number;
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
  outcome: "tp1" | "tp2" | "tp3" | "stop" | "expired" | "expired_hold" | "open_at_end";
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
    expired_hold: 0,
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

function calculateFeeCost(weight: number, entry: number, exitPrice: number, risk: number): number {
  if (risk === 0) return 0;
  return weight * ((entry + exitPrice) * COST_PER_DIRECTION) / risk;
}

function scanOutcome(
  candles: Candle[],
  signal: FilledSignal,
): Pick<SmcBacktestTrade, "exitIndex" | "exitPrice" | "outcome" | "realizedRiskReward"> {
  const { direction, entry, stopLoss, takeProfit1, takeProfit2, takeProfit3, fillIndex } = signal;
  const maxIndex = Math.min(candles.length - 1, fillIndex + MAX_HOLD_BARS);
  const risk = Math.abs(entry - stopLoss);
  const hasTP3 = takeProfit3 !== undefined;
  const weights = hasTP3 ? PARTIAL_WEIGHTS_WITH_TP3 : PARTIAL_WEIGHTS_NO_TP3;

  let currentStop = stopLoss;
  let remainingWeight = 1;
  let realizedR = 0;
  let tp1Done = false;
  let tp2Done = false;
  let tp3Done = false;
  let lastExitPrice = entry;
  let lastTpOutcome: "tp1" | "tp2" | "tp3" | null = null;

  for (let i = fillIndex; i <= maxIndex; i += 1) {
    const candle = candles[i];
    const { high, low, close } = candle;

    if (direction === "LONG") {
      if (low <= currentStop) {
        const closePrice = Math.max(low, currentStop);
        const tradeR = remainingWeight * (closePrice - entry) / risk;
        const costR = calculateFeeCost(remainingWeight, entry, closePrice, risk);
        realizedR += tradeR - costR;
        const outcome = tp1Done ? (lastTpOutcome ?? "tp1") : "stop";
        return {
          exitIndex: i,
          exitPrice: closePrice,
          outcome,
          realizedRiskReward: realizedR,
        };
      }

      if (i > fillIndex) {
        if (!tp1Done && high >= takeProfit1) {
          const tradeR = weights.tp1 * (takeProfit1 - entry) / risk;
          const costR = calculateFeeCost(weights.tp1, entry, takeProfit1, risk);
          realizedR += tradeR - costR;
          remainingWeight -= weights.tp1;
          currentStop = entry;
          tp1Done = true;
          lastExitPrice = takeProfit1;
          lastTpOutcome = "tp1";
        }

        if (!tp2Done && high >= takeProfit2) {
          const tradeR = weights.tp2 * (takeProfit2 - entry) / risk;
          const costR = calculateFeeCost(weights.tp2, entry, takeProfit2, risk);
          realizedR += tradeR - costR;
          remainingWeight -= weights.tp2;
          tp2Done = true;
          lastExitPrice = takeProfit2;
          lastTpOutcome = "tp2";
          if (!hasTP3) {
            return {
              exitIndex: i,
              exitPrice: lastExitPrice,
              outcome: "tp2",
              realizedRiskReward: realizedR,
            };
          }
        }

        if (hasTP3 && !tp3Done && high >= takeProfit3) {
          const tradeR = PARTIAL_WEIGHTS_WITH_TP3.tp3 * (takeProfit3 - entry) / risk;
          const costR = calculateFeeCost(PARTIAL_WEIGHTS_WITH_TP3.tp3, entry, takeProfit3, risk);
          realizedR += tradeR - costR;
          remainingWeight = 0;
          tp3Done = true;
          lastExitPrice = takeProfit3;
          lastTpOutcome = "tp3";
          return {
            exitIndex: i,
            exitPrice: lastExitPrice,
            outcome: "tp3",
            realizedRiskReward: realizedR,
          };
        }
      }
    } else {
      if (high >= currentStop) {
        const closePrice = Math.min(high, currentStop);
        const tradeR = remainingWeight * (entry - closePrice) / risk;
        const costR = calculateFeeCost(remainingWeight, entry, closePrice, risk);
        realizedR += tradeR - costR;
        const outcome = tp1Done ? (lastTpOutcome ?? "tp1") : "stop";
        return {
          exitIndex: i,
          exitPrice: closePrice,
          outcome,
          realizedRiskReward: realizedR,
        };
      }

      if (i > fillIndex) {
        if (!tp1Done && low <= takeProfit1) {
          const tradeR = weights.tp1 * (entry - takeProfit1) / risk;
          const costR = calculateFeeCost(weights.tp1, entry, takeProfit1, risk);
          realizedR += tradeR - costR;
          remainingWeight -= weights.tp1;
          currentStop = entry;
          tp1Done = true;
          lastExitPrice = takeProfit1;
          lastTpOutcome = "tp1";
        }

        if (!tp2Done && low <= takeProfit2) {
          const tradeR = weights.tp2 * (entry - takeProfit2) / risk;
          const costR = calculateFeeCost(weights.tp2, entry, takeProfit2, risk);
          realizedR += tradeR - costR;
          remainingWeight -= weights.tp2;
          tp2Done = true;
          lastExitPrice = takeProfit2;
          lastTpOutcome = "tp2";
          if (!hasTP3) {
            return {
              exitIndex: i,
              exitPrice: lastExitPrice,
              outcome: "tp2",
              realizedRiskReward: realizedR,
            };
          }
        }

        if (hasTP3 && !tp3Done && low <= takeProfit3) {
          const tradeR = PARTIAL_WEIGHTS_WITH_TP3.tp3 * (entry - takeProfit3) / risk;
          const costR = calculateFeeCost(PARTIAL_WEIGHTS_WITH_TP3.tp3, entry, takeProfit3, risk);
          realizedR += tradeR - costR;
          remainingWeight = 0;
          tp3Done = true;
          lastExitPrice = takeProfit3;
          lastTpOutcome = "tp3";
          return {
            exitIndex: i,
            exitPrice: lastExitPrice,
            outcome: "tp3",
            realizedRiskReward: realizedR,
          };
        }
      }
    }
  }

  if (fillIndex + MAX_HOLD_BARS <= candles.length - 1) {
    const exitIndex = fillIndex + MAX_HOLD_BARS;
    const exitPrice = candles[exitIndex].close;
    if (remainingWeight > 0) {
      const partialR = direction === "LONG"
        ? (exitPrice - entry) / risk
        : (entry - exitPrice) / risk;
      const costR = calculateFeeCost(remainingWeight, entry, exitPrice, risk);
      realizedR += remainingWeight * partialR - costR;
    }
    const outcome = lastTpOutcome ?? "expired_hold";
    return {
      exitIndex,
      exitPrice,
      outcome,
      realizedRiskReward: realizedR,
    };
  }

  if (remainingWeight > 0) {
    const finalClose = candles[candles.length - 1].close;
    const partialR = direction === "LONG"
      ? (finalClose - entry) / risk
      : (entry - finalClose) / risk;
    const costR = calculateFeeCost(remainingWeight, entry, finalClose, risk);
    realizedR += remainingWeight * partialR - costR;
  }

  const outcome = lastTpOutcome ?? "open_at_end";
  return {
    exitIndex: lastTpOutcome ? candles.length - 1 : null,
    exitPrice: lastTpOutcome ? candles[candles.length - 1].close : null,
    outcome,
    realizedRiskReward: realizedR,
  };
}

function fillSignal(candles: Candle[], signal: SmcSignal, maxLookahead = 5): FilledSignal | null {
  const start = Math.max(0, signal.triggerIndex + 1);
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
        "Limit entry được xem là fill nếu giá chạm entry zone trong 5 nến SAU nến sinh tín hiệu (không fill trên nến sinh tín hiệu).",
        "Trên nến fill chỉ xét stop loss; TP1/TP2/TP3 xét từ nến sau nến fill.",
        "Partial exit: 50% tại TP1 (SL dời về entry), 30% tại TP2, 20% tại TP3 (không có TP3 thì 50/50); outcome ghi theo TP xa nhất chốt được.",
        "Trade không chạm SL/TP trong 96 nến sau fill sẽ đóng tại close (outcome expired_hold hoặc TP xa nhất đã chốt) và giải phóng slot.",
        `RR đã trừ fee ${(TOTAL_COST_RATE * 100).toFixed(3)}%/chiều và slippage ${(TOTAL_SLIPPAGE_RATE * 100).toFixed(3)}%/chiều (đặt BACKTEST_FEE_RATE=0 và BACKTEST_SLIPPAGE_RATE=0 để xem gross).`,
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
    const allWindowSignals = analyzeSmcSignalsAtIndex(candles, pair, timeframe, index, htfContexts?.[index] ?? null);
    const windowSignals = allWindowSignals.filter(
      (s) => !EXCLUDED_SETUPS.has(s.setup) && passesMinRisk(s),
    );
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
      "Limit entry được xem là fill nếu giá chạm entry zone trong 5 nến SAU nến sinh tín hiệu (không fill trên nến sinh tín hiệu).",
      "Trên nến fill chỉ xét stop loss; TP1/TP2/TP3 xét từ nến sau nến fill.",
      "Partial exit: 50% tại TP1 (SL dời về entry), 30% tại TP2, 20% tại TP3 (không có TP3 thì 50/50); outcome ghi theo TP xa nhất chốt được.",
      "Trade không chạm SL/TP trong 96 nến sau fill sẽ đóng tại close (outcome expired_hold hoặc TP xa nhất đã chốt) và giải phóng slot.",
      `RR đã trừ fee ${(TOTAL_COST_RATE * 100).toFixed(3)}%/chiều và slippage ${(TOTAL_SLIPPAGE_RATE * 100).toFixed(3)}%/chiều (đặt BACKTEST_FEE_RATE=0 và BACKTEST_SLIPPAGE_RATE=0 để xem gross).`,
      "HTF context (bias/dealing-range) được tính lại theo từng thời điểm lịch sử (rolling), chỉ dùng nến HTF đã đóng tính đến thời điểm đó — không look-ahead.",
    ],
  };
}

export function __smcBacktestLoggerName(): string {
  return loggerName;
}
