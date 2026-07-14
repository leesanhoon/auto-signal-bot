import type {
  AnalysisResult,
  TradeSetup,
  PairSummary,
} from "../charts/chart-types-volman.js";
import type { ChartTimeframe } from "../charts/chart-types-common.js";
import type { Notifier } from "./notifier.js";
import { createLogger } from "./logger.js";
import type { PerformanceReport, ClosedPositionSnapshot } from "../charts/performance-tracking-volman.js";
import {
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredTpRMultiple,
} from "../charts/volman-config-env.js";
import { sendMessage, telegramNotifier, notifyError } from "./telegram-client.js";
import {
  renderSetupChartsBatch,
  getPlaywrightDiagnostics,
  type SetupChartInput,
} from "../charts/setup-chart-renderer.js";

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

function formatVietnamDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${getPart("hour")}:${getPart("minute")} ${getPart("day")}/${getPart("month")}`;
}

function formatCandleAge(timeframe: ChartTimeframe | undefined): string | null {
  const closeTimeMs = getCandleCloseTime(timeframe);
  if (!closeTimeMs) return null;

  const nowMs = Date.now();
  const minutesAgo = Math.floor((nowMs - closeTimeMs) / 60000);

  if (minutesAgo < 0) return null;

  const closeTime = new Date(closeTimeMs);
  const vnTimeStr = formatVietnamDateTime(closeTime);

  return `🕐 Nến gốc [${timeframe}] đóng: ${vnTimeStr} giờ VN (${minutesAgo} phút trước)`;
}

function humanizeCandleKey(candleKey: string): string {
  // candleKey format: "<ISO date/hour>:<engineMode>:<timeframeMode>[:<timeframe>]"
  // Chỉ lấy phần ISO date/hour đầu tiên, bỏ các hậu tố kỹ thuật nội bộ.
  const isoPart = candleKey.match(/^\d{4}-\d{2}-\d{2}T\d{2}(:\d{2})?/)?.[0];
  if (!isoPart) return candleKey;

  const isoWithMinutes = isoPart.length === 13 ? `${isoPart}:00` : isoPart;
  const date = new Date(`${isoWithMinutes}:00.000Z`);
  if (Number.isNaN(date.getTime())) return candleKey;

  return formatVietnamDateTime(date);
}

function getPatternInfo(setup: string): string {
  const s = setup.toUpperCase();
  if (s.includes("RB") && !s.includes("ARB") && !s.includes("IRB"))
    return "📦 _Range Break — vùng phạm vi (EMA21 phẳng), nén chặt sát biên rồi phá vỡ_";
  if (s.includes("ARB"))
    return "📦🔄 _Advanced Range Break — phá vỡ mồi để lại khoảng trống, nén lại trong vùng rồi phá vỡ lần nữa_";
  if (s.includes("IRB"))
    return "📦📦 _Inside Range Break — hộp nén giữa vùng phạm vi, phá vỡ hướng về biên vùng_";
  if (s.includes("BB"))
    return "🧱 _Block Break — pullback nằm ngang thành hộp nén trên/dưới EMA21, tôn trọng EMA21 rõ_";
  if (s.includes("FB"))
    return "💥 _First Break — pullback hài hòa đầu tiên của xu hướng mới về EMA21_";
  if (s.includes("SB"))
    return "🔄 _Second Break — phá vỡ đầu thất bại, mô hình W/M quanh EMA21, vào lần phá vỡ thứ hai_";
  if (s.includes("DD"))
    return "🎯 _Double Doji Break — cụm ≥2 nến doji sát EMA21 sau pullback hài hòa_";
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
  const tpRMultiple = getConfiguredTpRMultiple();
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
    `TP        : ${setup.takeProfit1} (${tpRMultiple}R)`,
    `R:R       : ${setup.riskReward}`,
    "```",
  ].join("\n");

  const reasonsBlock = [
    `✅ *Lý do vào lệnh:*`,
    ...setup.reasons.map((r) => `  • ${r}`),
  ].join("\n");

  const risksBlock =
    setup.risks && setup.risks.length > 0
      ? [`⚠️ *Rủi ro cần lưu ý:*`, ...setup.risks.map((r) => `  • ${r}`)].join("\n")
      : "";

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
  },
  decision: {
    decision: "HOLD" | "CLOSE" | "STOP";
    confidence: number;
    comment: string;
    managementAction?: "NONE" | "TAKE_PROFIT_CLOSE";
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
    decision.managementAction === "TAKE_PROFIT_CLOSE"
      ? "🟢 Take profit đã đạt, đóng toàn bộ vị thế."
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
    `TP: ${position.takeProfit1}`,
    position.tradeStage ? `*Trạng thái:* ${position.tradeStage}` : "",
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
    : snapshot.closeReason === "take_profit"
      ? "Chạm Take Profit"
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

export function buildBreakevenReminderMessage(
  position: {
    id: number;
    pair: string;
    direction: "LONG" | "SHORT";
    setup: string | null;
    entry: string;
  },
  comment: string,
): string {
  const lines = [
    `🎯 *Vị thế #${position.id} đạt 1R* — ${position.pair} ${position.direction}`,
    position.setup ? `📋 ${position.setup}` : "",
    comment,
    `👉 Dời Stop Loss về entry (${position.entry}) trên sàn để bảo toàn hoà vốn.`,
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
      ? `📦 Dữ liệu phân tích lấy từ cache của nến đóng lúc *${humanizeCandleKey(deliveryContext.candleKey)} giờ VN*`
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
    if (!setup.chartContext) {
      logger.warn(`Bỏ qua chart cho ${setup.pair} — thiếu chartContext (OHLC candles/ma21 không đủ dữ liệu khi build setup)`);
      continue;
    }
    const entry = Number(setup.entry);
    const stopLoss = Number(setup.stopLoss);
    const takeProfit = Number(setup.takeProfit1);
    if (![entry, stopLoss, takeProfit].every(Number.isFinite)) {
      logger.warn(`Bỏ qua chart cho ${setup.pair} — entry/stopLoss/takeProfit không hợp lệ (entry=${setup.entry}, stopLoss=${setup.stopLoss}, takeProfit1=${setup.takeProfit1})`);
      continue;
    }
    chartInputs.push({
      setup,
      input: {
        pair: setup.pair,
        setup: setup.setup,
        direction: setup.direction,
        entry,
        stopLoss,
        takeProfit,
        livePrice: setup.lastPrice ?? null,
        chartContext: setup.chartContext,
      },
    });
  }

  let chartBuffers: (Buffer | null)[] = [];
  try {
    chartBuffers = await renderSetupChartsBatch(chartInputs.map((c) => c.input));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const diagnostics = getPlaywrightDiagnostics();
    logger.warn("Render chart batch failed, fallback to text-only", {
      error: errorMessage,
      diagnostics,
    });
    await notifyError("Render chart batch (Volman)", `${errorMessage}\n\n${diagnostics}`);
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
