import "../shared/env.js";
import {
  saveOpenPosition,
  findOpenPositionIdByPair,
  loadOpenPairs,
} from "./positions-repository-volman.js";
import { runCheckOpenTrades } from "./check-open-trades-runner-volman.js";
import { sendMessage, notifyError } from "../shared/telegram-client.js";
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
import type { ChartTimeframe } from "./chart-types-common.js";
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
import {
  openBinanceFuturesPosition,
  pollPendingEntryOrders,
} from "./binance-execution-volman.js";
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
  // Whether/how the entry actually executes (MARKET vs LIMIT/STOP) is decided
  // separately in binance-execution-shared.ts based on isBinanceHonorOrderTypeEnabledVolman()
  // — auto-tracking itself only depends on signal quality (confidence threshold).
  return (setup.confidence ?? 0) >= threshold;
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
  analysisTimeframe: ChartTimeframe,
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

  // Filter out setups whose pair already has an open position — those pairs are
  // monitored/managed via runCheckOpenTrades(), not re-signaled here.
  const openPairs = await loadOpenPairs();
  const openPositionReasons: string[] = [];
  const setupsAfterOpenPositionFilter: TradeSetup[] = [];

  for (const setup of result.setups) {
    if (openPairs.has(setup.pair)) {
      openPositionReasons.push(
        `${setup.pair}: Đã có vị thế mở — chỉ theo dõi/quản lý, không gửi lại tín hiệu.`,
      );
      logger.info("Setup filtered — pair already has open position", {
        pair: setup.pair,
      });
    } else {
      setupsAfterOpenPositionFilter.push(setup);
    }
  }

  result.setups = setupsAfterOpenPositionFilter;
  if (openPositionReasons.length > 0) {
    result.noSetupReason = [result.noSetupReason, ...openPositionReasons]
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
          if (
            isBinanceLiveTradingEnabled() &&
            isBinanceLiveTradingEnabledVolman()
          ) {
            const chartSymbol = symbolByPair.get(setup.pair);
            if (chartSymbol) {
              const positionId = await findOpenPositionIdByPair(setup.pair);
              if (positionId !== null) {
                await openBinanceFuturesPosition(
                  setup,
                  positionId,
                  chartSymbol,
                );
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
        await sendMessage(
          `⚠️ *Auto Track (Volman)* — Không lưu được vị thế mở cho ${setup.pair}: ${error instanceof Error ? error.message : String(error)}\nSignal có thể bị bỏ lỡ hoàn toàn (không track, không có lệnh thật) — kiểm tra log/DB.`,
        );
      }
    }
  }

  logger.info("Sending results to Telegram", {
    source: origin.source,
    candleKey: origin.candleKey,
  });
  await sendAllAnalysesVolman(result, undefined, {
    source: origin.source,
    candleKey: origin.candleKey,
    timeframe: analysisTimeframe,
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

// Every timeframe the deterministic engine actively trades when CHART_TIMEFRAME_MODE=multi.
// "multi" used to just mean "hardcode H4" (a no-op relative to "single" + H4) — it now means
// scan each of these independently: own OHLC fetch, own cache key, own Telegram signal+chart.
const ACTIVE_SCAN_TIMEFRAMES: ChartTimeframe[] = ["M15", "H1", "H4"];

async function runScanForTimeframe(
  primaryTimeframe: ChartTimeframe,
  runContext: ReturnType<typeof getConfiguredChartRunContext>,
): Promise<{
  result: AnalysisResult | null;
  candleKey: string;
  latestCacheCandleKey: string | null;
  heartbeatReason: "no-cache" | "no-event" | null;
}> {
  const analysisTimeframe = primaryTimeframe;
  const candleBaseKey = getLastClosedCandleKey(analysisTimeframe);
  const cacheLabel = "deterministic";
  // Always key/analyze this as a single-timeframe scan for `primaryTimeframe` specifically —
  // the outer loop (not this "mode" string) is what makes multi-timeframe scanning work.
  // Passing the configured "multi" mode straight through here would make
  // analyzeAllChartsDeterministic hardcode H4 regardless of which timeframe we're looping on.
  const candleKey = buildChartAnalysisCacheKey(
    candleBaseKey,
    cacheLabel,
    "single",
    primaryTimeframe,
  );

  const analysisState = await loadAnalysisForRun(
    candleBaseKey,
    analysisTimeframe,
    "single",
    primaryTimeframe,
    runContext,
  );
  const { result, origin, heartbeatReason } = analysisState;
  const latestCacheCandleKey = origin?.source === "cached" ? origin.candleKey : null;

  if (result && origin) {
    await handleAnalysisResult(result, origin, analysisTimeframe);
  } else {
    logger.warn(
      `⏭ Bỏ qua analyze [${primaryTimeframe}] — ngoài cửa sổ chạy cho last closed candle (${candleBaseKey}), vẫn kiểm tra trade/pending`,
      { engineMode: "bob-volman" },
    );
  }

  return { result, candleKey, latestCacheCandleKey, heartbeatReason };
}

export async function main(): Promise<void> {
  const startTime = Date.now();
  const runContext = getConfiguredChartRunContext();
  const timeframeMode = getConfiguredChartTimeframeMode();
  const configuredPrimaryTimeframe = getConfiguredChartPrimaryTimeframe();
  const timeframesToScan: ChartTimeframe[] =
    timeframeMode === "single" ? [configuredPrimaryTimeframe] : ACTIVE_SCAN_TIMEFRAMES;

  logger.info("Chart scanner starting", {
    engineMode: "bob-volman",
    runContext,
    timeframeMode,
    timeframesToScan,
  });

  let anyResult = false;
  let latestCacheCandleKey: string | null = null;
  let heartbeatReason: "no-cache" | "no-event" | null = null;
  let lastCandleKey = "";
  const runStats: Array<{ timeframe: ChartTimeframe; result: AnalysisResult | null }> = [];

  for (const primaryTimeframe of timeframesToScan) {
    const scan = await runScanForTimeframe(primaryTimeframe, runContext);
    if (scan.result) anyResult = true;
    if (scan.latestCacheCandleKey) latestCacheCandleKey = scan.latestCacheCandleKey;
    if (scan.heartbeatReason) heartbeatReason = scan.heartbeatReason;
    lastCandleKey = scan.candleKey;
    runStats.push({ timeframe: primaryTimeframe, result: scan.result });
  }

  // Open positions/pending entry orders can originate from ANY of the timeframes above
  // (each carries its own primary_timeframe in the DB) — check across all of them in one
  // pass rather than re-scoping per scanned timeframe.
  logger.info("Checking open positions (all timeframes)");
  const openTradeNotifications = await runCheckOpenTrades();

  if (isBinanceLiveTradingEnabled() && isBinanceLiveTradingEnabledVolman()) {
    logger.info("Polling pending entry orders (all timeframes)");
    await pollPendingEntryOrders();
  }

  if (!anyResult && openTradeNotifications === 0) {
    await maybeSendHeartbeat(
      runContext,
      lastCandleKey,
      heartbeatReason,
      latestCacheCandleKey,
    );
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  for (const { timeframe, result } of runStats) {
    logger.info("Run complete", {
      timeframe,
      scannedPairs: result?.analysisStats?.attemptedPairs ?? result?.summaries.length ?? 0,
      attemptedPairs: result?.analysisStats?.attemptedPairs ?? result?.summaries.length ?? 0,
      summaryPairs: result?.summaries.length ?? 0,
      skippedPairs: result?.analysisStats?.skippedPairs ?? 0,
      setupCount: result?.analysisStats?.setupCount ?? result?.setups.length ?? 0,
      engineMode: "bob-volman",
      runContext,
    });
  }
  logger.info("All timeframes complete", {
    elapsedSeconds: Number(elapsed),
    timeframeMode,
    timeframesToScan,
    openTradeNotifications,
  });
}

if (!process.env.VITEST) {
  main().catch(async (error) => {
    logger.error("Fatal error", { error });
    await notifyError(getChartScannerErrorScope(), error);
    process.exit(1);
  });
}
