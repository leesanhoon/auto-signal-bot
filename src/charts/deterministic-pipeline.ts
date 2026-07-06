import type { AnalysisResult, ChartTimeframe } from "./chart-types.js";
import type { Candle } from "./ohlc-provider.js";
import { fetchOhlcHistory } from "./ohlc-provider.js";
import { calculateEma, calculateAtr, classifyTrend, averageAtr, isTradableWindow, isFalseBreak } from "./indicators.js";
import { detectDd } from "./setups/dd.js";
import { detectFb } from "./setups/fb.js";
import { detectBb } from "./setups/bb.js";
import { detectRb } from "./setups/rb.js";
import { detectArb } from "./setups/arb.js";
import { detectIrb } from "./setups/irb.js";
import { detectSb } from "./setups/sb.js";
import { resolveSetupConflicts } from "./setup-resolver.js";
import { buildTradeSetupFromSignal, buildPairSummaryFromContext } from "./signal-assembly.js";
import type { DetectedSignal } from "./setup-types.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:deterministic-pipeline");

/**
 * Analyze all pairs using the deterministic numeric engine instead of AI vision.
 *
 * For each pair:
 * 1. Fetch OHLC history for H4 (200 bars)
 * 2. Session/volatility filter (London/NY overlap + ATR floor)
 * 3. Calculate indicators (EMA20, ATR14)
 * 4. Run 7 Volman setup detectors on H4 (primary timeframe)
 * 5. Check false-break → run SB detector on failed signals
 * 6. Resolve conflicts (max 1 signal per pair)
 * 7. Build TradeSetup[] and PairSummary[] from signals
 * 8. Filter out null (price-sanity rejected) setups
 */
export async function analyzeAllChartsDeterministic(
  pairs: Array<{ pair: string; symbol: string }>,
): Promise<AnalysisResult> {
  // Process all pairs in parallel
  const pairResults = await Promise.all(pairs.map(async ({ pair, symbol }) => {
    try {
      // ---- Fetch OHLC data for H4 (primary timeframe) ----
      const h4Result = await fetchOhlcHistory(symbol, "H4", 200);

      if (h4Result instanceof Error) {
        logger.warn(`  ! Skip ${pair}: OHLC error — ${h4Result.message}`);
        return { kind: "skip" as const, pair, error: h4Result.message };
      }

      const primaryCandles = h4Result as Candle[];
      const ema20 = calculateEma(primaryCandles, 20);
      const atr14 = calculateAtr(primaryCandles, 14);
      const lastIndex = primaryCandles.length - 1;

      // ---- Session/volatility filter ----
      const lastCandle = primaryCandles[lastIndex];
      const atrLast = atr14[lastIndex];
      const atrAvg20d = averageAtr(atr14, lastIndex, 20);
      if (atrLast === null || atrAvg20d === null || !isTradableWindow(lastCandle.time, atrLast, atrAvg20d)) {
        return { kind: "skip" as const, pair, error: "ATR data chua du hoac ngoai khung giao dich London/NY" };
      }

      // ---- Detect context ----
      const ctx = {
        ema20, atr14, pair,
        timeframe: "H4" as ChartTimeframe,
      };

      // ---- Run 6 standard detectors on last 5 candles ----
      const startDetectIndex = Math.max(30, lastIndex - 5);
      const allSignals: DetectedSignal[] = [];
      const detectors = [detectDd, detectFb, detectBb, detectRb, detectArb, detectIrb];

      for (let i = startDetectIndex; i <= lastIndex; i++) {
        for (const detector of detectors) {
          try {
            const s = detector(primaryCandles, i, ctx);
            if (s) allSignals.push(s);
          } catch {
            // skip per-detector errors
          }
        }
      }

      if (allSignals.length === 0) {
        return {
          kind: "no_setups" as const,
          pair,
          summaries: [buildPairSummaryFromContext(
            pair, classifyTrend(primaryCandles, ema20, atr14, lastIndex),
            ema20[lastIndex] !== null && atr14[lastIndex] !== null && atr14[lastIndex]! > 0
              ? Math.abs(primaryCandles[lastIndex].close - ema20[lastIndex]!) / atr14[lastIndex]!
              : 99,
            false,
          )],
        };
      }

      // ---- Check false-break → run SB ----
      const sbSignals: DetectedSignal[] = [];
      for (const signal of allSignals) {
        const entry = signal.entry;
        const stop = signal.stopLoss;
        const levelHigh = Math.max(entry, stop);
        const levelLow = Math.min(entry, stop);
        // Check if the breakout was false (within 2 candles after trigger)
        if (signal.triggerIndex + 1 < primaryCandles.length) {
          const maxLookahead = Math.min(2, primaryCandles.length - 1 - signal.triggerIndex);
          const fbResult = isFalseBreak(primaryCandles, signal.triggerIndex, levelHigh, levelLow, signal.direction, maxLookahead);
          if (fbResult) {
            // Price returned inside → run SB detector
            try {
              const sbSignal = detectSb(primaryCandles, lastIndex, ctx, signal);
              if (sbSignal) {
                sbSignal.ruleTrace.unshift(`[SB] Phat hien tu false-break cua ${signal.setup}`);
                sbSignals.push(sbSignal);
              }
            } catch {
              // skip SB errors
            }
          }
        }
      }

      // ---- Combine + resolve conflicts ----
      const combined = [...allSignals, ...sbSignals];
      const resolved = resolveSetupConflicts(combined);

      const lastPrice = primaryCandles[lastIndex]?.close ?? null;

      // ---- Build outputs ----
      const setups: AnalysisResult["setups"] = [];
      for (const signal of resolved) {
        const setup = buildTradeSetupFromSignal(signal, { lastPrice });
        if (setup !== null) setups.push(setup);
      }

      const trend = classifyTrend(primaryCandles, ema20, atr14, lastIndex);
      const ema = ema20[lastIndex];
      const atr = atr14[lastIndex];
      const emaDistance = (ema !== null && atr !== null && atr > 0)
        ? Math.abs(primaryCandles[lastIndex].close - ema) / atr
        : 99;

      return {
        kind: "ok" as const,
        pair,
        summaries: [buildPairSummaryFromContext(pair, trend, emaDistance, setups.length > 0)],
        setups,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.warn(`  ! Skip ${pair}: unexpected error — ${msg}`);
      return { kind: "skip" as const, pair, error: msg };
    }
  }));

  // ---- Aggregate results ----
  const summaries: AnalysisResult["summaries"] = [];
  const setups: AnalysisResult["setups"] = [];
  const noSetupReasons: string[] = [];

  for (const r of pairResults) {
    if (r.kind === "ok") {
      summaries.push(...r.summaries);
      setups.push(...r.setups);
    } else if (r.kind === "no_setups") {
      summaries.push(...r.summaries);
      noSetupReasons.push(`[${r.pair}] Khong phat hien setup nao`);
    } else {
      noSetupReasons.push(`[${r.pair}] ${r.error}`);
    }
  }

  logger.info(`  ✓ ${summaries.length} pairs scanned, ${setups.length} setup(s) returned by deterministic engine`);

  return {
    summaries,
    setups,
    noSetupReason: noSetupReasons.join("\n").trim(),
    screenshots: [],
  };
}