import type { AnalysisResult, ChartTimeframe } from "./model/chart-types-volman.js";
import type { Candle } from "./client/ohlc-provider.js";
import { fetchOhlcHistory } from "./client/ohlc-provider.js";
import { calculateEma, calculateAtr, classifyTrend, averageAtr } from "./indicators.js";
import { detectDdb } from "./setups/ddb.js";
import { detectFb } from "./setups/fb.js";
import { detectSb } from "./setups/sb.js";
import { detectBb } from "./setups/bb.js";
import { detectRb } from "./setups/rb.js";
import { detectArb } from "./setups/arb.js";
import { detectIrb } from "./setups/irb.js";
import { runSbDetection } from "./setup-sb-runner.js";
import { buildTradeSetupFromSignal, buildPairSummaryFromContext } from "./signal-assembly.js";
import type { DetectedSignal } from "./model/setup-types.js";
import { createLogger } from "../shared/infra/logger.js";

const logger = createLogger("charts:deterministic-pipeline");

/**
 * Volatility-floor gate only — no London/NY session-hour restriction.
 * Crypto trades 24/7, so the forex-specific session window Bob Volman's
 * setups were tuned around doesn't transfer; only the ATR floor (avoid
 * dead/flat markets) is kept.
 */
export function passesDeterministicWindowFilter(
  _timeframe: ChartTimeframe,
  _lastCandleTime: number,
  atrLast: number | null,
  atrAvg20d: number | null,
): boolean {
  if (atrLast === null || atrAvg20d === null) return false;
  return atrLast >= 0.3 * atrAvg20d;
}

/**
 * Analyze all pairs using the deterministic numeric engine instead of AI vision.
 *
 * For each pair:
 * 1. Fetch OHLC history for the runtime timeframe (200 bars)
 * 2. Session/volatility filter (ATR floor only; crypto trades 24/7)
 * 3. Calculate indicators (EMA21, ATR14)
 * 4. Run active Volman setup detectors (DDB, SB, BB — FB/RB/ARB/IRB temporarily disabled)
 *    on the single most recently closed candle only (no retroactive lookback — a missed
 *    run drops that candle's trigger rather than reporting it late)
 * 5. Drop signals invalidated by a false break
 * 6. Resolve conflicts (max 1 signal per pair)
 * 7. Build TradeSetup[] and PairSummary[] from signals
 * 8. Filter out null (price-sanity rejected) setups
 *
 * Contract: fetchOhlcHistory(...) must return candles ordered oldest -> newest,
 * and the last element in the returned array must be the last closed candle for
 * the requested timeframe. The detectors below always anchor on `lastIndex`.
 */
export async function analyzeAllChartsDeterministic(
  pairs: Array<{ pair: string; symbol: string }>,
  options: {
    timeframeMode?: "multi" | "single";
    primaryTimeframe?: ChartTimeframe;
  } = {},
): Promise<AnalysisResult> {
  const timeframeMode = options.timeframeMode ?? "multi";
  const primaryTimeframe = options.primaryTimeframe ?? "H4";
  const analysisTimeframe: ChartTimeframe =
    timeframeMode === "single" ? primaryTimeframe : "H4";

  // Process all pairs in parallel
  const pairResults = await Promise.all(pairs.map(async ({ pair, symbol }) => {
    try {
      // ---- Fetch OHLC data for the runtime primary timeframe ----
      const ohlcResult = await fetchOhlcHistory(symbol, analysisTimeframe, 200);

      if (ohlcResult instanceof Error) {
        logger.warn(`  ! Skip ${pair}: OHLC error — ${ohlcResult.message}`);
        return { kind: "skip" as const, pair, error: ohlcResult.message };
      }

      const primaryCandles = ohlcResult as Candle[];
      if (primaryCandles.length === 0) {
        logger.warn(`  ! Skip ${pair}: OHLC returned no closed candles`);
        return { kind: "skip" as const, pair, error: "Khong co closed candle hop le" };
      }
      const ma21 = calculateEma(primaryCandles, 21);
      const atr14 = calculateAtr(primaryCandles, 14);
      const lastIndex = primaryCandles.length - 1;

      // ---- Session/volatility filter ----
      const lastCandle = primaryCandles[lastIndex];
      const atrLast = atr14[lastIndex];
      const atrAvg20d = averageAtr(atr14, lastIndex, 20);
      if (!passesDeterministicWindowFilter(analysisTimeframe, lastCandle.time, atrLast, atrAvg20d)) {
        return {
          kind: "skip" as const,
          pair,
          error: "ATR data chua du hoac ngoai khung giao dich hop le",
        };
      }

      // ---- Detect context ----
      const ctx = {
        ma21, atr14, pair,
        timeframe: analysisTimeframe,
      };

      // ---- Run all 7 Volman setup detectors on the single most recently closed candle ----
      const startDetectIndex = lastIndex;
      const allSignals: DetectedSignal[] = [];
      // Tam thoi off ARB/IRB/RB/FB, chi giu BB/SB/DDB theo yeu cau.
      const detectors = [detectDdb, detectSb, detectBb];

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
            pair, classifyTrend(primaryCandles, ma21, atr14, lastIndex),
            ma21[lastIndex] !== null && atr14[lastIndex] !== null && atr14[lastIndex]! > 0
              ? Math.abs(primaryCandles[lastIndex].close - ma21[lastIndex]!) / atr14[lastIndex]!
              : 99,
            false,
          )],
        };
      }

      // ---- Check false-break → run SB + filter failed signals ----
      const { resolved } = runSbDetection(primaryCandles, allSignals, lastIndex, ctx);

      const lastPrice = primaryCandles[lastIndex]?.close ?? null;

      // ---- Build outputs ----
      const setups: AnalysisResult["setups"] = [];
      for (const signal of resolved) {
        const setup = buildTradeSetupFromSignal(signal, { lastPrice, candles: primaryCandles, ma21 });
        if (setup !== null) setups.push(setup);
      }

      const trend = classifyTrend(primaryCandles, ma21, atr14, lastIndex);
      const ema = ma21[lastIndex];
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
  let okPairs = 0;
  let noSetupPairs = 0;
  let skippedPairs = 0;

  for (const r of pairResults) {
    if (r.kind === "ok") {
      okPairs += 1;
      summaries.push(...r.summaries);
      setups.push(...r.setups);
    } else if (r.kind === "no_setups") {
      noSetupPairs += 1;
      summaries.push(...r.summaries);
      noSetupReasons.push(`[${r.pair}] Khong phat hien setup nao`);
    } else {
      skippedPairs += 1;
      noSetupReasons.push(`[${r.pair}] ${r.error}`);
    }
  }

  const attemptedPairs = pairs.length;
  logger.info(
    `  ✓ ${attemptedPairs} pairs attempted, ${summaries.length} summaries, ${skippedPairs} skipped, ${setups.length} setup(s) returned by deterministic engine`,
  );

  return {
    summaries,
    setups,
    noSetupReason: noSetupReasons.join("\n").trim(),
    analysisStats: {
      attemptedPairs,
      okPairs,
      noSetupPairs,
      skippedPairs,
      setupCount: setups.length,
    },
  };
}
