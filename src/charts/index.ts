import "../shared/env.js";
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
  getConfiguredChartTradingSystem,
  getConfiguredChartTimeframeMode,
  shouldSendHeartbeatOnManualRun,
  shouldSendHeartbeatOutsideCloseWindow,
  shouldUseLatestCacheForManualRun,
} from "./chart-config-env.js";
import type { AnalysisResult, TradeSetup } from "./chart-types.js";
import {
  getLastClosedCandleKey,
  isWithinTimeframeCandleCloseWindow,
} from "./chart-cache.js";
import {
  loadChartAnalysisCache,
  loadLatestChartAnalysisCache,
  saveChartAnalysisCache,
} from "./chart-cache-repository.js";
import { analyzeAllChartsDeterministic } from "./deterministic-pipeline.js";
import { analyzeAllChartsSmc } from "./smc/smc-pipeline.js";
import { CHARTS, getChartsForTimeframeMode } from "./charts.config.js";
import { buildChartAnalysisCacheKey } from "./analyzer.js";

const logger = createLogger("charts:index");
const CANDLE_CLOSE_WINDOW_MS = 20 * 60 * 1000;

type AnalysisOrigin =
  | { source: "live"; candleKey: string }
  | { source: "cached"; candleKey: string };

function shouldAutoTrackAsOpen(setup: TradeSetup, threshold: number): boolean {
  return (
    setup.orderType === "MARKET_NOW" && (setup.confidence ?? 0) >= threshold
  );
}

function getPairs(): Array<{ pair: string; symbol: string }> {
  const seen = new Map<string, string>();
  for (const chart of CHARTS) {
    const pair = chart.name.replace(` ${chart.timeframe}`, "");
    if (!seen.has(pair)) seen.set(pair, chart.symbol);
  }
  return Array.from(seen.entries()).map(([pair, symbol]) => ({ pair, symbol }));
}

export function getChartScannerErrorScope(
  tradingSystem: ReturnType<typeof getConfiguredChartTradingSystem>,
): string {
  return tradingSystem === "smc"
    ? "SMC multi-timeframe scanner"
    : "Bob Volman multi-timeframe scanner";
}

async function analyzeCurrentWindow(
  candleKey: string,
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
  tradingSystem: ReturnType<typeof getConfiguredChartTradingSystem>,
): Promise<AnalysisResult> {
  const runtimeCharts = getChartsForTimeframeMode(
    timeframeMode,
    primaryTimeframe,
  );
  logger.info(`Using ${tradingSystem} engine (no AI vision)`, {
    timeframeMode,
    primaryTimeframe,
    tradingSystem,
    intervals: Array.from(
      new Set(runtimeCharts.map((chart) => chart.timeframe)),
    ),
  });
  const result =
    tradingSystem === "smc"
      ? await analyzeAllChartsSmc(getPairs(), {
          timeframeMode,
          primaryTimeframe,
        })
      : await analyzeAllChartsDeterministic(getPairs(), {
          timeframeMode,
          primaryTimeframe,
        });
  await saveChartAnalysisCache(candleKey, result);
  return result;
}

async function loadAnalysisForRun(
  candleBaseKey: string,
  analysisTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
  runContext: ReturnType<typeof getConfiguredChartRunContext>,
  tradingSystem: ReturnType<typeof getConfiguredChartTradingSystem>,
): Promise<{
  result: AnalysisResult | null;
  origin: AnalysisOrigin | null;
  heartbeatReason: "no-cache" | "no-event" | null;
}> {
  const cacheLabel = tradingSystem === "smc" ? "smc" : "deterministic";
  const cacheKey = buildChartAnalysisCacheKey(
    candleBaseKey,
    cacheLabel,
    timeframeMode,
    primaryTimeframe,
  );
  const cached = await loadChartAnalysisCache(cacheKey);
  if (cached)
    return {
      result: cached,
      origin: { source: "cached", candleKey: cacheKey },
      heartbeatReason: null,
    };

  const withinCloseWindow = isWithinTimeframeCandleCloseWindow(
    analysisTimeframe,
    new Date(),
    CANDLE_CLOSE_WINDOW_MS,
  );
  if (withinCloseWindow) {
    const liveResult = await analyzeCurrentWindow(
      cacheKey,
      timeframeMode,
      primaryTimeframe,
      tradingSystem,
    );
    return {
      result: liveResult,
      origin: { source: "live", candleKey: cacheKey },
      heartbeatReason: null,
    };
  }

  if (runContext === "manual" && shouldUseLatestCacheForManualRun()) {
    const latest = await loadLatestChartAnalysisCache(
      cacheLabel,
      timeframeMode,
      primaryTimeframe,
    );
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
    heartbeatReason: shouldSendHeartbeatOutsideCloseWindow()
      ? "no-event"
      : null,
  };
}

async function handleAnalysisResult(
  result: AnalysisResult,
  origin: AnalysisOrigin,
  tradingSystem: ReturnType<typeof getConfiguredChartTradingSystem>,
): Promise<void> {
  const threshold = getConfiguredChartSignalConfidenceThreshold();
  for (const setup of result.setups) {
    if (shouldAutoTrackAsOpen(setup, threshold)) {
      try {
        const validation = validateTradeSetupForOpen(setup);
        if (!validation.accepted) {
          logger.info("Skipped open position due to risk/reward gate", {
            pair: setup.pair,
            reason: validation.reason,
          });
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
        logger.error("Failed to auto-save open position", {
          pair: setup.pair,
          error,
        });
      }
    } else if (
      (setup.confidence ?? 0) >= threshold &&
      setup.orderType !== "MARKET_NOW"
    ) {
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
        logger.error("Failed to save pending order", {
          pair: setup.pair,
          error,
        });
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
    systemLabel: tradingSystem,
  });
}

async function maybeSendHeartbeat(
  runContext: ReturnType<typeof getConfiguredChartRunContext>,
  candleKey: string,
  heartbeatReason: "no-cache" | "no-event" | null,
  latestCacheCandleKey?: string | null,
): Promise<void> {
  if (!heartbeatReason) return;
  await sendMessage(
    buildHeartbeatMessage({
      runContext,
      engineMode: getConfiguredChartTradingSystem(),
      reason: heartbeatReason,
      candleKey,
      latestCacheCandleKey: latestCacheCandleKey ?? null,
    }),
  );
}

export async function main(): Promise<void> {
  const startTime = Date.now();
  const runContext = getConfiguredChartRunContext();
  const tradingSystem = getConfiguredChartTradingSystem();
  const timeframeMode = getConfiguredChartTimeframeMode();
  const primaryTimeframe = getConfiguredChartPrimaryTimeframe();
  const analysisTimeframe =
    timeframeMode === "single" ? primaryTimeframe : "H4";
  logger.info("Chart scanner starting", {
    engineMode: tradingSystem,
    runContext,
    timeframeMode,
    primaryTimeframe,
    analysisTimeframe,
  });

  const candleBaseKey = getLastClosedCandleKey(analysisTimeframe);
  const cacheLabel = tradingSystem === "smc" ? "smc" : "deterministic";
  const candleKey = buildChartAnalysisCacheKey(
    candleBaseKey,
    cacheLabel,
    timeframeMode,
    primaryTimeframe,
  );
  let latestCacheCandleKey: string | null = null;
  let result: AnalysisResult | null = null;
  let origin: AnalysisOrigin | null = null;
  let heartbeatReason: "no-cache" | "no-event" | null = null;

  const analysisState = await loadAnalysisForRun(
    candleBaseKey,
    analysisTimeframe,
    timeframeMode,
    primaryTimeframe,
    runContext,
    tradingSystem,
  );
  result = analysisState.result;
  origin = analysisState.origin;
  heartbeatReason = analysisState.heartbeatReason;
  if (origin?.source === "cached") latestCacheCandleKey = origin.candleKey;

  if (result && origin) {
    await handleAnalysisResult(result, origin, tradingSystem);
  } else {
    logger.warn(
      `⏭ Bỏ qua analyze — ngoài cửa sổ chạy cho last closed ${analysisTimeframe} candle (${candleBaseKey}), vẫn kiểm tra trade/pending`,
      { engineMode: tradingSystem },
    );
  }

  logger.info("Checking open positions");
  const openTradeNotifications = await runCheckOpenTrades();
  logger.info("Checking pending orders");
  // const pendingNotifications = await runCheckPendingOrders();
  // + pendingNotifications == 0

  if (!result && openTradeNotifications === 0) {
    await maybeSendHeartbeat(
      runContext,
      candleKey,
      heartbeatReason,
      latestCacheCandleKey,
    );
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const attemptedPairs =
    result?.analysisStats?.attemptedPairs ?? result?.summaries.length ?? 0;
  const summaryPairs = result?.summaries.length ?? 0;
  const skippedPairs = result?.analysisStats?.skippedPairs ?? 0;
  const setupCount =
    result?.analysisStats?.setupCount ?? result?.setups.length ?? 0;
  logger.info("Run complete", {
    scannedPairs: attemptedPairs,
    attemptedPairs,
    summaryPairs,
    skippedPairs,
    setupCount,
    elapsedSeconds: Number(elapsed),
    engineMode: tradingSystem,
    runContext,
    timeframeMode,
    primaryTimeframe,
    analysisTimeframe,
    openTradeNotifications,
    pendingNotifications,
  });
}

if (!process.env.VITEST) {
  main().catch(async (error) => {
    logger.error("Fatal error", { error });
    await notifyError(
      getChartScannerErrorScope(getConfiguredChartTradingSystem()),
      error,
    );
    process.exit(1);
  });
}
