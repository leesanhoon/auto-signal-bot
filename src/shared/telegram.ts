import { basename } from "path";
import type {
  AnalysisResult,
  TradeSetup,
  PairSummary,
  ScreenshotResult,
  ChartAnalysisSource,
  ChartTimeframe,
} from "../charts/chart-types.js";
import type { Notifier } from "./notifier.js";
import { createLogger } from "./logger.js";
import type { PerformanceReport } from "../charts/performance-tracking.js";
import { getConfiguredChartSignalConfidenceThreshold } from "../charts/chart-config-env.js";

const logger = createLogger("shared:telegram");
export type InlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type TelegramCommand = {
  command: string;
  description: string;
};

export type ChartAnalysisDeliveryContext = {
  source?: "live" | "cached";
  candleKey?: string;
};

function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables are required",
    );
  }
  return { token, chatId, api: `https://api.telegram.org/bot${token}` };
}

function escapeMarkdownV1(text: string): string {
  return text.replace(/([\\_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

function buildNoSetupReasonSection(result: AnalysisResult): string {
  if (!result.noSetupReason.trim()) return "";

  const lines = result.noSetupReason
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 8)
    .map((line) => `• ${escapeMarkdownV1(line)}`);

  if (lines.length === 0) return "";

  return [`📋 *Lý do scan:*`, ...lines].join("\n");
}

async function postTelegramApi(
  path: string,
  payload: Record<string, unknown>,
  errorPrefix: string,
): Promise<void> {
  const { api } = getTelegramConfig();
  const response = await fetch(`${api}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${errorPrefix} failed: ${body}`);
  }
}

export async function sendPhoto(
  photoBuffer: Buffer,
  caption: string,
): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append(
    "photo",
    new Blob([new Uint8Array(photoBuffer)], { type: "image/png" }),
    "chart.png",
  );
  formData.append("caption", caption.slice(0, 1024));

  const response = await fetch(`${api}/sendPhoto`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram sendPhoto failed: ${error}`);
  }
}

export async function sendDocument(
  fileBuffer: Buffer,
  filename: string,
  caption: string,
): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append(
    "document",
    new Blob([new Uint8Array(fileBuffer)], { type: "application/json" }),
    filename,
  );
  formData.append("caption", caption.slice(0, 1024));

  const response = await fetch(`${api}/sendDocument`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram sendDocument failed: ${error}`);
  }
}

export async function setMyCommands(
  commands: TelegramCommand[],
): Promise<void> {
  await postTelegramApi(
    "setMyCommands",
    { commands },
    "Telegram setMyCommands",
  );
}

export async function setChatMenuButton(): Promise<void> {
  await postTelegramApi(
    "setChatMenuButton",
    { menu_button: { type: "commands" } },
    "Telegram setChatMenuButton",
  );
}

export async function notifyError(
  scope: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await sendMessage(
      `🔴 *Lỗi: ${scope}*\n\n\`\`\`\n${message.slice(0, 3500)}\n\`\`\``,
    );
  } catch (notifyErr) {
    logger.error("Failed to send error notification to Telegram:", notifyErr);
  }
}

export async function sendMessage(
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const response = await fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (body.includes("can't parse entities")) {
      const retry = await fetch(`${api}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
      if (!retry.ok) {
        const retryErr = await retry.text();
        throw new Error(`Telegram sendMessage failed: ${retryErr}`);
      }
      return;
    }
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
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

async function editMessageReplyMarkup(
  replyMarkup: InlineKeyboardMarkup | undefined,
  messageId: number,
): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const response = await fetch(`${api}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram editMessageReplyMarkup failed: ${body}`);
  }
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

function getPatternInfo(setup: string): string {
  const s = setup.toUpperCase();
  if (s.includes("RB") && !s.includes("ARB") && !s.includes("IRB"))
    return "📦 _Range Break — Phá vỡ vùng tích lũy đi ngang, EMA 20 phẳng rồi dốc theo hướng break_";
  if (s.includes("ARB"))
    return "📦🔄 _Advanced Range Break — Range lớn, nhiều lần test biên + false break trước khi break thật_";
  if (s.includes("IRB"))
    return "📦📦 _Inside Range Break — Range nhỏ trong range lớn, breakout kéo phá luôn range lớn_";
  if (s.includes("BB"))
    return "🧱 _Block Break — Block nhỏ chặt sát EMA 20, break theo hướng trend chính_";
  if (s.includes("FB"))
    return "💥 _First Break — Breakout lần đầu từ range lớn, nến break thân dài_";
  if (s.includes("SB"))
    return "🔄 _Second Break — False break lần 1 → buildup → break lần 2 hướng thật_";
  if (s.includes("DD"))
    return "🎯 _Double Doji — 2-3 doji sát EMA 20 trong trend rõ, break theo trend_";
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
  const fallbackNote = setup.chartFallbackUsed
    ? `⚠️ Ảnh minh họa không đúng khung thời gian gốc (${normalizeSetupTimeframe(setup)}), chỉ tham khảo.`
    : "";
  return [
    `${arrow} *${setup.pair} — ${setup.direction}* (${confidence}% ${confBar})${emaTag}`,
    `📋 *${setup.setup}*`,
    patternInfo,
    setup.orderType ? `🧭 *Loại lệnh:* ${getOrderTypeLabel(setup.orderType)}` : "",
    setup.entryCondition ? `⏳ *Điều kiện vào:* ${setup.entryCondition}` : "",
    setup.lastPrice !== undefined && setup.lastPrice !== null
      ? `📍 *Giá thật:* ${formatLastPrice(setup.lastPrice)}`
      : "",
    setup.currentPriceContext ? `📍 *Giá hiện tại:* ${setup.currentPriceContext}` : "",
    fallbackNote,
    "",
    "```",
    `Direction : ${setup.direction}`,
    `Entry     : ${setup.entry} (${setup.orderType === "MARKET_NOW" ? "market nếu còn đúng vùng" : "trigger/pending"})`,
    `Stop Loss : ${setup.stopLoss}`,
    `TP1       : ${setup.takeProfit1}`,
    `TP2       : ${setup.takeProfit2}`,
    `R:R       : ${setup.riskReward}`,
    "```",
    "",
    `✅ *Lý do vào lệnh:*`,
    ...setup.reasons.map((r) => `  • ${r}`),
    "",
    `⚠️ *Rủi ro cần lưu ý:*`,
    ...(setup.risks || []).map((r) => `  • ${r}`),
    "",
    `💡 ${setup.summary}`,
    "",
    setup.autoTracked === true
      ? "✅ Bot đã tự động lưu vị thế và sẽ tiếp tục theo dõi để báo khi cần đóng."
      : "ℹ️ Nếu đây là lệnh chờ, chỉ vào khi giá khớp đúng điều kiện trên.",
  ].join("\n");
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

function normalizeChartKey(value: string): string {
  return value.replace(/[\s\/_.:-]+/g, "").toUpperCase();
}

function normalizeSetupTimeframe(setup: TradeSetup): ChartTimeframe {
  const raw = setup.primaryTimeframe?.trim().toUpperCase();
  return raw === "D1" || raw === "H4" || raw === "M15" ? raw : "H4";
}

export function findScreenshotForSetup(
  setup: TradeSetup,
  screenshots: ScreenshotResult[],
): { screenshot?: ScreenshotResult; usedFallback: boolean } {
  const preferredTimeframe = normalizeSetupTimeframe(setup);
  const preferredTargets: Array<Pick<ChartAnalysisSource, "filepath" | "symbol" | "timeframe">> = [];
  const fallbackTargets: Array<Pick<ChartAnalysisSource, "filepath" | "symbol" | "timeframe">> = [];

  for (const chart of setup.sourceCharts ?? []) {
    if (chart.timeframe === preferredTimeframe) preferredTargets.push(chart);
    else fallbackTargets.push(chart);
  }

  if (setup.telegramChart) {
    if (setup.telegramChart.timeframe === preferredTimeframe) preferredTargets.push(setup.telegramChart);
    else fallbackTargets.push(setup.telegramChart);
  }

  const findExact = (
    targets: Array<Pick<ChartAnalysisSource, "filepath" | "symbol" | "timeframe">>,
  ): ScreenshotResult | undefined => {
    for (const target of targets) {
      const exactTriple = screenshots.find(
        (s) =>
          s.filepath === target.filepath &&
          s.chart.symbol === target.symbol &&
          s.chart.timeframe === target.timeframe,
      );
      if (exactTriple) return exactTriple;
    }

    for (const target of targets) {
      const exactSymbolTimeframe = screenshots.find(
        (s) => s.chart.symbol === target.symbol && s.chart.timeframe === target.timeframe,
      );
      if (exactSymbolTimeframe) return exactSymbolTimeframe;
    }

    for (const target of targets) {
      if (!target.filepath) continue;
      const exactFilepath = screenshots.find((s) => s.filepath === target.filepath);
      if (exactFilepath) return exactFilepath;
    }

    return undefined;
  };

  const preferredMatch = findExact(preferredTargets);
  if (preferredMatch) return { screenshot: preferredMatch, usedFallback: false };

  const fallbackMatch = findExact(fallbackTargets);
  if (fallbackMatch) return { screenshot: fallbackMatch, usedFallback: true };

  const normalizedPair = normalizeChartKey(setup.pair);
  const byPreferredTimeframe = screenshots.find(
    (s) =>
      normalizeChartKey(s.chart.symbol).includes(normalizedPair) &&
      s.chart.timeframe === preferredTimeframe,
  );
  if (byPreferredTimeframe) return { screenshot: byPreferredTimeframe, usedFallback: true };

  return {
    screenshot: screenshots.find((s) => normalizeChartKey(s.chart.symbol).includes(normalizedPair)),
    usedFallback: true,
  };
}

export const telegramNotifier: Notifier = { sendMessage, sendPhoto };

export async function sendAllAnalyses(
  result: AnalysisResult,
  notifier: Notifier = telegramNotifier,
  deliveryContext: ChartAnalysisDeliveryContext = {},
): Promise<void> {
  const timestamp = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const threshold = getConfiguredChartSignalConfidenceThreshold();
  const summaries = result.summaries.filter((summary) => summary.confidence >= threshold);
  const setups = result.setups.filter((setup) => (setup.confidence ?? 0) >= threshold);
  const isCached = deliveryContext.source === "cached";
  const sourceLabel = isCached ? " từ cache" : " từ thuật toán";
  const cacheLine = isCached
    ? deliveryContext.candleKey
      ? `📦 Dữ liệu phân tích lấy từ cache của *last closed candle ${deliveryContext.candleKey}*`
      : "📦 Dữ liệu phân tích lấy từ cache"
    : "";
  const setupHeaderSuffix = isCached ? " từ cache" : " từ thuật toán";
  const footerLabel = isCached ? "từ cache" : "từ thuật toán";

  const attemptedCount = result.analysisStats?.attemptedPairs ?? result.summaries.length;
  const statsLine = result.analysisStats
    ? `📊 Attempted: ${result.analysisStats.attemptedPairs} | Summaries: ${result.summaries.length} | Skipped: ${result.analysisStats.skippedPairs} | Setups: ${result.analysisStats.setupCount}`
    : "";
  const noSetupReasonSection = buildNoSetupReasonSection(result);

  if (setups.length === 0) {
    await notifier.sendMessage(
      [
        `🚀 *Bob Volman Multi-Timeframe Scanner${sourceLabel}*`,
        `📅 ${timestamp}`,
        cacheLine,
        `📊 Đã quét/thử *${attemptedCount}* cặp (D1/H4/M15 + volume)`,
        `📊 Có summary cho *${result.summaries.length}* cặp; lọc còn *${summaries.length}* cặp đạt ngưỡng (≥${threshold}%)`,
        "",
        `⏸ Không có setup đạt ngưỡng${isCached ? " trong cache" : " từ thuật toán"}`,
        statsLine,
        noSetupReasonSection,
        "",
        `_"Scanner luôn phân tích theo last closed candle, không dùng nến đang chạy."_`,
      ].filter(Boolean).join("\n"),
    );
    logger.info(
      `  → No setups above threshold (${threshold}%). Notification sent with ${summaries.length} eligible summaries (${footerLabel}).`,
    );
    return;
  }

  await notifier.sendMessage(
    `🚀 *Bob Volman Multi-Timeframe Scanner${sourceLabel}*\n📅 ${timestamp}\n${cacheLine ? `${cacheLine}\n` : ""}📊 Đã quét *${result.summaries.length}* cặp (D1/H4/M15 + volume)\n📊 Lọc còn *${summaries.length}* cặp đạt ngưỡng (≥${threshold}%) — tìm thấy *${setups.length}* setup${setupHeaderSuffix}\n\n_"Scanner luôn phân tích theo last closed candle, không dùng nến đang chạy."_`,
  );

  for (const setup of setups) {
    const confidence = setup.confidence ?? 0;
    const { screenshot, usedFallback } = findScreenshotForSetup(setup, result.screenshots);

    if (screenshot) {
      try {
        const caption = `📊 ${screenshot.chart.symbol} ${screenshot.chart.timeframe} — ${setup.direction} (${confidence}% 🔥)\nNguồn ảnh: ${basename(screenshot.filepath)}`;
        setup.chartFallbackUsed = usedFallback;
        await notifier.sendPhoto(screenshot.buffer, caption);
        if (usedFallback) {
          logger.warn(`  ! Sent chart for ${setup.pair} using fallback screenshot ${screenshot.chart.symbol} ${screenshot.chart.timeframe}`);
        } else {
          logger.info(`  ✓ Sent chart: ${setup.pair} (confidence ${confidence}%)`);
        }
      } catch (error) {
        logger.error(`  ✗ Failed to send chart ${setup.pair}:`, error);
      }
    }

    await notifier.sendMessage(buildCopyableSetup(setup));
    logger.info(`  ✓ Sent setup: ${setup.pair} ${setup.direction}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await notifier.sendMessage(
    `✅ *Scan hoàn tất* — ${summaries.length} cặp và ${setups.length} setup(s) đạt ngưỡng (≥${threshold}%)${isCached ? " từ cache" : " từ thuật toán"}\n\n⚠️ _Phân tích luôn bám theo last closed candle, không phải nến đang chạy._`,
  );
}
