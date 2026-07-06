import type { Candle } from "./ohlc-provider.js";
import type { DetectedSignal, DetectionContext } from "./setup-types.js";
import { isFalseBreak } from "./indicators.js";
import { detectSb } from "./setups/sb.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:setup-sb-runner");

/**
 * Run SB (Second Break) detection on signals that have been flagged as false break.
 * Also filters out the original failed signal when SB is generated.
 *
 * For each false-break detected, we look 3 candles ahead to allow new compression/block
 * to form in the opposite direction (per context.md §2.7: SB requires buildup after rejection).
 *
 * @returns SB signals (opposite direction reversals) and the remaining valid signals
 */
const SB_BUILDUP_LOOKAHEAD = 3; // candles to wait after false-break for compression to form

export function runSbDetection(
  candles: Candle[],
  signals: DetectedSignal[],
  currentIndex: number,
  ctx: DetectionContext,
): { validSignals: DetectedSignal[]; sbSignals: DetectedSignal[] } {
  const sbSignals: DetectedSignal[] = [];
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
        // False break detected — run SB at the correct index (near signal trigger)
        const sbIndex = Math.min(signal.triggerIndex + SB_BUILDUP_LOOKAHEAD, currentIndex);
        try {
          const sbSignal = detectSb(candles, sbIndex, ctx, signal);
          if (sbSignal) {
            sbSignal.ruleTrace.unshift(`[SB] Phat hien tu false-break cua ${signal.setup}`);
            sbSignals.push(sbSignal);
          } else {
            // Signal was false-break but no SB compression formed — signal lost
            logger.debug(
              `Dropped ${signal.setup} signal (false-break confirmed but no SB compression found at index ${sbIndex})`,
              { pair: signal.pair, triggerIndex: signal.triggerIndex },
            );
          }
        } catch (err) {
          // SB detector threw error — signal lost
          logger.debug(
            `Dropped ${signal.setup} signal (false-break confirmed but SB detection failed)`,
            { pair: signal.pair, error: err instanceof Error ? err.message : String(err) },
          );
        }
        // Do NOT keep the original failed signal (fix #16)
        continue;
      }
    }
    // Signal is valid (not false break)
    validSignals.push(signal);
  }

  return { validSignals, sbSignals };
}
