import type {
  AnalysisResult,
  TradeSetup,
  PairSummary,
} from "../charts/chart-types-volman.js";
import type { ChartTimeframe } from "../charts/chart-types-common.js";
import type { Notifier } from "./notifier.js";
import { createLogger } from "./logger.js";
import type { PerformanceReport, ClosedPositionSnapshot } from "../charts/performance-tracking-volman.js";
import { getConfiguredChartSignalConfidenceThreshold } from "../charts/volman-config-env.js";
import { sendMessage, telegramNotifier } from "./telegram-client.js";
import { renderSetupChartsBatch, type SetupChartInput } from "../charts/setup-chart-renderer.js";

const logger = createLogger("shared:telegram-volman");

const TIMEFRAME_MS: Record<ChartTimeframe, number> = {
  M15: 15 * 60 * 1000,
  M30: 30 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
};

function getCandleCloseTime(
  timeframe: ChartTimeframe | undefined,
): number | null {
  if (!timeframe || !(timeframe in TIMEFRAME_MS)) return null;

  const intervalMs = TIMEFRAME_MS[timeframe];
  const nowMs = Date.now();
  return Math.floor(nowMs / intervalMs) * intervalMs;
}

function formatCandleAge(timeframe: ChartTimeframe | undefined): string | null {
  const closeTimeMs = getCandleCloseTime(timeframe);
  if (!closeTimeMs) return null;

  const nowMs = Date.now();
  const minutesAgo = Math.floor((nowMs - closeTimeMs) / 60000);

  if (minutesAgo < 0) return null;

  const closeTime = new Date(closeTimeMs);
  const hh = String(closeTime.getUTCHours()).padStart(2, "0");
  const mm = String(closeTime.getUTCMinutes()).padStart(2, "0");
  const dd = String(closeTime.getUTCDate()).padStart(2, "0");
  const MM = String(closeTime.getUTCMonth() + 1).padStart(2, "0");

  return `🕐 Nến gốc [${timeframe}] đóng: ${hh}:${mm} ${dd}/${MM} UTC (${minutesAgo} phút trước)`;
}

function getPatternInfo(setup: string): string {
  const s = setup.toUpperCase();
  if (s.includes("RB") && !s.includes("ARB") && !s.includes("IRB"))
    return "📦 _Range Break — vùng tích lũy phá theo EMA20_";
  if (s.includes("ARB"))
    return "📦🔄 _Advanced RB — nhiều false break trước khi break thật_";
  if (s.includes("IRB"))
    return "📦📦 _Inside RB — range nhỏ phá luôn range lớn_";
  if (s.includes("BB"))
    return "🧱 _Block Break — block sát EMA20, theo trend_";
  if (s.includes("FB"))
    return "💥 _First Break — breakout đầu tiên, nến thân dài_";
  if (s.includes("SB"))
    return "🔄 _Second Break — false break rồi break thật_";
  if (s.includes("DD"))
    return "🎯 _Double Doji — doji sát EMA20, theo trend_";
  return "";
}

function getOrderTypeLabel(orderType?: string): string {
  switch (orderType) {
    case "MARKET_NOW":
      return "Market — chỉ vào nếu giá hiện tại còn quanh vùng entry";
    case "BUY_STOP":
      return "Buy Stop — lệnh chờ breakout lên vùng entry";
    case "SELL_STOP":
      return "Sell Stop — lệnh chờ breakdown xuống vùng entry";
    case "BUY_LIMIT":
      return "Buy Limit — lệnh chờ giá hồi về vùng entry";
    case "SELL_LIMIT":
      return "Sell Limit — lệnh chờ giá hồi lên vùng entry";
    case "WAIT_FOR_CONFIRMATION":
      return "Chờ xác nhận — chưa đặt lệnh ngay";
    default:
      return "Lệnh chờ xác nhận vùng entry";
  }
}

function formatLastPrice(value: number): string {
  const precision = value >= 1000 ? 2 : value >= 100 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(precision);
}

function buildCopyableSetup(setup: TradeSetup): string {
  const threshold = getConfiguredChartSignalConfidenceThreshold();
  const arrow = setup.direction === "LONG" ? "🟢" : "🔴";
  const confidence = setup.confidence ?? 0;
  const confBar =
    confidence >= 80 ? "🟢🟢🟢" : confidence >= threshold ? "🟡🟡" : "🔴";
  const emaTag = setup.emaTouch ? " 📍EMA" : "";
  const patternInfo = getPatternInfo(setup.setup);
  const candleAge = formatCandleAge(setup.primaryTimeframe);

  // Build orderLine: merge orderType and entryCondition
  let orderLine = "";
  if (setup.orderType) {
    const orderTypeLabel = getOrderTypeLabel(setup.orderType);
    if (setup.entryCondition) {
      orderLine = `🧭 *Lệnh:* ${orderTypeLabel} — ${setup.entryCondition}`;
    } else {
      orderLine = `🧭 *Lệnh:* ${orderTypeLabel}`;
    }
  }

  // Build priceLine: merge lastPrice and currentPriceContext
  let priceLine = "";
  const hasLastPrice =
    setup.lastPrice !== undefined && setup.lastPrice !== null;
  const hasPriceContext = setup.currentPriceContext;
  if (hasLastPrice && hasPriceContext) {
    priceLine = `📍 *Giá:* ${formatLastPrice(setup.lastPrice as number)} (${setup.currentPriceContext})`;
  } else if (hasLastPrice) {
    priceLine = `📍 *Giá:* ${formatLastPrice(setup.lastPrice as number)}`;
  } else if (hasPriceContext) {
    priceLine = `📍 *Giá:* ${setup.currentPriceContext}`;
  }

  // Build trailing status line based on autoTracked
  const statusLine =
    setup.autoTracked === true
      ? "✅ Đã lưu & theo dõi tự động."
      : "ℹ️ Lệnh chờ — chỉ vào khi khớp điều kiện.";

  const headerBlock = [
    `${arrow} *${setup.pair} — ${setup.direction}* (${confidence}% ${confBar})${emaTag}`,
    `📋 *${setup.setup}*`,
    patternInfo,
    orderLine,
    priceLine,
    candleAge ?? "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const codeBlock = [
    "```",
    `Direction : ${setup.direction}`,
    `Entry     : ${setup.entry} (${setup.orderType === "MARKET_NOW" ? "market nếu còn đúng vùng" : "trigger/pending"})`,
    `Stop Loss : ${setup.stopLoss}`,
    `TP1       : ${setup.takeProfit1}`,
    `TP2       : ${setup.takeProfit2}`,
    `R:R       : ${setup.riskReward}`,
    "```",
  ].join("\n");

  const reasonsBlock = [
    `✅ *Lý do vào lệnh:*`,
    ...setup.reasons.map((r) => `  • ${r}`),
  ].join("\n");

  const risksBlock = [
    `⚠️ *Rủi ro cần lưu ý:*`,
    ...(setup.risks || []).map((r) => `  • ${r}`),
  ].join("\n");

  const summaryBlock = `💡 ${setup.summary}`;

  return [headerBlock, codeBlock, reasonsBlock, risksBlock, summaryBlock, statusLine]
    .filter((block) => block !== "")
    .join("\n\n");
}

function buildSummaryTable(summaries: PairSummary[]): string {
  const threshold = getConfiguredChartSignalConfidenceThreshold();
  const filteredSummaries = summaries.filter((s) => s.confidence >= threshold);
  const lines: string[] = ["📊 *TỔNG QUAN TẤT CẢ CẶP TIỀN*", ""];

  for (const s of filteredSummaries) {
    lines.push(`🟢 *${s.pair}* — ${s.confidence}%`);
    lines.push(`   ${s.trend}`);
    lines.push(`   ${s.status}`);
    lines.push("");
  }

  const tradeCount = filteredSummaries.length;
  if (tradeCount > 0) {
    lines.push(`✅ *${tradeCount}* cặp có setup đạt yêu cầu (≥${threshold}%)`);
  } else {
    lines.push(`⏸ Không có cặp nào đạt yêu cầu (≥${threshold}%)`);
  }

  return lines.join("\n");
}

export function buildHeartbeatMessage(options: {
  runContext: "manual" | "auto";
  engineMode: string;
  reason: "no-cache" | "no-event";
  candleKey: string;
  latestCacheCandleKey?: string | null;
}): string {
  const runLabel = options.runContext === "manual" ? "Manual run" : "Auto run";
  const reasonLine =
    options.reason === "no-cache"
      ? "Không có cache phân tích hợp lệ để dùng lại trong lượt chạy ngoài cửa sổ đóng nến."
      : "Không có event trade/pending nào phát sinh trong lượt chạy này.";

  const lines = [
    "🫀 *Bob Volman Algorithm Scanner heartbeat*",
    `*Run:* ${runLabel}`,
    `*Engine:* ${options.engineMode}`,
    `*Last closed candle:* ${options.candleKey}`,
    `*Reason:* ${options.reason}`,
  ];

  if (options.latestCacheCandleKey) {
    lines.push(`*Latest cache:* ${options.latestCacheCandleKey}`);
  }

  lines.push("", reasonLine, "Scanner vẫn đang hoạt động bình thường.");
  return lines.join("\n");
}

export function buildPositionDecisionMessage(
  position: {
    id: number;
    pair: string;
    direction: "LONG" | "SHORT";
    setup: string | null;
    entry: string;
    stopLoss: string;
    takeProfit1: string;
    takeProfit2: string | null;
    reasons: string[] | null;
    openedAt?: string | null;
    lastDecision?: string | null;
    lastDecisionConfidence?: number | null;
    lastDecisionComment?: string | null;
    tradeStage?: string | null;
    tp1ClosedPercent?: number | null;
    trailingStopLoss?: string | null;
  },
  decision: {
    decision: "HOLD" | "CLOSE" | "STOP";
    confidence: number;
    comment: string;
    managementAction?:
      | "NONE"
      | "PARTIAL_TP1"
      | "MOVE_SL_TO_BE"
      | "TRAIL_SL"
      | "TP2_CLOSE";
    partialClosePercent?: number;
    newStopLoss?: string | null;
    tp1Reached?: boolean;
    tp2Reached?: boolean;
  },
): string {
  const emoji =
    decision.decision === "HOLD"
      ? "🟢"
      : decision.decision === "CLOSE"
        ? "🟡"
        : "🔴";
  const actionLine =
    decision.decision === "HOLD"
      ? "🟢 Tiếp tục giữ lệnh."
      : "🔴 Bot đã tự động đóng vị thế trong hệ thống theo dõi.";
  const managementLine =
    decision.managementAction === "PARTIAL_TP1"
      ? `🟡 Partial TP1: đóng ${decision.partialClosePercent ?? 50}% và dời SL${decision.newStopLoss ? ` về ${decision.newStopLoss}` : " về breakeven"}.`
      : decision.managementAction === "MOVE_SL_TO_BE"
        ? `🟡 SL đã được dời về breakeven${decision.newStopLoss ? ` (${decision.newStopLoss})` : ""}.`
        : decision.managementAction === "TRAIL_SL"
          ? `🟡 SL trailing đã được cập nhật${decision.newStopLoss ? `: ${decision.newStopLoss}` : ""}.`
          : decision.managementAction === "TP2_CLOSE"
            ? "🟢 TP2 đã đạt, đóng toàn bộ vị thế."
            : "";
  const lines = [
    `${emoji} *Vị thế #${position.id}* — ${position.pair} ${position.direction}`,
    position.setup ? `📋 *${position.setup}*` : "",
    "",
    `*Quyết định:* ${decision.decision} (${decision.confidence}%)`,
    actionLine,
    managementLine,
    position.openedAt ? `*Đã mở:* ${position.openedAt}` : "",
    `Entry: ${position.entry}`,
    `SL: ${position.stopLoss}`,
    `TP1: ${position.takeProfit1}`,
    position.takeProfit2 ? `TP2: ${position.takeProfit2}` : "",
    position.tradeStage ? `*Trạng thái:* ${position.tradeStage}` : "",
    position.tp1ClosedPercent !== undefined &&
    position.tp1ClosedPercent !== null
      ? `*TP1 đã đóng:* ${position.tp1ClosedPercent}%`
      : "",
    position.trailingStopLoss
      ? `*Trailing SL:* ${position.trailingStopLoss}`
      : "",
    "",
    `*Nhận định:* ${decision.comment || "Không có nhận xét chi tiết."}`,
  ].filter(Boolean);

  if (position.reasons && position.reasons.length > 0) {
    lines.push(
      "",
      "*Lý do gốc khi mở lệnh:*",
      ...position.reasons.slice(0, 2).map((reason) => `• ${reason}`),
    );
  }

  return lines.join("\n");
}

export function buildPositionClosedMessage(
  position: {
    id: number;
    pair: string;
    direction: "LONG" | "SHORT";
    setup: string | null;
    entry: string;
    openedAt?: string | null;
  },
  snapshot: ClosedPositionSnapshot,
  options: { isFailSafeClose?: boolean } = {},
): string {
  const outcomeEmoji =
    snapshot.outcome === "win" ? "🟢" : snapshot.outcome === "loss" ? "🔴" : "⚪";
  const outcomeLabel =
    snapshot.outcome === "win" ? "THẮNG" : snapshot.outcome === "loss" ? "THUA" : "HOÀ VỐN";
  const closeReasonLabel = options.isFailSafeClose
    ? "Đóng khẩn cấp do lỗi thực thi trên sàn (fail-safe)"
    : snapshot.closeReason === "take_profit_2"
      ? "Chạm TP2"
      : snapshot.closeReason === "manual_close"
        ? "Đóng thủ công (tín hiệu đảo chiều)"
        : "Chạm Stop Loss";

  const lines = [
    `🏁 *Vị thế #${position.id} đã đóng* — ${position.pair} ${position.direction}`,
    position.setup ? `📋 ${position.setup}` : "",
    `${outcomeEmoji} *${outcomeLabel}* — ${snapshot.realizedRiskRewardRatio}R`,
    `Lý do: ${closeReasonLabel}`,
    `Entry: ${position.entry} → Exit: ${snapshot.realizedExitPrice ?? "-"}`,
    position.openedAt ? `Đã mở: ${position.openedAt}` : "",
  ];

  return lines.filter((line) => line !== "").join("\n");
}

export function buildPerformanceReportMessage(
  report: PerformanceReport,
): string {
  const lines: string[] = [
    `📈 *Báo cáo hiệu suất ${report.periodLabel}*`,
    `*Kỳ:* ${report.startAt} → ${report.endAt}`,
    "",
    "*Tổng quan danh mục*",
    `Lệnh đóng: ${report.portfolio.trades}`,
    `Win-rate: ${report.portfolio.winRate}% (${report.portfolio.wins}W/${report.portfolio.losses}L/${report.portfolio.breakevens}BE)`,
    `Tổng R thực tế: ${report.portfolio.totalRealizedRiskReward.toFixed(2)}R`,
    `R trung bình: ${report.portfolio.averageRealizedRiskReward.toFixed(2)}R/lệnh`,
    `Max drawdown: ${report.portfolio.maxDrawdown.toFixed(2)}R`,
  ];

  if (report.byPair.length > 0) {
    lines.push("", "*Theo cặp tiền*");
    for (const pair of report.byPair) {
      lines.push(
        `${pair.label}: ${pair.trades} lệnh | WR ${pair.winRate}% | Tổng ${pair.totalRealizedRiskReward.toFixed(2)}R | Avg ${pair.averageRealizedRiskReward.toFixed(2)}R | DD ${pair.maxDrawdown.toFixed(2)}R`,
      );
    }
  } else {
    lines.push("", "_Không có lệnh đóng trong kỳ báo cáo này._");
  }

  return lines.join("\n");
}

export async function sendAllAnalysesVolman(
  result: AnalysisResult,
  notifier: Notifier = telegramNotifier,
  deliveryContext: { source?: "live" | "cached"; candleKey?: string; timeframe?: ChartTimeframe } = {},
): Promise<void> {
  const timestamp = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const threshold = getConfiguredChartSignalConfidenceThreshold();
  const summaries = result.summaries.filter(
    (summary) => summary.confidence >= threshold,
  );
  const setups = result.setups.filter(
    (setup) => (setup.confidence ?? 0) >= threshold,
  );
  const isCached = deliveryContext.source === "cached";
  const sourceLabel = isCached ? " từ cache" : " từ thuật toán";
  const cacheLine = isCached
    ? deliveryContext.candleKey
      ? `📦 Dữ liệu phân tích lấy từ cache của *last closed candle ${deliveryContext.candleKey}*`
      : "📦 Dữ liệu phân tích lấy từ cache"
    : "";
  const setupHeaderSuffix = isCached ? " từ cache" : " từ thuật toán";
  const footerLabel = isCached ? "từ cache" : "từ thuật toán";

  const attemptedCount =
    result.analysisStats?.attemptedPairs ?? result.summaries.length;
  const scannerLabel = "Bob Volman Multi-Timeframe Scanner";
  // Fall back to a setup's own primaryTimeframe when the caller didn't pass one explicitly
  // (e.g. existing callers/tests that only set source/candleKey).
  const timeframe = deliveryContext.timeframe ?? result.setups[0]?.primaryTimeframe;
  const timeframeTag = timeframe ? ` [${timeframe}]` : "";

  if (setups.length === 0) {
    await notifier.sendMessage(
      [
        `⏸ *${scannerLabel}${timeframeTag}* — không có setup đạt ngưỡng (≥${threshold}%)${isCached ? " (cache)" : ""}`,
        `📅 ${timestamp} | Quét ${attemptedCount} cặp, ${summaries.length}/${result.summaries.length} đạt ngưỡng summary`,
      ].join("\n"),
    );
    logger.info(
      `  → No setups above threshold (${threshold}%). Notification sent with ${summaries.length} eligible summaries (${footerLabel}).`,
    );
    return;
  }

  await notifier.sendMessage(
    [
      `🚀 *${scannerLabel}${timeframeTag}${sourceLabel}*`,
      `📅 ${timestamp}`,
      cacheLine,
      `📊 Quét *${result.summaries.length}* cặp → *${summaries.length}* đạt ngưỡng (≥${threshold}%) → *${setups.length}* setup${setupHeaderSuffix}`,
      `_(luôn theo last closed candle)_`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );

  // Build batch input for chart rendering
  const chartInputs: Array<{ setup: TradeSetup; input: SetupChartInput }> = [];
  for (const setup of setups) {
    if (!setup.chartContext) continue;
    const entry = Number(setup.entry);
    const stopLoss = Number(setup.stopLoss);
    const takeProfit1 = Number(setup.takeProfit1);
    const takeProfit2 = Number(setup.takeProfit2);
    if (![entry, stopLoss, takeProfit1, takeProfit2].every(Number.isFinite)) continue;
    chartInputs.push({
      setup,
      input: {
        pair: setup.pair,
        setup: setup.setup,
        direction: setup.direction,
        entry,
        stopLoss,
        takeProfit1,
        takeProfit2,
        chartContext: setup.chartContext,
      },
    });
  }

  let chartBuffers: (Buffer | null)[] = [];
  try {
    chartBuffers = await renderSetupChartsBatch(chartInputs.map((c) => c.input));
  } catch (err) {
    logger.warn("Render chart batch failed, fallback to text-only", {
      error: err instanceof Error ? err.message : String(err),
    });
    chartBuffers = [];
  }

  const chartBufferByPair = new Map<string, Buffer>();
  chartInputs.forEach(({ setup }, i) => {
    const buf = chartBuffers[i];
    if (buf) chartBufferByPair.set(setup.pair, buf);
  });

  for (const setup of setups) {
    const chartBuffer = chartBufferByPair.get(setup.pair);
    if (chartBuffer) {
      try {
        const shortCaption = `${setup.pair} ${setup.direction} — ${setup.setup} (${setup.confidence}%)`;
        await notifier.sendPhoto(chartBuffer, shortCaption);
      } catch (err) {
        logger.warn(`Gửi chart ảnh cho ${setup.pair} thất bại, tiếp tục gửi text`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await notifier.sendMessage(buildCopyableSetup(setup));
    logger.info(`  ✓ Sent setup: ${setup.pair} ${setup.direction}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await notifier.sendMessage(
    `✅ Xong — ${setups.length} setup đã gửi (${summaries.length} cặp đạt ngưỡng).`,
  );
}
