import "../shared/env.js";
import { captureAllCharts } from "./screenshot.js";
import { analyzeAllCharts } from "./analyzer.js";
import { saveOpenPosition, savePendingOrder } from "./positions-repository.js";
import { runCheckOpenTrades } from "./check-open-trades-runner.js";
import { runCheckPendingOrders } from "./check-pending-orders-runner.js";
import {
  buildHeartbeatMessage,
  sendAllAnalyses,
  sendMessage,
  notifyError,
} from "../shared/telegram.js";
import { createLogger } from "../shared/logger.js";
import { validateTradeSetupForOpen } from "./position-engine.js";
import {
  getConfiguredChartPrimaryTimeframe,
  getConfiguredChartEngineMode,
  getConfiguredChartRunContext,
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredChartTimeframeMode,
  shouldSendHeartbeatOnManualRun,
  shouldSendHeartbeatOutsideCloseWindow,
  shouldUseLatestCacheForManualRun,
} from "./chart-config-env.js";
import type { AnalysisResult, TradeSetup } from "./chart-types.js";
import { getCurrentCandleCloseKey, isWithinCandleCloseWindow } from "./chart-cache.js";
import {
  loadChartAnalysisCache,
  loadLatestChartAnalysisCache,
  saveChartAnalysisCache,
} from "./chart-cache-repository.js";
import { analyzeAllChartsDeterministic } from "./deterministic-pipeline.js";
import { CHARTS, getChartsForTimeframeMode } from "./charts.config.js";
import { buildChartAnalysisCacheKey } from "./analyzer.js";

const logger = createLogger("charts:index");
const AI_VISION_MODEL = process.env.AI_VISION_MODEL?.trim() || "xiaomi/mimo-v2.5";
const CANDLE_CLOSE_WINDOW_MS = 20 * 60 * 1000;

type AnalysisOrigin =
  | { source: "live"; candleKey: string }
  | { source: "cached"; candleKey: string };

function shouldAutoTrackAsOpen(setup: TradeSetup, threshold: number): boolean {
  return setup.orderType === "MARKET_NOW" && (setup.confidence ?? 0) >= threshold;
}

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

function getTriggerTimeframe(
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
): ReturnType<typeof getConfiguredChartPrimaryTimeframe> {
  return timeframeMode === "single" ? primaryTimeframe : "H4";
}

async function analyzeCurrentWindow(
  candleKey: string,
  engineMode: ReturnType<typeof getConfiguredChartEngineMode>,
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
): Promise<AnalysisResult> {
  const runtimeCharts = getChartsForTimeframeMode(timeframeMode, primaryTimeframe);
  const runtimeIntervals = [...new Set(runtimeCharts.map((chart) => chart.timeframe))];
  if (engineMode === "ai") {
    logger.info("Capturing all forex charts", {
      timeframeMode,
      primaryTimeframe,
      intervals: runtimeIntervals,
      indicators: ["EMA 20", "volume"],
    });
    const screenshots = await captureAllCharts(timeframeMode, primaryTimeframe);
    if (screenshots.length === 0) throw new Error("No charts captured.");
    logger.info("Captured charts", { count: screenshots.length });

    logger.info("Analyzing charts", { model: AI_VISION_MODEL });
    const analysisResult = await analyzeAllCharts(screenshots);
    logger.info("Analysis complete");

    await saveChartAnalysisCache(candleKey, analysisResult);
    return analysisResult;
  }

  if (engineMode === "deterministic") {
    logger.info("Using deterministic engine (no AI vision)", {
      timeframeMode,
      primaryTimeframe,
      intervals: runtimeIntervals,
    });
    const pairs = getPairs();
    const detResult = await analyzeAllChartsDeterministic(pairs, {
      timeframeMode,
      primaryTimeframe,
    });
    logger.info("Deterministic analysis complete");

    await saveChartAnalysisCache(candleKey, detResult);
    return detResult;
  }

  logger.info("SHADOW mode: AI is primary, deterministic runs alongside");
  logger.info("Capturing all forex charts", {
    timeframeMode,
    primaryTimeframe,
    intervals: runtimeIntervals,
    indicators: ["EMA 20", "volume"],
  });
  const screenshots = await captureAllCharts(timeframeMode, primaryTimeframe);
  if (screenshots.length === 0) throw new Error("No charts captured.");
  logger.info("Captured charts", { count: screenshots.length });

  logger.info("Analyzing charts (AI)", { model: AI_VISION_MODEL });
  const aiResult = await analyzeAllCharts(screenshots);
  logger.info("AI analysis complete");

  await saveChartAnalysisCache(candleKey, aiResult);

  try {
    logger.info("SHADOW: Running deterministic engine for comparison...");
    const pairs = getPairs();
    const detResult = await analyzeAllChartsDeterministic(pairs, {
      timeframeMode,
      primaryTimeframe,
    });
    logger.info("SHADOW: Deterministic comparison results", {
      aiSetups: aiResult.setups.length,
      detSetups: detResult.setups.length,
      aiPairs: aiResult.summaries.length,
      detPairs: detResult.summaries.length,
    });
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
    await notifyError("SHADOW: Deterministic engine", detErr).catch(() => {});
  }

  return aiResult;
}

async function loadAnalysisForRun(
  candleBaseKey: string,
  engineMode: ReturnType<typeof getConfiguredChartEngineMode>,
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
  triggerTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
  runContext: ReturnType<typeof getConfiguredChartRunContext>,
): Promise<{ result: AnalysisResult | null; origin: AnalysisOrigin | null; heartbeatReason: "no-cache" | "no-event" | null }> {
  const cacheKey = buildChartAnalysisCacheKey(candleBaseKey, engineMode, timeframeMode, primaryTimeframe);
  const cached = await loadChartAnalysisCache(cacheKey);
  if (cached) {
    return { result: cached, origin: { source: "cached", candleKey: cacheKey }, heartbeatReason: null };
  }

  const withinCloseWindow = isWithinCandleCloseWindow(new Date(), triggerTimeframe, CANDLE_CLOSE_WINDOW_MS);
  if (withinCloseWindow) {
    const liveResult = await analyzeCurrentWindow(cacheKey, engineMode, timeframeMode, primaryTimeframe);
    return { result: liveResult, origin: { source: "live", candleKey: cacheKey }, heartbeatReason: null };
  }

  if (runContext === "manual" && shouldUseLatestCacheForManualRun()) {
    const latest = await loadLatestChartAnalysisCache(engineMode, timeframeMode, primaryTimeframe);
    if (latest) {
      return {
        result: latest.result,
        origin: { source: "cached", candleKey: latest.candleKey },
        heartbeatReason: null,
      };
    }
    return {
      result: null,
      origin: null,
      heartbeatReason: shouldSendHeartbeatOnManualRun() ? "no-cache" : null,
    };
  }

  return {
    result: null,
    origin: null,
    heartbeatReason: shouldSendHeartbeatOutsideCloseWindow() ? "no-event" : null,
  };
}

async function handleAnalysisResult(
  result: AnalysisResult,
  origin: AnalysisOrigin,
): Promise<void> {
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

  logger.info("Sending results to Telegram", {
    source: origin.source,
    candleKey: origin.candleKey,
  });
  await sendAllAnalyses(result, undefined, {
    source: origin.source,
    candleKey: origin.candleKey,
  });
}

async function maybeSendHeartbeat(
  runContext: ReturnType<typeof getConfiguredChartRunContext>,
  engineMode: ReturnType<typeof getConfiguredChartEngineMode>,
  candleKey: string,
  heartbeatReason: "no-cache" | "no-event" | null,
  latestCacheCandleKey?: string | null,
): Promise<void> {
  if (!heartbeatReason) return;

  await sendMessage(
    buildHeartbeatMessage({
      runContext,
      engineMode,
      reason: heartbeatReason,
      candleKey,
      latestCacheCandleKey: latestCacheCandleKey ?? null,
    }),
  );
}

export async function main(): Promise<void> {
  const startTime = Date.now();
  const engineMode = getConfiguredChartEngineMode();
  const runContext = getConfiguredChartRunContext();
  const timeframeMode = getConfiguredChartTimeframeMode();
  const primaryTimeframe = getConfiguredChartPrimaryTimeframe();
  const triggerTimeframe = getTriggerTimeframe(timeframeMode, primaryTimeframe);
  logger.info("Bob Volman scanner starting", { engineMode, runContext, timeframeMode, primaryTimeframe });

  const candleBaseKey = getCurrentCandleCloseKey(triggerTimeframe);
  const candleKey = buildChartAnalysisCacheKey(
    candleBaseKey,
    engineMode,
    timeframeMode,
    primaryTimeframe,
  );
  let latestCacheCandleKey: string | null = null;
  let result: AnalysisResult | null = null;
  let origin: AnalysisOrigin | null = null;
  let heartbeatReason: "no-cache" | "no-event" | null = null;

  const analysisState = await loadAnalysisForRun(
    candleBaseKey,
    engineMode,
    timeframeMode,
    primaryTimeframe,
    triggerTimeframe,
    runContext,
  );
  result = analysisState.result;
  origin = analysisState.origin;
  heartbeatReason = analysisState.heartbeatReason;
  if (origin?.source === "cached") {
    latestCacheCandleKey = origin.candleKey;
  }

  if (result && origin) {
    await handleAnalysisResult(result, origin);
  } else {
    logger.warn(`⏭ Bỏ qua capture+analyze — ngoài cửa sổ đóng nến ${triggerTimeframe} (${candleKey}), vẫn kiểm tra trade/pending`);
  }

  logger.info("Checking open positions");
  const openTradeNotifications = await runCheckOpenTrades();
  logger.info("Checking pending orders");
  const pendingNotifications = await runCheckPendingOrders();

  if (!result && openTradeNotifications + pendingNotifications === 0) {
    await maybeSendHeartbeat(runContext, engineMode, candleKey, heartbeatReason, latestCacheCandleKey);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info("Run complete", {
    scannedPairs: result?.setups.length ?? 0,
    elapsedSeconds: Number(elapsed),
    engineMode,
    runContext,
    timeframeMode,
    primaryTimeframe,
    openTradeNotifications,
    pendingNotifications,
  });
}

if (!process.env.VITEST) {
  main().catch(async (error) => {
    logger.error("Fatal error", { error });
    await notifyError("Bob Volman multi-timeframe scanner", error);
    process.exit(1);
  });
}
