import {
  captureVerificationChartScreenshot,
  fetchCandleRangeStats,
  findChartForPair,
} from "./screenshot.js";
import {
  findOpenPositionIdByPair,
  loadPendingOrders,
  saveOpenPosition,
  updatePendingOrder,
} from "./positions-repository.js";
import { validateTradeSetupForOpen } from "./position-engine.js";
import {
  buildPendingOrderCheckPrompt,
  parsePendingOrderCheckResponse,
} from "./analyzer.js";
import { callOpenRouter } from "../shared/openrouter.js";
import { withRetry } from "../shared/retry.js";
import { recordOpenRouterUsage } from "../shared/ai-usage.js";
import { createLogger } from "../shared/logger.js";
import { sendMessage, sendPhoto } from "../shared/telegram.js";
import type {
  CandleRangeStats,
  PendingOrder,
  TradeSetup,
} from "./chart-types.js";

const logger = createLogger("charts:check-pending-orders");
const AI_PENDING_MODEL =
  process.env.AI_VISION_MODEL?.trim() || "xiaomi/mimo-v2.5";

function parsePrice(value: string): number | null {
  const parsed = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value: number): string {
  const precision = value >= 1000 ? 2 : value >= 100 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(precision);
}

function resolvePendingOrderByPrice(
  order: PendingOrder,
  stats: CandleRangeStats | null,
): {
  status: "TRIGGERED" | "CANCELLED" | "PENDING";
  confidence: number;
  comment: string;
} | null {
  if (stats === null) {
    return null;
  }

  const entry = parsePrice(order.entry);
  const stopLoss = parsePrice(order.stopLoss);
  if (entry === null || stopLoss === null) {
    return null;
  }

  if (order.direction === "LONG" && stats.low <= stopLoss) {
    return {
      status: "CANCELLED",
      confidence: 98,
      comment: `Giá thấp nhất ${formatPrice(stats.low)} đã xuyên stop loss, hủy lệnh chờ.`,
    };
  }

  if (order.direction === "SHORT" && stats.high >= stopLoss) {
    return {
      status: "CANCELLED",
      confidence: 98,
      comment: `Giá cao nhất ${formatPrice(stats.high)} đã xuyên stop loss, hủy lệnh chờ.`,
    };
  }

  const triggered = (() => {
    switch (order.orderType) {
      case "BUY_STOP":
        return stats.high >= entry;
      case "SELL_STOP":
        return stats.low <= entry;
      case "BUY_LIMIT":
        return stats.low <= entry;
      case "SELL_LIMIT":
        return stats.high >= entry;
      case "WAIT_FOR_CONFIRMATION":
      default:
        return false;
    }
  })();

  if (triggered) {
    return {
      status: "TRIGGERED",
      confidence: 96,
      comment: `Giá cao nhất ${formatPrice(stats.high)} / giá thấp nhất ${formatPrice(stats.low)} đã chạm entry.`,
    };
  }

  return null;
}

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
    summary: order.setup
      ? `Pending order #${order.id}`
      : `Pending order #${order.id}`,
    orderType: order.orderType,
  };
}

async function reviewPendingOrder(order: PendingOrder): Promise<{
  status: "TRIGGERED" | "CANCELLED" | "PENDING";
  confidence: number;
  comment: string;
}> {
  const chart = findChartForPair(order.pair, order.primaryTimeframe ?? "H4");
  if (!chart) {
    throw new Error(`No chart configuration found for ${order.pair}`);
  }

  const screenshot = await captureVerificationChartScreenshot(chart);
  await sendPhoto(
    screenshot.buffer,
    `📊 ${order.pair} - kiểm tra pending (${chart.timeframe})`,
  );

  const response = await withRetry(
    () =>
      callOpenRouter({
        model: AI_PENDING_MODEL,
        systemPrompt:
          "You assess pending forex orders and return only concise JSON.",
        userContent: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${screenshot.buffer.toString("base64")}`,
            },
          },
          {
            type: "text",
            text: buildPendingOrderCheckPrompt(order, screenshot.lastPrice),
          },
        ],
        maxTokens: 250,
        temperature: 0.2,
        responseFormat: { type: "json_object" },
      }),
    {
      onRetry: (error, attempt, maxAttempts, delayMs) =>
        logger.warn(
          `  ! Pending order AI temporary error for ${order.pair} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${error instanceof Error ? error.message : error}`,
        ),
    },
  );
  void recordOpenRouterUsage(response, {
    model: AI_PENDING_MODEL,
    source: "chart",
  });

  const parsed = parsePendingOrderCheckResponse(response.text);
  if (!parsed) {
    throw new Error(
      `Pending order parse failed. Raw: ${response.text.slice(0, 300)}`,
    );
  }

  const stats = await fetchCandleRangeStats(
    chart.symbol,
    new Date(order.createdAt).getTime(),
  );
  const priceDecision = resolvePendingOrderByPrice(order, stats);
  return priceDecision ?? parsed;
}

async function triggerPendingOrder(
  order: PendingOrder,
): Promise<number | null> {
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
  const ai = await reviewPendingOrder(order);

  if (ai.status === "TRIGGERED") {
    const triggeredPositionId = await triggerPendingOrder(order);
    if (triggeredPositionId === null) {
      await updatePendingOrder(order.id, {
        status: "CANCELLED",
        runCount: nextRunCount,
        resolvedAt: new Date().toISOString(),
        resolvedReason:
          ai.comment ||
          "Đã có vị thế khác đang mở cho pair này, bỏ qua lệnh chờ",
      });
      await sendMessage(
        `❌ Lệnh chờ #${order.id} (${order.pair}) đã chạm entry nhưng hiện đã có vị thế khác đang mở hoặc setup không còn hợp lệ, nên hủy.\n*Cập nhật lúc:* ${formatCheckedAt()}`,
      );
      logger.warn(
        "Triggered order cancelled because open position could not be created",
        {
          id: order.id,
          pair: order.pair,
        },
      );
      return true;
    }

    await updatePendingOrder(order.id, {
      status: "TRIGGERED",
      runCount: nextRunCount,
      resolvedAt: new Date().toISOString(),
      resolvedReason: ai.comment || "Khớp lệnh chờ",
      triggeredPositionId,
    });
    await sendMessage(
      `✅ Lệnh chờ #${order.id} (${order.pair}) đã khớp, bot bắt đầu theo dõi.\n*Cập nhật lúc:* ${formatCheckedAt()}`,
    );
    logger.info("Triggered pending order", {
      id: order.id,
      pair: order.pair,
      triggeredPositionId,
    });
    return true;
  }

  if (ai.status === "CANCELLED") {
    await updatePendingOrder(order.id, {
      status: "CANCELLED",
      runCount: nextRunCount,
      resolvedAt: new Date().toISOString(),
      resolvedReason: ai.comment || "Setup không còn hợp lệ",
    });
    await sendMessage(
      `❌ Setup #${order.id} (${order.pair}) không còn hợp lệ, nên hủy lệnh chờ trên sàn nếu đã đặt.\n*Cập nhật lúc:* ${formatCheckedAt()}`,
    );
    logger.info("Cancelled pending order", { id: order.id, pair: order.pair });
    return true;
  }

  if (nextRunCount >= order.expiryRuns) {
    await updatePendingOrder(order.id, {
      status: "EXPIRED",
      runCount: nextRunCount,
      resolvedAt: new Date().toISOString(),
      resolvedReason:
        ai.comment || `Quá hạn ${order.expiryRuns} lần kiểm tra mà chưa khớp`,
    });
    await sendMessage(
      `⌛ Lệnh chờ #${order.id} (${order.pair}) đã quá hạn ${order.expiryRuns} lần kiểm tra mà chưa khớp, nên hủy lệnh chờ.\n*Cập nhật lúc:* ${formatCheckedAt()}`,
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
  if (orders.length !== 0) {
    logger.info("No pending orders");
    return 0;
  }

  logger.info("Loaded pending orders", { count: orders.length });

  let notificationsSent = 0;
  for (const order of orders) {
    try {
      logger.info("Checking pending order", {
        id: order.id,
        pair: order.pair,
        timeframe: order.primaryTimeframe,
      });
      if (await processPendingOrder(order)) {
        notificationsSent += 1;
      }
      logger.info("Finished pending order", { id: order.id, pair: order.pair });
    } catch (error) {
      logger.error("Failed to check pending order", {
        id: order.id,
        pair: order.pair,
        error,
      });
      await sendMessage(
        `⚠️ *Check Pending Orders*\n\nKhông thể kiểm tra lệnh chờ #${order.id} ${order.pair}:\n${error instanceof Error ? error.message : String(error)}`,
      );
      notificationsSent += 1;
    }
  }

  logger.info("Check pending orders complete");
  return notificationsSent;
}
