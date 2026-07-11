import "../shared/env.js";
import { saveOpenPosition, findOpenPositionIdByPair /*, savePendingOrder */ } from "./positions-repository-volman.js";
import { runCheckOpenTrades } from "./check-open-trades-runner-volman.js";
// import { runCheckPendingOrders } from "./check-pending-orders-runner.js"; // DISABLED: signals-only mode, xem tasks/disable-pending-orders/plan.md
import {
  sendMessage,
  notifyError,
} from "../shared/telegram-client.js";
import {
  buildHeartbeatMessage,
  sendAllAnalysesVolman,
} from "../shared/telegram-volman.js";
import { createLogger } from "../shared/logger.js";
import { validateTradeSetupForOpen } from "./position-engine-volman.js";
import {
  getConfiguredChartPrimaryTimeframe,
  getConfiguredChartEngineMode,
  getConfiguredChartRunContext,
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredChartTimeframeMode,
  shouldSendHeartbeatOnManualRun,
  shouldSendHeartbeatOutsideCloseWindow,
  shouldUseLatestCacheForManualRun,
} from "./volman-config-env.js";
import type { AnalysisResult, TradeSetup } from "./chart-types-volman.js";
import { applySignalFreshnessGuard } from "./signal-freshness.js";
import {
  getLastClosedCandleKey,
  isWithinTimeframeCandleCloseWindow,
} from "./chart-cache.js";
import {
  loadChartAnalysisCache,
  loadLatestChartAnalysisCache,
  saveChartAnalysisCache,
} from "./chart-cache-repository-volman.js";
import { analyzeAllChartsDeterministic } from "./deterministic-pipeline.js";
import { CHARTS, getChartsForTimeframeMode } from "./volman-charts.config.js";
import { openBinanceFuturesPosition } from "./binance-execution-volman.js";
import {
  isBinanceLiveTradingEnabled,
  isBinanceLiveTradingEnabledVolman,
} from "./binance-futures-config-env.js";
import { buildChartAnalysisCacheKey } from "./analyzer-common.js";

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

export function getChartScannerErrorScope(): string {
  return "Bob Volman multi-timeframe scanner";
}

async function analyzeCurrentWindow(
  candleKey: string,
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
): Promise<AnalysisResult> {
  const runtimeCharts = getChartsForTimeframeMode(
    timeframeMode,
    primaryTimeframe,
  );
  logger.info(`Using Bob Volman engine (no AI vision)`, {
    timeframeMode,
    primaryTimeframe,
    intervals: Array.from(
      new Set(runtimeCharts.map((chart) => chart.timeframe)),
    ),
  });
  const result = await analyzeAllChartsDeterministic(getPairs(), {
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
): Promise<{
  result: AnalysisResult | null;
  origin: AnalysisOrigin | null;
  heartbeatReason: "no-cache" | "no-event" | null;
}> {
  const cacheLabel = "deterministic";
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
): Promise<void> {
  const threshold = getConfiguredChartSignalConfidenceThreshold();

  // Apply freshness guard BEFORE auto-track to prevent saving stale positions
  const symbolByPair = new Map<string, string>();
  for (const chart of CHARTS) {
    const pair = chart.name.replace(/ [A-Z0-9]+$/, ""); // Remove timeframe suffix
    if (!symbolByPair.has(pair)) symbolByPair.set(pair, chart.symbol);
  }

  const freshnessReasons: string[] = [];
  const filteredSetups: TradeSetup[] = [];

  for (const setup of result.setups) {
    const symbol = symbolByPair.get(setup.pair) ?? setup.pair;
    const guardedSetup = await applySignalFreshnessGuard(setup as any, symbol);
    if (guardedSetup.noSetupReason) {
      freshnessReasons.push(`${setup.pair}: ${guardedSetup.noSetupReason}`);
      logger.info("Setup filtered by freshness guard", {
        pair: setup.pair,
        reason: guardedSetup.noSetupReason,
      });
    } else {
      filteredSetups.push(guardedSetup as TradeSetup);
    }
  }

  result.setups = filteredSetups;
  if (freshnessReasons.length > 0) {
    result.noSetupReason = [result.noSetupReason, ...freshnessReasons]
      .filter(Boolean)
      .join("\n");
  }

  // Auto-track open positions (now only for fresh setups after guard)
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
          if (isBinanceLiveTradingEnabled() && isBinanceLiveTradingEnabledVolman()) {
            const chartSymbol = symbolByPair.get(setup.pair);
            if (chartSymbol) {
              const positionId = await findOpenPositionIdByPair(setup.pair);
              if (positionId !== null) {
                await openBinanceFuturesPosition(setup, positionId, chartSymbol);
              }
            }
          }
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
      // DISABLED: signals-only mode, không tạo pending order nữa. Xem tasks/disable-pending-orders/plan.md
      // try {
      //   const saved = await savePendingOrder(setup);
      //   if (saved) {
      //     logger.info("Saved pending order", {
      //       pair: setup.pair,
      //       orderType: setup.orderType,
      //       primaryTimeframe: setup.primaryTimeframe,
      //     });
      //   } else {
      //     logger.info("Skipped duplicate pending order", {
      //       pair: setup.pair,
      //       orderType: setup.orderType,
      //     });
      //   }
      // } catch (error) {
      //   logger.error("Failed to save pending order", {
      //     pair: setup.pair,
      //     error,
      //   });
      // }
    }
  }

  logger.info("Sending results to Telegram", {
    source: origin.source,
    candleKey: origin.candleKey,
  });
  await sendAllAnalysesVolman(result, undefined, {
    source: origin.source,
    candleKey: origin.candleKey,
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
      engineMode: "bob-volman",
      reason: heartbeatReason,
      candleKey,
      latestCacheCandleKey: latestCacheCandleKey ?? null,
    }),
  );
}

export async function main(): Promise<void> {
  const startTime = Date.now();
  const runContext = getConfiguredChartRunContext();
  const timeframeMode = getConfiguredChartTimeframeMode();
  const primaryTimeframe = getConfiguredChartPrimaryTimeframe();
  const analysisTimeframe =
    timeframeMode === "single" ? primaryTimeframe : "H4";
  logger.info("Chart scanner starting", {
    engineMode: "bob-volman",
    runContext,
    timeframeMode,
    primaryTimeframe,
    analysisTimeframe,
  });

  const candleBaseKey = getLastClosedCandleKey(analysisTimeframe);
  const cacheLabel = "deterministic";
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
  );
  result = analysisState.result;
  origin = analysisState.origin;
  heartbeatReason = analysisState.heartbeatReason;
  if (origin?.source === "cached") latestCacheCandleKey = origin.candleKey;

  if (result && origin) {
    await handleAnalysisResult(result, origin);
  } else {
    logger.warn(
      `⏭ Bỏ qua analyze — ngoài cửa sổ chạy cho last closed ${analysisTimeframe} candle (${candleBaseKey}), vẫn kiểm tra trade/pending`,
      { engineMode: "bob-volman" },
    );
  }

  logger.info("Checking open positions");
  const openTradeNotifications = await runCheckOpenTrades();
  // DISABLED: signals-only mode, không check/resolve pending order nữa. Xem tasks/disable-pending-orders/plan.md
  // const pendingNotifications = await runCheckPendingOrders();

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
    engineMode: "bob-volman",
    runContext,
    timeframeMode,
    primaryTimeframe,
    analysisTimeframe,
    openTradeNotifications,
    // pendingNotifications,
  });
}

if (!process.env.VITEST) {
  main().catch(async (error) => {
    logger.error("Fatal error", { error });
    await notifyError(
      getChartScannerErrorScope(),
      error,
    );
    process.exit(1);
  });
}
