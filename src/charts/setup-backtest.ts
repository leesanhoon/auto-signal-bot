import type { Candle } from "./ohlc-provider.js";
import type { DetectedSignal, DetectionContext, SetupKind } from "./setup-types.js";
import type { ChartTimeframe } from "./chart-types.js";
import { calculateEma, calculateAtr, isFalseBreak } from "./indicators.js";
import { detectDd } from "./setups/dd.js";
import { detectFb } from "./setups/fb.js";
import { detectBb } from "./setups/bb.js";
import { detectRb } from "./setups/rb.js";
import { detectArb } from "./setups/arb.js";
import { detectIrb } from "./setups/irb.js";
import { detectSb } from "./setups/sb.js";
import { resolveSetupConflicts } from "./setup-resolver.js";
import { SB_BUILDUP_LOOKAHEAD } from "./setup-sb-runner.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:setup-backtest");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SetupBacktestTrade = {
  setup: SetupKind;
  pair: string;
  timeframe: ChartTimeframe;
  direction: "LONG" | "SHORT";
  entryIndex: number;
  entryPrice: number;
  exitIndex: number | null;
  exitPrice: number | null;
  outcome: "tp1" | "tp2" | "stop" | "open_at_end";
  realizedRiskReward: number;
  confidence: number;
};

export type SetupBacktestReport = {
  bySetup: Partial<Record<SetupKind, { trades: number; winRate: number; avgRiskReward: number }>>;
  byPair: Record<string, { trades: number; winRate: number; avgRiskReward: number }>;
  overall: { trades: number; winRate: number; avgRiskReward: number };
  trades: SetupBacktestTrade[];
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

type PendingSb = {
  signal: DetectedSignal;
  sbIndex: number;
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Walk-forward backtest that mirrors live SB behavior:
 * one open trade at a time, one false-break watch per open trade, and a single
 * SB lookup at the fixed buildup index.
 */
export function runSetupBacktest(
  candles: Candle[],
  pair: string,
  timeframe: ChartTimeframe,
): SetupBacktestReport {
  const ema20 = calculateEma(candles, 20);
  const atr14 = calculateAtr(candles, 14);

  const trades: SetupBacktestTrade[] = [];
  let openTrade: OpenTradeState | null = null;
  let watchingFalseBreak: PendingFalseBreak | null = null;
  let pendingSb: PendingSb | null = null;
  const deferredFreshSignals: DetectedSignal[] = [];

  const detectors: Array<(c: Candle[], i: number, ctx: DetectionContext) => DetectedSignal | null> = [
    detectDd,
    detectFb,
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

    let sbSignalThisIndex: DetectedSignal | null = null;
    const freshSignals: DetectedSignal[] = [];

    if (watchingFalseBreak !== null && index >= watchingFalseBreak.triggerIndex + 2) {
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

        const sbIndex = Math.min(watchingFalseBreak.triggerIndex + SB_BUILDUP_LOOKAHEAD, candles.length - 1);
        if (sbIndex <= index) {
          try {
            const sbSignal = detectSb(candles, sbIndex, ctx, watchingFalseBreak.signal);
            if (sbSignal) {
              sbSignalThisIndex = sbSignal;
            }
          } catch (error) {
            logger.debug(
              `Dropped ${watchingFalseBreak.signal.setup} pending false-break (SB detection failed)`,
              {
                pair: watchingFalseBreak.signal.pair,
                triggerIndex: watchingFalseBreak.triggerIndex,
                currentIndex: index,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        } else {
          pendingSb = {
            signal: watchingFalseBreak.signal,
            sbIndex,
          };
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

    if (pendingSb !== null && index >= pendingSb.sbIndex) {
      try {
        const sbSignal = detectSb(candles, pendingSb.sbIndex, ctx, pendingSb.signal);
        if (sbSignal) {
          sbSignalThisIndex = sbSignal;
        }
      } catch (error) {
        logger.debug(
          `Dropped ${pendingSb.signal.setup} pending false-break (SB detection failed)`,
          {
            pair: pendingSb.signal.pair,
            triggerIndex: pendingSb.signal.triggerIndex,
            currentIndex: index,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      pendingSb = null;
    }

    const canRunFreshDetectors = openTrade === null && (pendingSb === null || sbSignalThisIndex !== null);
    if (canRunFreshDetectors) {
      if (deferredFreshSignals.length > 0) {
        freshSignals.push(...deferredFreshSignals);
        deferredFreshSignals.length = 0;
      }
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

    const readySignals: DetectedSignal[] = [];
    if (sbSignalThisIndex !== null) {
      if (freshSignals.length > 0) {
        deferredFreshSignals.push(...freshSignals);
      }
      readySignals.push(sbSignalThisIndex);
    } else {
      readySignals.push(...freshSignals);
    }

    const resolvedSignals = resolveSetupConflicts(readySignals);
    if (resolvedSignals.length === 0) {
      continue;
    }

    const signal = resolvedSignals[0];
    const trade = buildTrade(candles, signal);

    if (signal.setup === "SB") {
      trades.push(trade);
      openTrade = {
        signal,
        trade,
        triggerIndex: signal.triggerIndex,
        committed: true,
      };
      if (trade.exitIndex === null || index >= trade.exitIndex) {
        openTrade = null;
      }
      continue;
    }

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

  return computeReport(trades);
}

function buildTrade(candles: Candle[], signal: DetectedSignal): SetupBacktestTrade {
  const entryIndex = signal.triggerIndex;
  const outcome = scanOutcome(candles, signal, entryIndex);
  return {
    setup: signal.setup,
    pair: signal.pair,
    timeframe: signal.timeframe,
    direction: signal.direction,
    entryIndex,
    entryPrice: signal.entry,
    exitIndex: outcome.exitIndex,
    exitPrice: outcome.exitPrice,
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

// ---------------------------------------------------------------------------
// Report computation
// ---------------------------------------------------------------------------

function computeReport(trades: SetupBacktestTrade[]): SetupBacktestReport {
  const closedTrades = trades.filter((t) => t.outcome !== "open_at_end");
  const total = closedTrades.length;

  const bySetup: SetupBacktestReport["bySetup"] = {};
  for (const kind of ["DD", "FB", "BB", "RB", "ARB", "IRB", "SB"] as SetupKind[]) {
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
