import type { Candle } from "./client/ohlc-provider.js";
import type { DetectedSignal, DetectionContext } from "./model/setup-types.js";
import { isFalseBreak } from "./service/indicators.js";
import { resolveSetupConflicts } from "./service/setup-resolver.js";
import { createLogger } from "../shared/infra/logger.js";

const logger = createLogger("charts:setup-sb-runner");

/**
 * Drop signals invalidated by a false break of their entry/stop level.
 *
 * SB (Second Break reversal) used to be generated here from a confirmed false
 * break, but backtests showed it fires too rarely (~8-37 trades across 2.3
 * years of H4 data) to establish an edge, so it was retired — a false break
 * now simply invalidates the original signal instead of spawning a reversal.
 *
 * @returns the remaining valid (non-false-broken) signals
 */
export function runSbDetection(
  candles: Candle[],
  signals: DetectedSignal[],
  currentIndex: number,
  _ctx: DetectionContext,
): { resolved: DetectedSignal[] } {
  const validSignals: DetectedSignal[] = [];

  for (const signal of signals) {
    const entry = signal.entry;
    const stop = signal.stopLoss;
    const levelHigh = Math.max(entry, stop);
    const levelLow = Math.min(entry, stop);

    if (signal.triggerIndex + 1 < candles.length) {
      const maxLookahead = Math.min(2, candles.length - 1 - signal.triggerIndex);
      const fbResult = isFalseBreak(candles, signal.triggerIndex, levelHigh, levelLow, signal.direction, maxLookahead);
      if (fbResult) {
        logger.debug(
          `Dropped ${signal.setup} signal (false-break confirmed)`,
          { pair: signal.pair, triggerIndex: signal.triggerIndex, currentIndex },
        );
        continue;
      }
    }
    // Signal is valid (not false break)
    validSignals.push(signal);
  }

  return { resolved: resolveSetupConflicts(validSignals) };
}
