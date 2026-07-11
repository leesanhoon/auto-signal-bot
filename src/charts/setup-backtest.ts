import type { Candle } from "./ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "./setup-types.js";
import type { ChartTimeframe } from "./chart-types-common.js";
import { calculateEma, calculateAtr, isFalseBreak } from "./indicators.js";
import { detectBb } from "./setups/bb.js";
import { detectRb } from "./setups/rb.js";
import { detectArb } from "./setups/arb.js";
import { detectIrb } from "./setups/irb.js";
import { resolveSetupConflicts } from "./setup-resolver.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:setup-backtest");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExitMode = "fixed" | "trailing" | "swing_trail";

export type FillMode = "immediate" | "pending";

export type SetupBacktestTrade = {
  setup: SetupKind;
  pair: string;
  timeframe: ChartTimeframe;
  direction: "LONG" | "SHORT";
  entryIndex: number;
  entryPrice: number;
  entryTime: number;
  exitIndex: number | null;
  exitPrice: number | null;
  exitTime: number | null;
  outcome:
    | "tp1"
    | "tp2"
    | "stop"
    | "trail_be"
    | "trail_tp1"
    | "trail_swing"
    | "open_at_end";
  realizedRiskReward: number;
  confidence: number;
};

export type SetupBacktestReport = {
  bySetup: Partial<Record<SetupKind, { trades: number; winRate: number; avgRiskReward: number }>>;
  byPair: Record<string, { trades: number; winRate: number; avgRiskReward: number }>;
  overall: { trades: number; winRate: number; avgRiskReward: number };
  trades: SetupBacktestTrade[];
  pendingStats?: {
    signalsSeen: number;
    filled: number;
    cancelledBeforeFill: number;
    expired: number;
  };
};

type OpenTradeState = {
  signal: DetectedSignal;
  trade: SetupBacktestTrade;
  triggerIndex: number;
  committed: boolean;
};

type PendingFalseBreak = {
  signal: DetectedSignal;
  triggerIndex: number;
};

type PendingOrderState = {
  signal: DetectedSignal;
  triggerIndex: number;
  orderStartIndex: number;
  deadlineIndex: number;
};

type PendingModeStats = {
  signalsSeen: number;
  filled: number;
  cancelledBeforeFill: number;
  expired: number;
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Walk-forward backtest mirroring live behavior: one open trade at a time,
 * one false-break watch per open trade. A confirmed false break invalidates
 * the pending signal outright (SB reversal retired — too rare to have edge).
 */
export function runSetupBacktest(
  candles: Candle[],
  pair: string,
  timeframe: ChartTimeframe,
  exitMode: ExitMode = "fixed",
  trailBufferR = 0,
  swingLookback = 3,
  fillMode: FillMode = "immediate",
  pendingExpiryBars = 2,
): SetupBacktestReport {
  const ema20 = calculateEma(candles, 20);
  const atr14 = calculateAtr(candles, 14);

  const trades: SetupBacktestTrade[] = [];
  let openTrade: OpenTradeState | null = null;
  let watchingFalseBreak: PendingFalseBreak | null = null;
  let pendingOrder: PendingOrderState | null = null;
  const pendingStats: PendingModeStats = { signalsSeen: 0, filled: 0, cancelledBeforeFill: 0, expired: 0 };

  const detectors: Array<(c: Candle[], i: number, ctx: DetectionContext) => DetectedSignal | null> = [
    detectBb,
    detectRb,
    detectArb,
    detectIrb,
  ];

  const startIndex = Math.min(30, candles.length);

  for (let index = startIndex; index < candles.length; index++) {
    const ctx: DetectionContext = {
      ema20,
      atr14,
      pair,
      timeframe,
    };

    if (
      openTrade !== null &&
      openTrade.committed &&
      (openTrade.trade.exitIndex === null || index > openTrade.trade.exitIndex)
    ) {
      openTrade = null;
    }

    // Handle pending order resolution (pending mode only)
    if (fillMode === "pending" && pendingOrder !== null && index >= pendingOrder.orderStartIndex) {
      const { high, low } = candles[index];
      const { entry, stopLoss, direction } = pendingOrder.signal;

      const invalidated = direction === "LONG" ? low <= stopLoss : high >= stopLoss;
      if (invalidated) {
        pendingStats.cancelledBeforeFill++;
        pendingOrder = null;
      } else {
        const triggered = direction === "LONG" ? high >= entry : low <= entry;
        if (triggered) {
          const trade = buildTrade(candles, pendingOrder.signal, exitMode, trailBufferR, swingLookback, index);
          trades.push(trade);
          pendingStats.filled++;
          openTrade = { signal: pendingOrder.signal, trade, triggerIndex: pendingOrder.triggerIndex, committed: true };
          pendingOrder = null;
        } else if (index >= pendingOrder.deadlineIndex) {
          pendingStats.expired++;
          pendingOrder = null;
        }
      }
    }

    if (fillMode === "immediate" && watchingFalseBreak !== null && index >= watchingFalseBreak.triggerIndex + 2) {
      const entry = watchingFalseBreak.signal.entry;
      const stop = watchingFalseBreak.signal.stopLoss;
      const levelHigh = Math.max(entry, stop);
      const levelLow = Math.min(entry, stop);

      const falseBreak = isFalseBreak(
        candles,
        watchingFalseBreak.triggerIndex,
        levelHigh,
        levelLow,
        watchingFalseBreak.signal.direction,
        2,
      );

      if (falseBreak) {
        if (openTrade !== null && openTrade.triggerIndex === watchingFalseBreak.triggerIndex) {
          openTrade = null;
        }
      } else if (openTrade !== null && !openTrade.committed) {
        trades.push(openTrade.trade);
        openTrade.committed = true;
        if (openTrade.trade.exitIndex === null || index >= openTrade.trade.exitIndex) {
          openTrade = null;
        }
      }

      watchingFalseBreak = null;
    }

    const freshSignals: DetectedSignal[] = [];
    const canDetectSignal = fillMode === "pending"
      ? (openTrade === null && pendingOrder === null)
      : (openTrade === null);

    if (canDetectSignal) {
      for (const detector of detectors) {
        try {
          const signal = detector(candles, index, ctx);
          if (signal) {
            freshSignals.push(signal);
          }
        } catch {
          // Skip detector on error.
        }
      }
    }

    const resolvedSignals = resolveSetupConflicts(freshSignals);
    if (resolvedSignals.length === 0) {
      continue;
    }

    const signal = resolvedSignals[0];

    if (fillMode === "pending") {
      // In pending mode: create a pending order instead of immediately filling
      pendingStats.signalsSeen++;
      pendingOrder = {
        signal,
        triggerIndex: signal.triggerIndex,
        orderStartIndex: signal.triggerIndex + 1,
        deadlineIndex: signal.triggerIndex + pendingExpiryBars,
      };
    } else {
      // In immediate mode: fill trade immediately (original behavior)
      const trade = buildTrade(candles, signal, exitMode, trailBufferR, swingLookback);

      openTrade = {
        signal,
        trade,
        triggerIndex: signal.triggerIndex,
        committed: false,
      };
      watchingFalseBreak = {
        signal,
        triggerIndex: signal.triggerIndex,
      };
    }
  }

  const report = computeReport(trades);
  if (fillMode === "pending") {
    report.pendingStats = { ...pendingStats };
  }
  return report;
}

function buildTrade(
  candles: Candle[],
  signal: DetectedSignal,
  exitMode: ExitMode,
  trailBufferR: number,
  swingLookback: number,
  entryIndexOverride?: number,
): SetupBacktestTrade {
  const entryIndex = entryIndexOverride ?? signal.triggerIndex;
  const outcome =
    exitMode === "trailing"
      ? scanOutcomeTrailing(candles, signal, entryIndex, trailBufferR)
      : exitMode === "swing_trail"
        ? scanOutcomeSwingTrail(candles, signal, entryIndex, swingLookback)
        : scanOutcome(candles, signal, entryIndex);
  return {
    setup: signal.setup,
    pair: signal.pair,
    timeframe: signal.timeframe,
    direction: signal.direction,
    entryIndex,
    entryPrice: signal.entry,
    entryTime: candles[entryIndex].time,
    exitIndex: outcome.exitIndex,
    exitPrice: outcome.exitPrice,
    exitTime: outcome.exitIndex !== null ? candles[outcome.exitIndex].time : null,
    outcome: outcome.outcome,
    realizedRiskReward: outcome.realizedRiskReward,
    confidence: signal.confidence,
  };
}

// ---------------------------------------------------------------------------
// Forward scan
// ---------------------------------------------------------------------------

function scanOutcome(
  candles: Candle[],
  signal: DetectedSignal,
  entryIndex: number,
): {
  exitIndex: number | null;
  exitPrice: number | null;
  outcome: SetupBacktestTrade["outcome"];
  realizedRiskReward: number;
} {
  const { entry, stopLoss, takeProfit1, takeProfit2, direction } = signal;

  for (let i = entryIndex; i < candles.length; i++) {
    const { high, low } = candles[i];

    if (direction === "LONG") {
      if (low <= stopLoss) {
        const exitPrice = stopLoss;
        const rr = (exitPrice - entry) / (entry - stopLoss);
        return { exitIndex: i, exitPrice, outcome: "stop", realizedRiskReward: rr };
      }
      if (high >= takeProfit2) {
        const exitPrice = takeProfit2;
        const rr = (exitPrice - entry) / (entry - stopLoss);
        return { exitIndex: i, exitPrice, outcome: "tp2", realizedRiskReward: rr };
      }
      if (high >= takeProfit1) {
        const exitPrice = takeProfit1;
        const rr = (exitPrice - entry) / (entry - stopLoss);
        return { exitIndex: i, exitPrice, outcome: "tp1", realizedRiskReward: rr };
      }
    } else {
      if (high >= stopLoss) {
        const exitPrice = stopLoss;
        const rr = (entry - exitPrice) / (stopLoss - entry);
        return { exitIndex: i, exitPrice, outcome: "stop", realizedRiskReward: rr };
      }
      if (low <= takeProfit2) {
        const exitPrice = takeProfit2;
        const rr = (entry - exitPrice) / (stopLoss - entry);
        return { exitIndex: i, exitPrice, outcome: "tp2", realizedRiskReward: rr };
      }
      if (low <= takeProfit1) {
        const exitPrice = takeProfit1;
        const rr = (entry - exitPrice) / (stopLoss - entry);
        return { exitIndex: i, exitPrice, outcome: "tp1", realizedRiskReward: rr };
      }
    }
  }

  return {
    exitIndex: null,
    exitPrice: null,
    outcome: "open_at_end",
    realizedRiskReward: 0,
  };
}

/**
 * Trailing variant: TP1 hit -> SL moves to entry (breakeven).
 * TP2 hit -> SL moves to TP1. Trade stays open (no fixed target)
 * until price comes back and hits the trailed SL, or data runs out.
 *
 * `trailBufferR` (fraction of the initial risk) pulls the trailed SL back
 * behind the breakeven/TP1 level instead of sitting exactly on it, so a
 * shallow pullback doesn't sweep the trade the instant it touches the level.
 */
function scanOutcomeTrailing(
  candles: Candle[],
  signal: DetectedSignal,
  entryIndex: number,
  trailBufferR: number,
): {
  exitIndex: number | null;
  exitPrice: number | null;
  outcome: SetupBacktestTrade["outcome"];
  realizedRiskReward: number;
} {
  const { entry, stopLoss, takeProfit1, takeProfit2, direction } = signal;
  const risk = Math.abs(entry - stopLoss);
  const buffer = trailBufferR * risk;
  const breakevenStop = direction === "LONG" ? entry - buffer : entry + buffer;
  const tp1Stop = direction === "LONG" ? takeProfit1 - buffer : takeProfit1 + buffer;

  let currentStop = stopLoss;
  let tp1Hit = false;
  let tp2Hit = false;

  for (let i = entryIndex; i < candles.length; i++) {
    const { high, low } = candles[i];

    if (direction === "LONG") {
      if (low <= currentStop) {
        const exitPrice = currentStop;
        const rr = (exitPrice - entry) / (entry - stopLoss);
        const outcome = tp2Hit ? "trail_tp1" : tp1Hit ? "trail_be" : "stop";
        return { exitIndex: i, exitPrice, outcome, realizedRiskReward: rr };
      }
      if (!tp1Hit && high >= takeProfit1) {
        tp1Hit = true;
        currentStop = breakevenStop;
      }
      if (tp1Hit && !tp2Hit && high >= takeProfit2) {
        tp2Hit = true;
        currentStop = tp1Stop;
      }
    } else {
      if (high >= currentStop) {
        const exitPrice = currentStop;
        const rr = (entry - exitPrice) / (stopLoss - entry);
        const outcome = tp2Hit ? "trail_tp1" : tp1Hit ? "trail_be" : "stop";
        return { exitIndex: i, exitPrice, outcome, realizedRiskReward: rr };
      }
      if (!tp1Hit && low <= takeProfit1) {
        tp1Hit = true;
        currentStop = breakevenStop;
      }
      if (tp1Hit && !tp2Hit && low <= takeProfit2) {
        tp2Hit = true;
        currentStop = tp1Stop;
      }
    }
  }

  return {
    exitIndex: null,
    exitPrice: null,
    outcome: "open_at_end",
    realizedRiskReward: 0,
  };
}

/**
 * Structure-based trail: before TP1, SL stays at the original level.
 * Once TP1 is reached, SL trails behind the low (LONG) / high (SHORT) of the
 * last `swingLookback` closed candles each bar, only ever tightening —
 * closer to how Volman manages a runner than a flat breakeven jump.
 */
function scanOutcomeSwingTrail(
  candles: Candle[],
  signal: DetectedSignal,
  entryIndex: number,
  swingLookback: number,
): {
  exitIndex: number | null;
  exitPrice: number | null;
  outcome: SetupBacktestTrade["outcome"];
  realizedRiskReward: number;
} {
  const { entry, stopLoss, takeProfit1, direction } = signal;
  let currentStop = stopLoss;
  let tp1Hit = false;

  for (let i = entryIndex; i < candles.length; i++) {
    const { high, low } = candles[i];

    if (direction === "LONG") {
      if (low <= currentStop) {
        const exitPrice = currentStop;
        const rr = (exitPrice - entry) / (entry - stopLoss);
        const outcome = tp1Hit ? "trail_swing" : "stop";
        return { exitIndex: i, exitPrice, outcome, realizedRiskReward: rr };
      }
      if (!tp1Hit && high >= takeProfit1) {
        tp1Hit = true;
      }
      if (tp1Hit) {
        const start = Math.max(entryIndex, i - swingLookback + 1);
        const swingLow = Math.min(...candles.slice(start, i + 1).map((c) => c.low));
        if (swingLow > currentStop) currentStop = swingLow;
      }
    } else {
      if (high >= currentStop) {
        const exitPrice = currentStop;
        const rr = (entry - exitPrice) / (stopLoss - entry);
        const outcome = tp1Hit ? "trail_swing" : "stop";
        return { exitIndex: i, exitPrice, outcome, realizedRiskReward: rr };
      }
      if (!tp1Hit && low <= takeProfit1) {
        tp1Hit = true;
      }
      if (tp1Hit) {
        const start = Math.max(entryIndex, i - swingLookback + 1);
        const swingHigh = Math.max(...candles.slice(start, i + 1).map((c) => c.high));
        if (swingHigh < currentStop) currentStop = swingHigh;
      }
    }
  }

  return {
    exitIndex: null,
    exitPrice: null,
    outcome: "open_at_end",
    realizedRiskReward: 0,
  };
}

// ---------------------------------------------------------------------------
// Report computation
// ---------------------------------------------------------------------------

function computeReport(trades: SetupBacktestTrade[]): SetupBacktestReport {
  const closedTrades = trades.filter((t) => t.outcome !== "open_at_end");
  const total = closedTrades.length;

  const bySetup: SetupBacktestReport["bySetup"] = {};
  for (const kind of ["BB", "RB", "ARB", "IRB"] as SetupKind[]) {
    const setupTrades = closedTrades.filter((t) => t.setup === kind);
    if (setupTrades.length === 0) continue;
    const wins = setupTrades.filter((t) => t.realizedRiskReward > 0);
    bySetup[kind] = {
      trades: setupTrades.length,
      winRate: wins.length / setupTrades.length,
      avgRiskReward:
        setupTrades.reduce((s, t) => s + t.realizedRiskReward, 0) /
        setupTrades.length,
    };
  }

  const byPair: SetupBacktestReport["byPair"] = {};
  const pairSet = new Set(closedTrades.map((t) => t.pair));
  for (const p of Array.from(pairSet)) {
    const pairTrades = closedTrades.filter((t) => t.pair === p);
    const wins = pairTrades.filter((t) => t.realizedRiskReward > 0);
    byPair[p] = {
      trades: pairTrades.length,
      winRate: wins.length / pairTrades.length,
      avgRiskReward:
        pairTrades.reduce((s, t) => s + t.realizedRiskReward, 0) /
        pairTrades.length,
    };
  }

  const overallWins = closedTrades.filter((t) => t.realizedRiskReward > 0);

  return {
    bySetup,
    byPair,
    overall: {
      trades: total,
      winRate: total > 0 ? overallWins.length / total : 0,
      avgRiskReward: total > 0
        ? closedTrades.reduce((s, t) => s + t.realizedRiskReward, 0) / total
        : 0,
    },
    trades,
  };
}
