import "../shared/env.js";
import { saveOpenPosition, findOpenPositionIdByPair } from "./positions-repository-smc.js";
import { runCheckOpenTrades } from "./check-open-trades-runner-smc.js";
import { sendMessage, notifyError } from "../shared/telegram-client.js";
import { buildHeartbeatMessage, sendAllAnalysesSmc } from "../shared/telegram-smc.js";
import { createLogger } from "../shared/logger.js";
import { validateTradeSetupForOpen } from "./position-engine-smc.js";
import {
  getConfiguredChartPrimaryTimeframe,
  getConfiguredChartRunContext,
  getConfiguredChartTimeframeMode,
  getConfiguredSmcMinSignalConfidence,
  getConfiguredSmcMinRiskPct,
  shouldSendHeartbeatOnManualRun,
  shouldSendHeartbeatOutsideCloseWindow,
  shouldUseLatestCacheForManualRun,
} from "./smc-config-env.js";
import type { AnalysisResult, TradeSetup } from "./chart-types-smc.js";
import { applySignalFreshnessGuard } from "./signal-freshness.js";
import { getLastClosedCandleKey, isWithinTimeframeCandleCloseWindow } from "./chart-cache.js";
import {
  loadChartAnalysisCache,
  loadLatestChartAnalysisCache,
  saveChartAnalysisCache,
} from "./chart-cache-repository-smc.js";
import { analyzeAllChartsSmc } from "./smc/smc-pipeline.js";
import { CHARTS, getChartsForTimeframeMode } from "./smc-charts.config.js";
import { openBinanceFuturesPosition, pollPendingEntryOrders } from "./binance-execution-smc.js";
import {
  isBinanceLiveTradingEnabled,
  isBinanceLiveTradingEnabledSmc,
  isBinanceHonorOrderTypeEnabledSmc,
} from "./binance-futures-config-env.js";
import { buildChartAnalysisCacheKey } from "./analyzer-common.js";

const logger = createLogger("charts:smc-index");
const CANDLE_CLOSE_WINDOW_MS = 20 * 60 * 1000;
const SMC_CACHE_LABEL = "smc";

type AnalysisOrigin =
  | { source: "live"; candleKey: string }
  | { source: "cached"; candleKey: string };

function shouldAutoTrackAsOpen(setup: TradeSetup, threshold: number): boolean {
  if ((setup.confidence ?? 0) < threshold) return false;

  if (setup.orderType === "MARKET_NOW") return true;

  // If HONOR_ORDER_TYPE is enabled, also auto-track LIMIT/STOP orders
  if (isBinanceHonorOrderTypeEnabledSmc() &&
      (setup.orderType === "BUY_LIMIT" || setup.orderType === "SELL_LIMIT" ||
       setup.orderType === "BUY_STOP" || setup.orderType === "SELL_STOP")) {
    return true;
  }

  return false;
}

function getPairs(): Array<{ pair: string; symbol: string }> {
  const seen = new Map<string, string>();
  for (const chart of CHARTS) {
    const pair = chart.name.replace(` ${chart.timeframe}`, "");
    if (!seen.has(pair)) seen.set(pair, chart.symbol);
  }
  return Array.from(seen.entries()).map(([pair, symbol]) => ({ pair, symbol }));
}

/**
 * Khớp đúng công thức trong smc-pipeline.ts (hàm analysisTimeframe nội bộ):
 * timeframeMode === "single" ? primaryTimeframe : "M15".
 * Bắt buộc 2 nơi phải luôn khớp nhau — cache key/window ở đây phải phản ánh
 * đúng timeframe mà analyzeAllChartsSmc thực sự dùng để phân tích.
 */
function smcAnalysisTimeframe(
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
): ReturnType<typeof getConfiguredChartPrimaryTimeframe> {
  return timeframeMode === "single" ? primaryTimeframe : "M15";
}

async function analyzeCurrentWindow(
  candleKey: string,
  timeframeMode: ReturnType<typeof getConfiguredChartTimeframeMode>,
  primaryTimeframe: ReturnType<typeof getConfiguredChartPrimaryTimeframe>,
): Promise<AnalysisResult> {
  const runtimeCharts = getChartsForTimeframeMode(timeframeMode, primaryTimeframe);
  logger.info("Using SMC engine", {
    timeframeMode,
    primaryTimeframe,
    intervals: Array.from(new Set(runtimeCharts.map((chart) => chart.timeframe))),
  });
  const minSignalConfidence = getConfiguredSmcMinSignalConfidence();
  const minRiskPct = getConfiguredSmcMinRiskPct();
  const result = await analyzeAllChartsSmc(getPairs(), { timeframeMode, primaryTimeframe, minSignalConfidence, minRiskPct });
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
  const cacheKey = buildChartAnalysisCacheKey(candleBaseKey, SMC_CACHE_LABEL, timeframeMode, primaryTimeframe);
  const cached = await loadChartAnalysisCache(cacheKey);
  if (cached) {
    return { result: cached, origin: { source: "cached", candleKey: cacheKey }, heartbeatReason: null };
  }

  const withinCloseWindow = isWithinTimeframeCandleCloseWindow(analysisTimeframe, new Date(), CANDLE_CLOSE_WINDOW_MS);
  if (withinCloseWindow) {
    const liveResult = await analyzeCurrentWindow(cacheKey, timeframeMode, primaryTimeframe);
    return { result: liveResult, origin: { source: "live", candleKey: cacheKey }, heartbeatReason: null };
  }

  if (runContext === "manual" && shouldUseLatestCacheForManualRun()) {
    const latest = await loadLatestChartAnalysisCache(SMC_CACHE_LABEL, timeframeMode, primaryTimeframe);
    if (latest) {
      return { result: latest.result, origin: { source: "cached", candleKey: latest.candleKey }, heartbeatReason: null };
    }
    return { result: null, origin: null, heartbeatReason: shouldSendHeartbeatOnManualRun() ? "no-cache" : null };
  }

  return { result: null, origin: null, heartbeatReason: shouldSendHeartbeatOutsideCloseWindow() ? "no-event" : null };
}

async function handleAnalysisResult(result: AnalysisResult, origin: AnalysisOrigin): Promise<void> {
  const threshold = getConfiguredSmcMinSignalConfidence();

  // Apply freshness guard BEFORE auto-track to prevent saving stale positions
  const symbolByPair = new Map(getPairs().map((p) => [p.pair, p.symbol]));
  const freshnessReasons: string[] = [];
  const filteredSetups: TradeSetup[] = [];

  for (const setup of result.setups) {
    const symbol = symbolByPair.get(setup.pair) ?? setup.pair;
    const guardedSetup = await applySignalFreshnessGuard(setup, symbol);
    if (guardedSetup.noSetupReason) {
      freshnessReasons.push(`${setup.pair}: ${guardedSetup.noSetupReason}`);
      logger.info("Setup filtered by freshness guard", {
        pair: setup.pair,
        reason: guardedSetup.noSetupReason,
      });
    } else {
      filteredSetups.push(guardedSetup);
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
          logger.info("Skipped open position due to risk/reward gate", { pair: setup.pair, reason: validation.reason });
          continue;
        }
        const saved = await saveOpenPosition(setup);
        if (saved) {
          setup.autoTracked = true;
          logger.info("Auto-saved open position", { pair: setup.pair });
          if (isBinanceLiveTradingEnabled() && isBinanceLiveTradingEnabledSmc()) {
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
        logger.error("Failed to auto-save open position", { pair: setup.pair, error });
      }
    }
  }

  logger.info("Sending results to Telegram", { source: origin.source, candleKey: origin.candleKey });
  await sendAllAnalysesSmc(result, undefined, { source: origin.source, candleKey: origin.candleKey });
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
      engineMode: "smc",
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
  const analysisTimeframe = smcAnalysisTimeframe(timeframeMode, primaryTimeframe);

  logger.info("SMC scanner starting", { runContext, timeframeMode, primaryTimeframe, analysisTimeframe });

  const candleBaseKey = getLastClosedCandleKey(analysisTimeframe);
  const candleKey = buildChartAnalysisCacheKey(candleBaseKey, SMC_CACHE_LABEL, timeframeMode, primaryTimeframe);
  let latestCacheCandleKey: string | null = null;

  const analysisState = await loadAnalysisForRun(candleBaseKey, analysisTimeframe, timeframeMode, primaryTimeframe, runContext);
  const { result, origin, heartbeatReason } = analysisState;
  if (origin?.source === "cached") latestCacheCandleKey = origin.candleKey;

  if (result && origin) {
    await handleAnalysisResult(result, origin);
  } else {
    logger.warn(
      `⏭ Bỏ qua analyze — ngoài cửa sổ chạy cho last closed ${analysisTimeframe} candle (${candleBaseKey}), vẫn kiểm tra trade/pending`,
    );
  }

  logger.info("Checking open positions");
  const openTradeNotifications = await runCheckOpenTrades();

  // Poll pending entry orders (LIMIT/STOP) waiting to fill
  if (isBinanceLiveTradingEnabled() && isBinanceLiveTradingEnabledSmc()) {
    logger.info("Polling pending entry orders");
    await pollPendingEntryOrders();
  }

  if (!result && openTradeNotifications === 0) {
    await maybeSendHeartbeat(runContext, candleKey, heartbeatReason, latestCacheCandleKey);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info("Run complete", {
    setupCount: result?.analysisStats?.setupCount ?? result?.setups.length ?? 0,
    elapsedSeconds: Number(elapsed),
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
    await notifyError("SMC multi-timeframe scanner", error);
    process.exit(1);
  });
}
