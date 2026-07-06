import type { Candle } from "./ohlc-provider.js";
import type { DetectedSignal, SetupKind } from "./setup-types.js";
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

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Walk-forward backtest: duyệt qua toàn bộ mảng `candles`, chạy 7 detector
 * tại mỗi index, forward-scan để tìm outcome (TP1/TP2/SL), tổng hợp báo cáo.
 */
export function runSetupBacktest(
  candles: Candle[],
  pair: string,
  timeframe: ChartTimeframe,
): SetupBacktestReport {
  const ema20 = calculateEma(candles, 20);
  const atr14 = calculateAtr(candles, 14);

  const trades: SetupBacktestTrade[] = [];
  let activeUntilIndex = -1; // không chồng lệnh

  // 7 detectors
  const detectors: Array<(c: Candle[], i: number, ctx: any) => DetectedSignal | null> = [
    detectDd,
    detectFb,
    detectBb,
    detectRb,
    detectArb,
    detectIrb,
  ];

  // Start from index >= 30 to have enough data for indicators
  const startIndex = Math.min(30, candles.length);

  for (let index = startIndex; index < candles.length; index++) {
    // Skip while a trade is active
    if (index <= activeUntilIndex) continue;

    const ctx = {
      ema20,
      atr14,
      pair,
      timeframe,
    };

    // Run all 6 standard detectors
    const signals: DetectedSignal[] = [];
    for (const detector of detectors) {
      try {
        const signal = detector(candles, index, ctx);
        if (signal) signals.push(signal);
      } catch {
        // Skip detector on error
      }
    }

    // Check false-break → run SB detector
    const sbSignals: DetectedSignal[] = [];
    for (const signal of signals) {
      const entry = signal.entry;
      const stop = signal.stopLoss;
      const levelHigh = Math.max(entry, stop);
      const levelLow = Math.min(entry, stop);
      if (signal.triggerIndex + 1 < candles.length) {
        const maxLookahead = Math.min(2, candles.length - 1 - signal.triggerIndex);
        const fbResult = isFalseBreak(candles, signal.triggerIndex, levelHigh, levelLow, signal.direction, maxLookahead);
        if (fbResult) {
          try {
            const sbSignal = detectSb(candles, index, ctx, signal);
            if (sbSignal) {
              sbSignal.ruleTrace.unshift(`[SB] Phat hien tu false-break cua ${signal.setup}`);
              sbSignals.push(sbSignal);
            }
          } catch {
            // Skip SB errors
          }
        }
      }
    }

    // Combine signals
    const allSignals = [...signals, ...sbSignals];
    if (allSignals.length === 0) continue;

    // Resolve conflicts
    const resolved = resolveSetupConflicts(allSignals);
    if (resolved.length === 0) continue;

    const signal = resolved[0];

    // Forward-scan for outcome
    const outcome = scanOutcome(candles, signal, index);
    const trade: SetupBacktestTrade = {
      setup: signal.setup,
      pair: signal.pair,
      timeframe: signal.timeframe,
      direction: signal.direction,
      entryIndex: index,
      entryPrice: signal.entry,
      exitIndex: outcome.exitIndex,
      exitPrice: outcome.exitPrice,
      outcome: outcome.outcome,
      realizedRiskReward: outcome.realizedRiskReward,
      confidence: signal.confidence,
    };

    trades.push(trade);

    // No overlapping trades: skip signals until this one resolves
    if (outcome.exitIndex !== null) {
      activeUntilIndex = outcome.exitIndex;
    } else {
      activeUntilIndex = candles.length; // open at end, done
    }
  }

  return computeReport(trades);
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
      // Check for stop hit first (conservative)
      if (low <= stopLoss) {
        const exitPrice = stopLoss;
        const rr = (exitPrice - entry) / (entry - stopLoss);
        return { exitIndex: i, exitPrice, outcome: "stop", realizedRiskReward: rr };
      }
      // Check TP2 hit
      if (high >= takeProfit2) {
        const exitPrice = takeProfit2;
        const rr = (exitPrice - entry) / (entry - stopLoss);
        return { exitIndex: i, exitPrice, outcome: "tp2", realizedRiskReward: rr };
      }
      // Check TP1 hit (only if stop and TP2 not hit)
      if (high >= takeProfit1) {
        // If TP1 is hit but we haven't confirmed stop/TP2, mark as tp1
        // Continue scanning for TP2 in same candle
        const exitPrice = takeProfit1;
        const rr = (exitPrice - entry) / (entry - stopLoss);
        return { exitIndex: i, exitPrice, outcome: "tp1", realizedRiskReward: rr };
      }
    } else {
      // SHORT
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

  // Reached end of data without hitting any level
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

  // By setup
  const bySetup: SetupBacktestReport["bySetup"] = {};
  for (const kind of ["DD", "FB", "BB", "RB", "ARB", "IRB"] as SetupKind[]) {
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

  // By pair
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

  // Overall
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