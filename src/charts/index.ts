import "../shared/infra/env.js";
import {
  saveOpenPosition,
  findOpenPositionIdByPair,
  loadOpenPairs,
} from "./positions-repository-volman.js";
import { runCheckOpenTrades } from "./check-open-trades-runner-volman.js";
import { sendMessage, notifyError } from "../shared/notification/telegram-client.js";
import { sendAllAnalysesVolman } from "../shared/telegram-volman.js";
import { createLogger } from "../shared/infra/logger.js";
import {
  recordScannerRunOutcome,
  checkAndMaybeSendErrorStreakAlert,
} from "./scanner-health-repository-volman.js";
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
import { getCharts, getChartsForTimeframeMode } from "./volman-charts.config.js";
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

async function getPairs(): Promise<Array<{ pair: string; symbol: string }>> {
  const seen = new Map<string, string>();
  for (const chart of await getCharts()) {
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
  const runtimeCharts = await getChartsForTimeframeMode(
    timeframeMode,
    primaryTimeframe,
  );
  logger.info(`Using Bob Volman engine`, {
    timeframeMode,
    primaryTimeframe,
    intervals: Array.from(
      new Set(runtimeCharts.map((chart) => chart.timeframe)),
    ),
  });
  const result = await analyzeAllChartsDeterministic(await getPairs(), {
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
  for (const chart of await getCharts()) {
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
  let result: AnalysisResult | null = null;
  let origin: AnalysisOrigin | null = null;

  const analysisState = await loadAnalysisForRun(
    candleBaseKey,
    analysisTimeframe,
    timeframeMode,
    primaryTimeframe,
    runContext,
  );
  result = analysisState.result;
  origin = analysisState.origin;

  // Checks every timeframe's open positions in one pass (not just this process's own
  // primaryTimeframe) — M15/H1/H4 each run as a separate scheduled process (see
  // deploy/windows/register-tasks.ps1 + run-job.ps1), so whichever one fires still needs to
  // catch SL/TP hits for positions opened by any of the others.
  logger.info("Checking open positions (all timeframes)");
  const openTradeNotifications = await runCheckOpenTrades();

  if (result && origin) {
    await handleAnalysisResult(result, origin, analysisTimeframe);
  } else {
    logger.warn(
      `⏭ Bỏ qua analyze — ngoài cửa sổ chạy cho last closed ${analysisTimeframe} candle (${candleBaseKey}), vẫn kiểm tra trade/pending`,
      { engineMode: "bob-volman" },
    );
  }

  // Poll pending entry orders (LIMIT/STOP) waiting to fill — across every timeframe, for the
  // same reason as runCheckOpenTrades() above.
  if (isBinanceLiveTradingEnabled() && isBinanceLiveTradingEnabledVolman()) {
    logger.info("Polling pending entry orders (all timeframes)");
    await pollPendingEntryOrders();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const attemptedPairs =
    result?.analysisStats?.attemptedPairs ?? result?.summaries.length ?? 0;
  const summaryPairs = result?.summaries.length ?? 0;
  const skippedPairs = result?.analysisStats?.skippedPairs ?? 0;
  const setupCount =
    result?.analysisStats?.setupCount ?? result?.setups.length ?? 0;

  const attemptedPairsForHealth = result?.analysisStats?.attemptedPairs ?? 0;
  const skippedPairsForHealth = result?.analysisStats?.skippedPairs ?? 0;
  const runFailed =
    attemptedPairsForHealth > 0 &&
    attemptedPairsForHealth === skippedPairsForHealth;
  await recordScannerRunOutcome(
    runFailed ? "error" : "ok",
    runFailed
      ? `All ${attemptedPairsForHealth} attempted pairs were skipped this run`
      : undefined,
  );
  await checkAndMaybeSendErrorStreakAlert(async (streakSinceIso) => {
    await notifyError(
      getChartScannerErrorScope(),
      new Error(
        `Không có lần chạy scan thành công nào kể từ ${streakSinceIso} (≥2 giờ liên tục lỗi).`,
      ),
    );
  });

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
  });
}

if (!process.env.VITEST) {
  main().catch(async (error) => {
    logger.error("Fatal error", { error });
    await notifyError(getChartScannerErrorScope(), error);
    await recordScannerRunOutcome(
      "error",
      error instanceof Error ? error.message : String(error),
    );
    await checkAndMaybeSendErrorStreakAlert(async (streakSinceIso) => {
      await notifyError(
        getChartScannerErrorScope(),
        new Error(
          `Không có lần chạy scan thành công nào kể từ ${streakSinceIso} (≥2 giờ liên tục lỗi).`,
        ),
      );
    });
    process.exit(1);
  });
}
