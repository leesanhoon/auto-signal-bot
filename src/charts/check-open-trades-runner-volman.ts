import { fetchCandleRangeStats, findChartForPair } from "./candle-range-stats.js";
import { getCharts } from "./volman-charts.config.js";
import { buildPositionManagementPatch, closePosition, loadOpenPositions, updatePositionDecision } from "./positions-repository-volman.js";
import { buildPositionDecisionMessage, buildPositionClosedMessage } from "../shared/telegram-volman.js";
import { sendMessage } from "../shared/telegram-client.js";
import { createLogger } from "../shared/logger.js";
import type { PositionDecisionOutcome } from "./position-engine-volman.js";
import { resolveOpenPositionDecision } from "./position-decision-volman.js";
import { reconcileBinancePosition } from "./binance-execution-volman.js";
import { isEmaExitEnabled, getEmaExitPeriod } from "./volman-config-env.js";
import { calculateLatestEma } from "./position-ema-exit.js";
import { fetchOhlcHistory } from "./ohlc-provider.js";

const logger = createLogger("charts:check-open-trades-volman");

function formatCheckedAt(): string {
  return new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

async function evaluateOpenPosition(
  position: Awaited<ReturnType<typeof loadOpenPositions>>[number],
): Promise<PositionDecisionOutcome> {
  if (position.binanceSymbol) {
    return reconcileBinancePosition(position);
  }

  const chart = findChartForPair(await getCharts(), position.pair, position.primaryTimeframe ?? "H4");
  if (!chart) {
    logger.warn("No chart configuration found; sending explicit warning", { pair: position.pair, id: position.id });
    await sendMessage(
      `⚠️ *Check Open Trades*\n\nKhông tìm thấy cấu hình chart cho vị thế #${position.id} ${position.pair}.\nBot tạm giữ vị thế nhưng không thể xác minh SL/TP trong lượt này. Vui lòng kiểm tra cấu hình chart / mapping pair.`,
    );
    return resolveOpenPositionDecision(position, null, "missing_chart_config");
  }

  const stats = await fetchCandleRangeStats(chart.symbol, new Date(position.openedAt).getTime());
  if (stats === null) {
    logger.warn("Failed to fetch OHLC for open position; sending explicit warning", { pair: position.pair, id: position.id });
    await sendMessage(
      `⚠️ *Check Open Trades*\n\nKhông lấy được OHLC để kiểm tra vị thế #${position.id} ${position.pair}.\nBot tạm giữ vị thế nhưng không thể xác minh SL/TP trong lượt này. Vui lòng kiểm tra dữ liệu thị trường / nguồn chart.`,
    );
  }

  let emaContext: { emaValue: number | null; period: number; lastClose: number | null } | null = null;
  if (isEmaExitEnabled()) {
    const period = getEmaExitPeriod();
    const candlesResult = await fetchOhlcHistory(chart.symbol, chart.timeframe, period + 5);
    if (!(candlesResult instanceof Error) && candlesResult.length > 0) {
      emaContext = {
        emaValue: calculateLatestEma(candlesResult, period),
        period,
        lastClose: candlesResult[candlesResult.length - 1].close,
      };
    } else if (candlesResult instanceof Error) {
      logger.warn("Failed to fetch candles for EMA exit check", { pair: position.pair, id: position.id, error: candlesResult });
    }
  }
  return resolveOpenPositionDecision(position, stats, undefined, emaContext);
}

export async function processPosition(position: Awaited<ReturnType<typeof loadOpenPositions>>[number]): Promise<boolean> {
  const decision = await evaluateOpenPosition(position);
  const { patch, closePosition: shouldClose } = buildPositionManagementPatch(position, decision);
  await updatePositionDecision(position.id, decision, patch);

  if (shouldClose) {
    const snapshot = await closePosition(position, decision, patch);
    const closedMessage = buildPositionClosedMessage(
      {
        id: position.id,
        pair: position.pair,
        direction: position.direction,
        setup: position.setup,
        entry: position.entry,
        openedAt: position.openedAt
          ? new Date(position.openedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
          : null,
      },
      snapshot,
      {
        isFailSafeClose:
          position.binanceExecutionStatus === "failed" ||
          position.binanceExecutionStatus === "close_failed",
      },
    );
    await sendMessage(`${closedMessage}\n\n*Cập nhật lúc:* ${formatCheckedAt()}`);
    return true;
  }

  const message = buildPositionDecisionMessage(
    {
      id: position.id,
      pair: position.pair,
      direction: position.direction,
      setup: position.setup,
      entry: position.entry,
      stopLoss: position.stopLoss,
      takeProfit1: position.takeProfit1,
      takeProfit2: position.takeProfit2,
      reasons: position.reasons,
      openedAt: position.openedAt ? new Date(position.openedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : null,
      lastDecision: position.lastDecision,
      lastDecisionConfidence: position.lastDecisionConfidence,
      lastDecisionComment: position.lastDecisionComment,
      tradeStage: patch?.tradeStage ?? position.tradeStage,
    },
    decision,
  );

  await sendMessage(`${message}\n\n*Cập nhật lúc:* ${formatCheckedAt()}`);
  return true;
}

const ALL_POSITION_TIMEFRAMES: Array<"M15" | "M30" | "H1" | "H4" | "D1"> = [
  "M15", "M30", "H1", "H4", "D1",
];

/**
 * Checks open positions across every timeframe a position could have been opened from
 * (not just the scanner's currently-configured primary timeframe) — a position opened
 * from an M15 or H1 signal must still get its SL/TP checked even if the scanner is now
 * (or has always been) configured to scan H4. Defaults to all timeframes; pass a subset
 * only if you specifically want to scope the check.
 */
export async function runCheckOpenTrades(
  timeframes: Array<"M15" | "M30" | "H1" | "H4" | "D1"> = ALL_POSITION_TIMEFRAMES,
): Promise<number> {
  let notificationsSent = 0;

  for (const timeframe of timeframes) {
    logger.info("Check open trades starting", { timeframe });
    const positions = await loadOpenPositions(timeframe);
    if (positions.length === 0) {
      logger.info("No open positions", { timeframe });
      continue;
    }

    logger.info("Loaded open positions", { timeframe, count: positions.length });

    for (const position of positions) {
      try {
        logger.info("Checking open position", { id: position.id, pair: position.pair });
        if (await processPosition(position)) {
          notificationsSent += 1;
        }
        logger.info("Finished open position", { id: position.id, pair: position.pair });
      } catch (error) {
        logger.error("Failed to check open position", { id: position.id, pair: position.pair, error });
        await sendMessage(
          `⚠️ *Check Open Trades*\n\nKhông thể kiểm tra vị thế #${position.id} ${position.pair}:\n${error instanceof Error ? error.message : String(error)}`,
        );
        notificationsSent += 1;
      }
    }
  }

  logger.info("Check open trades complete");
  return notificationsSent;
}
