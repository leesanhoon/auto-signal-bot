import { captureVerificationChartScreenshot, fetchCandleRangeStats, findChartForPair } from "./screenshot.js";
import { buildPositionManagementPatch, closePosition, loadOpenPositions, updatePositionDecision } from "./positions-repository.js";
import { decidePosition } from "./position-decision.js";
import { buildPositionDecisionMessage, sendMessage, sendPhoto } from "../shared/telegram.js";
import { createLogger } from "../shared/logger.js";
import type { PositionDecisionOutcome } from "./position-engine.js";
import type { CandleRangeStats } from "./chart-types.js";

const logger = createLogger("charts:check-open-trades");

function parsePrice(value: string): number | null {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value: number): string {
  const precision = value >= 1000 ? 2 : value >= 100 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(precision);
}

function resolvePositionByPrice(
  position: Awaited<ReturnType<typeof loadOpenPositions>>[number],
  stats: CandleRangeStats | null,
): PositionDecisionOutcome | null {
  if (stats === null) {
    return null;
  }

  const stopLoss = parsePrice(position.stopLoss);
  const takeProfit1 = parsePrice(position.takeProfit1);
  const takeProfit2 = position.takeProfit2 ? parsePrice(position.takeProfit2) : null;
  if (stopLoss === null || takeProfit1 === null) {
    return null;
  }

  const tp1AlreadyClosed = (position.tp1ClosedPercent ?? 0) > 0 || position.tradeStage === "tp1_partial";

  if (position.direction === "LONG") {
    if (stats.low <= stopLoss) {
      return {
        decision: "STOP",
        confidence: 99,
        comment: `Giá thấp nhất ${formatPrice(stats.low)} đã xuống dưới stop loss ${formatPrice(stopLoss)}.`,
        managementAction: "NONE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: false,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }

    if (takeProfit2 !== null && stats.high >= takeProfit2) {
      return {
        decision: "CLOSE",
        confidence: 99,
        comment: `Giá cao nhất ${formatPrice(stats.high)} đã chạm TP2 ${formatPrice(takeProfit2)}.`,
        managementAction: "TP2_CLOSE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: true,
        tp2Reached: true,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }

    if (!tp1AlreadyClosed && stats.high >= takeProfit1) {
      return {
        decision: "HOLD",
        confidence: 96,
        comment: `Giá cao nhất ${formatPrice(stats.high)} đã chạm TP1 ${formatPrice(takeProfit1)}.`,
        managementAction: "PARTIAL_TP1",
        partialClosePercent: 50,
        newStopLoss: position.entry,
        tp1Reached: true,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }
  } else {
    if (stats.high >= stopLoss) {
      return {
        decision: "STOP",
        confidence: 99,
        comment: `Giá cao nhất ${formatPrice(stats.high)} đã vượt stop loss ${formatPrice(stopLoss)}.`,
        managementAction: "NONE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: false,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }

    if (takeProfit2 !== null && stats.low <= takeProfit2) {
      return {
        decision: "CLOSE",
        confidence: 99,
        comment: `Giá thấp nhất ${formatPrice(stats.low)} đã chạm TP2 ${formatPrice(takeProfit2)}.`,
        managementAction: "TP2_CLOSE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: true,
        tp2Reached: true,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }

    if (!tp1AlreadyClosed && stats.low <= takeProfit1) {
      return {
        decision: "HOLD",
        confidence: 96,
        comment: `Giá thấp nhất ${formatPrice(stats.low)} đã chạm TP1 ${formatPrice(takeProfit1)}.`,
        managementAction: "PARTIAL_TP1",
        partialClosePercent: 50,
        newStopLoss: position.entry,
        tp1Reached: true,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: null,
        tp2RiskReward: null,
      };
    }
  }

  return null;
}

function formatCheckedAt(): string {
  return new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

async function processPosition(position: Awaited<ReturnType<typeof loadOpenPositions>>[number]): Promise<void> {
  const chart = findChartForPair(position.pair, "H4");
  if (!chart) {
    logger.warn("No chart configuration found", { pair: position.pair });
    return;
  }

  const screenshot = await captureVerificationChartScreenshot(chart);
  await sendPhoto(screenshot.buffer, `📊 ${position.pair} - kiểm tra vị thế (${chart.timeframe})`);

  const decision = await decidePosition(position, screenshot);
  const stats = await fetchCandleRangeStats(chart.symbol, new Date(position.openedAt).getTime());
  const priceDecision = resolvePositionByPrice(position, stats);
  const effectiveDecision = priceDecision ?? decision;
  const { patch, closePosition: shouldClose } = buildPositionManagementPatch(position, effectiveDecision);
  await updatePositionDecision(position.id, effectiveDecision, patch);
  if (shouldClose) {
    await closePosition(position, effectiveDecision, patch);
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
      tp1ClosedPercent: patch?.tp1ClosedPercent ?? position.tp1ClosedPercent,
      trailingStopLoss: patch?.trailingStopLoss ?? position.trailingStopLoss,
    },
    effectiveDecision,
  );

  await sendMessage(`${message}\n\n*Cập nhật lúc:* ${formatCheckedAt()}`);
}

export async function runCheckOpenTrades(): Promise<void> {
  logger.info("Check open trades starting");
  const positions = await loadOpenPositions();
  if (positions.length === 0) {
    logger.info("No open positions");
    return;
  }

  logger.info("Loaded open positions", { count: positions.length });

  for (const position of positions) {
    try {
      logger.info("Checking open position", { id: position.id, pair: position.pair });
      await processPosition(position);
      logger.info("Finished open position", { id: position.id, pair: position.pair });
    } catch (error) {
      logger.error("Failed to check open position", { id: position.id, pair: position.pair, error });
      await sendMessage(
        `⚠️ *Check Open Trades*\n\nKhông thể kiểm tra vị thế #${position.id} ${position.pair}:\n${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  logger.info("Check open trades complete");
}
