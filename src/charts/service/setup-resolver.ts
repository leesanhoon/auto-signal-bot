import type { DetectedSignal, SetupKind } from "../model/setup-types.js";
import { createLogger } from "../../shared/infra/logger.js";

const logger = createLogger("charts:setup-resolver");

/**
 * Priority order for setup conflict resolution (highest first).
 * When two signals on the same pair have equal confidence,
 * the higher-priority setup wins.
 *
 * Order rationale: Range breakout setups (ARB/IRB/RB/BB) prioritized over
 * pullback-trend setups (SB/FB/DDB) as they have longer validation history.
 * Within each group, more conservative/selective setups ranked higher.
 */
const SETUP_PRIORITY: SetupKind[] = [
  "ARB",  // Advanced Range Break — best edge-test reliability
  "IRB",  // Inside Range Break
  "RB",   // Range Break
  "BB",   // Block Break
  "SB",   // Second Break — new, harmonic pullback validated
  "FB",   // First Break — very rare signals
  "DDB",  // Double Doji Break — very rare signals
];

/**
 * Get the priority rank of a setup kind (lower number = higher priority).
 */
function priorityRank(kind: SetupKind): number {
  const idx = SETUP_PRIORITY.indexOf(kind);
  return idx >= 0 ? idx : SETUP_PRIORITY.length; // unknown types go last
}

/**
 * Resolve conflicting setup signals on the same pair.
 *
 * Strategy:
 * 1. Group signals by pair.
 * 2. Within each group, keep the signal with the highest confidence.
 * 3. If confidence is tied, use setup priority: ARB > IRB > RB > BB > SB > FB > DDB.
 * 4. If both confidence AND priority are equal (same setup), keep the one
 *    with the most recent triggerIndex.
 *
 * @param signals — array of detected signals (possibly with conflicts).
 * @returns filtered array with at most one signal per pair.
 */
export function resolveSetupConflicts(
  signals: DetectedSignal[],
): DetectedSignal[] {
  if (signals.length === 0) return [];

  // Group by pair
  const grouped = new Map<string, DetectedSignal[]>();

  for (const signal of signals) {
    const existing = grouped.get(signal.pair);
    if (existing) {
      existing.push(signal);
    } else {
      grouped.set(signal.pair, [signal]);
    }
  }

  const resolved: DetectedSignal[] = [];

  for (const pairSignals of Array.from(grouped.values())) {
    if (pairSignals.length === 1) {
      resolved.push(pairSignals[0]);
      continue;
    }

    // Sort: higher confidence first, then higher priority, then most recent
    pairSignals.sort((a, b) => {
      // Primary: confidence (descending)
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }

      // Secondary: setup priority (lower rank number = higher priority)
      const rankA = priorityRank(a.setup);
      const rankB = priorityRank(b.setup);
      if (rankA !== rankB) {
        return rankA - rankB;
      }

      // Tertiary: most recent triggerIndex (descending)
      return b.triggerIndex - a.triggerIndex;
    });

    // Keep the winner
    resolved.push(pairSignals[0]);

    // Log conflicts for debugging — KHONG push vao ruleTrace vi ruleTrace duoc dung
    // truc tiep de build entryCondition + reasons hien thi cho user (xem
    // signal-assembly.ts). Debug info nay chi phuc vu dev, khong lien quan quyet dinh
    // vao lenh cua user.
    if (pairSignals.length > 1) {
      const kept = pairSignals[0];
      const dropped = pairSignals.slice(1).map((s) => `${s.setup}(conf=${s.confidence})`).join(", ");
      logger.debug(
        `Conflict resolved for ${kept.pair}: giu ${kept.setup}(conf=${kept.confidence}), bo ${dropped}`,
      );
    }
  }

  return resolved;
}
