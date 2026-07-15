import { fetchCandleRangeStats, findChartForPair } from "./candle-range-stats.js";
import {
  findOpenPositionIdByPair,
  loadPendingOrders,
  saveOpenPosition,
  updatePendingOrder,
} from "./repository/positions-repository-volman.js";
import { validateTradeSetupForOpen } from "./position-engine-volman.js";
import { createLogger } from "../shared/infra/logger.js";
import { sendMessage } from "../shared/notification/telegram-client.js";
import { getCharts } from "./volman-charts.config.js";
import type { PendingOrder } from "./model/chart-types-common.js";
import type { TradeSetup } from "./model/chart-types-volman.js";
import { resolvePendingOrderDecision } from "./position-decision-volman.js";

const logger = createLogger("charts:check-pending-orders-volman");

function formatCheckedAt(): string {
  return new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function toTradeSetup(order: PendingOrder): TradeSetup {
  return {
    pair: order.pair,
    direction: order.direction,
    setup: order.setup ?? "",
    primaryTimeframe: order.primaryTimeframe ?? "H4",
    reasons: order.reasons ?? [],
    risks: order.risks ?? [],
    confidence: order.confidence ?? 0,
    entry: order.entry,
    stopLoss: order.stopLoss,
    takeProfit1: order.takeProfit1,
    takeProfit2: order.takeProfit2 ?? "",
    riskReward: "0:0",
    summary: order.setup ? `Pending order #${order.id}` : `Pending order #${order.id}`,
    orderType: order.orderType,
  };
}

export async function reviewPendingOrder(order: PendingOrder): Promise<{ status: "TRIGGERED" | "CANCELLED" | "PENDING"; confidence: number; comment: string }> {
  const chart = findChartForPair(await getCharts(), order.pair, order.primaryTimeframe ?? "H4");
  if (!chart) {
    logger.warn("No chart configuration found; sending explicit warning", { pair: order.pair, id: order.id });
    await sendMessage(
      `⚠️ *Check Pending Orders*\n\nKhông tìm thấy cấu hình chart cho lệnh chờ #${order.id} ${order.pair}.\nBot không thể xác minh trigger / invalidation trong lượt này. Vui lòng kiểm tra cấu hình chart / mapping pair.`,
    );
    return resolvePendingOrderDecision(order, null, "missing_chart_config");
  }

  const statsResult = await fetchCandleRangeStats(chart.symbol, new Date(order.createdAt).getTime());
  const stats = statsResult instanceof Error ? null : statsResult;
  if (statsResult instanceof Error) {
    logger.warn("Failed to fetch OHLC for pending order; sending explicit warning", { pair: order.pair, id: order.id, error: statsResult });
    await sendMessage(
      `⚠️ *Check Pending Orders*\n\nKhông lấy được OHLC để kiểm tra lệnh chờ #${order.id} ${order.pair}.\nBot tạm giữ lệnh chờ nhưng không thể xác minh trigger / invalidation trong lượt này. Vui lòng kiểm tra dữ liệu thị trường / nguồn chart.\nLỗi: ${statsResult.message}`,
    );
  }
  return resolvePendingOrderDecision(order, stats);
}

async function triggerPendingOrder(order: PendingOrder): Promise<number | null> {
  const setup = toTradeSetup(order);
  const validation = validateTradeSetupForOpen(setup);
  if (!validation.accepted) {
    return null;
  }

  const saved = await saveOpenPosition(setup);
  if (!saved) {
    return null;
  }

  return findOpenPositionIdByPair(order.pair);
}

async function processPendingOrder(order: PendingOrder): Promise<boolean> {
  const nextRunCount = order.runCount + 1;
  const decision = await reviewPendingOrder(order);

  if (decision.status === "TRIGGERED") {
    const triggeredPositionId = await triggerPendingOrder(order);
    if (triggeredPositionId === null) {
      await updatePendingOrder(order.id, {
        status: "CANCELLED",
        runCount: nextRunCount,
        resolvedAt: new Date().toISOString(),
        resolvedReason: `${decision.comment} Đã có vị thế khác đang mở hoặc setup không còn hợp lệ.`,
      });
      await sendMessage(
        `❌ Lệnh chờ #${order.id} (${order.pair}) đã chạm entry nhưng không thể tạo vị thế mới, nên hủy.\nLý do: ${decision.comment}\n*Cập nhật lúc:* ${formatCheckedAt()}`,
      );
      logger.warn("Triggered order cancelled because open position could not be created", {
        id: order.id,
        pair: order.pair,
      });
      return true;
    }

    await updatePendingOrder(order.id, {
      status: "TRIGGERED",
      runCount: nextRunCount,
      resolvedAt: new Date().toISOString(),
      resolvedReason: `${decision.comment} Khớp lệnh chờ.`,
      triggeredPositionId,
    });
    await sendMessage(
      `✅ Lệnh chờ #${order.id} (${order.pair}) đã khớp.\nLý do: ${decision.comment}\n*Cập nhật lúc:* ${formatCheckedAt()}`,
    );
    logger.info("Triggered pending order", { id: order.id, pair: order.pair, triggeredPositionId });
    return true;
  }

  if (decision.status === "CANCELLED") {
    await updatePendingOrder(order.id, {
      status: "CANCELLED",
      runCount: nextRunCount,
      resolvedAt: new Date().toISOString(),
      resolvedReason: `${decision.comment} Setup không còn hợp lệ.`,
    });
    await sendMessage(
      `❌ Setup #${order.id} (${order.pair}) không còn hợp lệ, nên hủy lệnh chờ trên sàn nếu đã đặt.\nLý do: ${decision.comment}\n*Cập nhật lúc:* ${formatCheckedAt()}`,
    );
    logger.info("Cancelled pending order", { id: order.id, pair: order.pair });
    return true;
  }

  if (nextRunCount >= order.expiryRuns) {
    await updatePendingOrder(order.id, {
      status: "EXPIRED",
      runCount: nextRunCount,
      resolvedAt: new Date().toISOString(),
      resolvedReason: `${decision.comment} Quá hạn ${order.expiryRuns} lần kiểm tra mà chưa khớp.`,
    });
    await sendMessage(
      `⌛ Lệnh chờ #${order.id} (${order.pair}) đã quá hạn ${order.expiryRuns} lần kiểm tra mà chưa khớp, nên hủy lệnh chờ.\nLý do: ${decision.comment}\n*Cập nhật lúc:* ${formatCheckedAt()}`,
    );
    logger.info("Expired pending order", { id: order.id, pair: order.pair });
    return true;
  }

  await updatePendingOrder(order.id, {
    runCount: nextRunCount,
  });
  logger.info("Pending order still waiting", {
    id: order.id,
    pair: order.pair,
    runCount: nextRunCount,
    expiryRuns: order.expiryRuns,
  });
  return false;
}

export async function runCheckPendingOrders(): Promise<number> {
  logger.info("Check pending orders starting");
  const orders = await loadPendingOrders();
  if (orders.length === 0) {
    logger.info("No pending orders");
    return 0;
  }

  logger.info("Loaded pending orders", { count: orders.length });

  let notificationsSent = 0;
  for (const order of orders) {
    try {
      logger.info("Checking pending order", { id: order.id, pair: order.pair, timeframe: order.primaryTimeframe });
      if (await processPendingOrder(order)) {
        notificationsSent += 1;
      }
      logger.info("Finished pending order", { id: order.id, pair: order.pair });
    } catch (error) {
      logger.error("Failed to check pending order", { id: order.id, pair: order.pair, error });
      await sendMessage(
        `⚠️ *Check Pending Orders*\n\nKhông thể kiểm tra lệnh chờ #${order.id} ${order.pair}:\n${error instanceof Error ? error.message : String(error)}`,
      );
      notificationsSent += 1;
    }
  }

  logger.info("Check pending orders complete");
  return notificationsSent;
}
