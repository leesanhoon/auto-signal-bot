import "../shared/env.js";
import { captureAllCharts } from "./screenshot.js";
import { analyzeAllCharts } from "./analyzer.js";
import { saveOpenPosition, savePendingOrder } from "./positions-repository.js";
import { runCheckOpenTrades } from "./check-open-trades-runner.js";
import { runCheckPendingOrders } from "./check-pending-orders-runner.js";
import { sendAllAnalyses, notifyError } from "../shared/telegram.js";
import { createLogger } from "../shared/logger.js";
import { validateTradeSetupForOpen } from "./position-engine.js";
import { getConfiguredChartEngineMode, getConfiguredChartSignalConfidenceThreshold } from "./chart-config-env.js";
import type { TradeSetup, AnalysisResult } from "./chart-types.js";
import { getCurrentH4CandleCloseKey, isWithinCandleCloseWindow } from "./chart-cache.js";
import { loadChartAnalysisCache, saveChartAnalysisCache } from "./chart-cache-repository.js";
import { analyzeAllChartsDeterministic } from "./deterministic-pipeline.js";
import { CHARTS } from "./charts.config.js";

const logger = createLogger("charts:index");
const AI_VISION_MODEL = process.env.AI_VISION_MODEL?.trim() || "xiaomi/mimo-v2.5";
const CANDLE_CLOSE_WINDOW_MS = 20 * 60 * 1000; // 20 phút

/**
 * Validate that cached result has required AnalysisResult schema.
 * Prevents type mismatches if cache format changes.
 */
function isValidAnalysisResult(obj: unknown): obj is AnalysisResult {
  if (typeof obj !== "object" || obj === null) return false;
  const result = obj as Record<string, unknown>;
  // Check required fields exist
  return (
    Array.isArray(result.summaries) &&
    Array.isArray(result.setups) &&
    (typeof result.noSetupReason === "string" || result.noSetupReason === undefined) &&
    Array.isArray(result.screenshots)
  );
}

function shouldAutoTrackAsOpen(setup: TradeSetup, threshold: number): boolean {
  return setup.orderType === "MARKET_NOW" && (setup.confidence ?? 0) >= threshold;
}

/**
 * Get unique pairs from CHARTS config.
 */
function getPairs(): Array<{ pair: string; symbol: string }> {
  const seen = new Map<string, string>();
  for (const chart of CHARTS) {
    const pair = chart.name.replace(` ${chart.timeframe}`, "");
    if (!seen.has(pair)) {
      seen.set(pair, chart.symbol);
    }
  }
  return Array.from(seen.entries()).map(([pair, symbol]) => ({ pair, symbol }));
}

export async function main(): Promise<void> {
  const startTime = Date.now();
  const engineMode = getConfiguredChartEngineMode();
  logger.info("Bob Volman multi-timeframe scanner starting", { engineMode });

  // Include engine mode in cache key so different modes don't reuse each other's results
  const candleKey = `${getCurrentH4CandleCloseKey()}:${engineMode}`;
  let result: Awaited<ReturnType<typeof analyzeAllCharts>> | null = null;

  // ---- Check cache ----
  const cached = await loadChartAnalysisCache(candleKey);
  if (cached) {
      // Validate cache schema before using it
      if (!isValidAnalysisResult(cached)) {
        logger.warn(`Cache schema invalid for ${candleKey}, treating as miss`);
      } else {
        logger.info(`↻ Dùng lại kết quả phân tích đã cache cho candle ${candleKey}, bỏ qua capture + AI`);
        result = cached as AnalysisResult;
      }
    } else if (isWithinCandleCloseWindow(new Date(), CANDLE_CLOSE_WINDOW_MS)) {
      // ---- AI mode (default/system behavior) ----
    if (engineMode === "ai") {
      logger.info("Capturing all forex charts", {
        intervals: ["D1", "H4", "M15"],
        indicators: ["EMA 20", "volume"],
      });
      const screenshots = await captureAllCharts();
      if (screenshots.length === 0) throw new Error("No charts captured.");
      logger.info("Captured charts", { count: screenshots.length });

      logger.info("Analyzing charts", { model: AI_VISION_MODEL });
      const analysisResult = await analyzeAllCharts(screenshots);
      logger.info("Analysis complete");

      await saveChartAnalysisCache(candleKey, analysisResult);
      result = analysisResult;

    // ---- Deterministic mode (no AI, no screenshots) ----
    } else if (engineMode === "deterministic") {
      logger.info("Using deterministic engine (no AI vision)");
      const pairs = getPairs();
      const detResult = await analyzeAllChartsDeterministic(pairs);
      logger.info("Deterministic analysis complete");

      await saveChartAnalysisCache(candleKey, detResult);
      result = detResult;

    // ---- Shadow mode (run both, only use AI result) ----
    } else {
      // shadow: default = AI path with deterministic comparison
      logger.info("SHADOW mode: AI is primary, deterministic runs alongside");
      logger.info("Capturing all forex charts", {
        intervals: ["D1", "H4", "M15"],
        indicators: ["EMA 20", "volume"],
      });
      const screenshots = await captureAllCharts();
      if (screenshots.length === 0) throw new Error("No charts captured.");
      logger.info("Captured charts", { count: screenshots.length });

      logger.info("Analyzing charts (AI)", { model: AI_VISION_MODEL });
      const aiResult = await analyzeAllCharts(screenshots);
      logger.info("AI analysis complete");

      await saveChartAnalysisCache(candleKey, aiResult);
      result = aiResult;

      // Shadow: run deterministic, log comparison (don't fail on errors)
      try {
        logger.info("SHADOW: Running deterministic engine for comparison...");
        const pairs = getPairs();
        const detResult = await analyzeAllChartsDeterministic(pairs);
        logger.info("SHADOW: Deterministic comparison results", {
          aiSetups: aiResult.setups.length,
          detSetups: detResult.setups.length,
          aiPairs: aiResult.summaries.length,
          detPairs: detResult.summaries.length,
        });
        // Log per-pair comparison
        for (const aiSetup of aiResult.setups) {
          const match = detResult.setups.find(
            (s) => s.pair === aiSetup.pair && s.direction === aiSetup.direction,
          );
          if (match) {
            logger.info(`SHADOW: ${aiSetup.pair} — AI=${aiSetup.setup} vs DET=${match.setup}, conf=${aiSetup.confidence}/${match.confidence}`);
          } else {
            logger.info(`SHADOW: ${aiSetup.pair} — AI=${aiSetup.setup} (det=khong co)`);
          }
        }
        for (const detSetup of detResult.setups) {
          if (!aiResult.setups.find((s) => s.pair === detSetup.pair)) {
            logger.info(`SHADOW: ${detSetup.pair} — AI=khong co, DET=${detSetup.setup}`);
          }
        }
      } catch (detErr) {
        logger.warn("SHADOW: Deterministic engine comparison failed", { error: detErr });
        // Notify Telegram to avoid silent failures in shadow mode
        await notifyError("SHADOW: Deterministic engine", detErr).catch(() => {});
      }
    }
  } else {
    logger.warn(`⏭ Bỏ qua capture+analyze — ngoài cửa sổ đóng nến H4 (${candleKey}), vẫn kiểm tra trade/pending`);
  }

  // ---- Downstream: save positions + send Telegram ----
  // (unchanged — same for all modes, result is always AnalysisResult)
  if (result) {
    const threshold = getConfiguredChartSignalConfidenceThreshold();

    for (const setup of result.setups) {
      if (shouldAutoTrackAsOpen(setup, threshold)) {
        try {
          const validation = validateTradeSetupForOpen(setup);
          if (!validation.accepted) {
            logger.info("Skipped open position due to risk/reward gate", { pair: setup.pair, reason: validation.reason });
            continue;
          }
          const saved = await saveOpenPosition(setup);
          if (saved) {
            setup.autoTracked = true;
            logger.info("Auto-saved open position", { pair: setup.pair });
          } else {
            logger.info("Skipped duplicate open position", { pair: setup.pair });
          }
        } catch (error) {
          logger.error("Failed to auto-save open position", { pair: setup.pair, error });
        }
      } else if ((setup.confidence ?? 0) >= threshold && setup.orderType !== "MARKET_NOW") {
        try {
          const saved = await savePendingOrder(setup);
          if (saved) {
            logger.info("Saved pending order", {
              pair: setup.pair,
              orderType: setup.orderType,
              primaryTimeframe: setup.primaryTimeframe,
            });
          } else {
            logger.info("Skipped duplicate pending order", {
              pair: setup.pair,
              orderType: setup.orderType,
            });
          }
        } catch (error) {
          logger.error("Failed to save pending order", { pair: setup.pair, error });
        }
      }
    }

    logger.info("Sending results to Telegram");
    await sendAllAnalyses(result);
  }

  logger.info("Checking open positions");
  await runCheckOpenTrades();
  logger.info("Checking pending orders");
  await runCheckPendingOrders();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info("Run complete", {
    scannedPairs: result?.setups.length ?? 0,
    elapsedSeconds: Number(elapsed),
    engineMode,
  });
}

// Run as entry point only (not during tests)
if (!process.env.VITEST) {
  main().catch(async (error) => {
    logger.error("Fatal error", { error });
    await notifyError("Bob Volman multi-timeframe scanner", error);
    process.exit(1);
  });
}