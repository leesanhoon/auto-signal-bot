import type { AnalysisResult, TradeSetup } from "../charts/chart-types-smc.js";
import type {
  ChartTimeframe,
} from "../charts/chart-types-common.js";
import type { Notifier } from "./notifier.js";
import { createLogger } from "./logger.js";
import type { PerformanceReport } from "../charts/performance-tracking-smc.js";
import { getConfiguredSmcMinSignalConfidence } from "../charts/smc-config-env.js";
import { telegramNotifier } from "./telegram-client.js";

const logger = createLogger("shared:telegram-smc");

const SMC_SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━";

const TIMEFRAME_MS: Record<ChartTimeframe, number> = {
  M15: 15 * 60 * 1000,
  M30: 30 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
};

function formatPlainPrice(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? "");
  return num
    .toFixed(num >= 100 ? 2 : 5)
    .replace(/\.?0+$/, (m) => (m.startsWith(".") ? "" : m));
}

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

function getSmcDirectionLabel(
  direction: TradeSetup["direction"],
): "BUY" | "SELL" {
  return direction === "LONG" ? "BUY" : "SELL";
}

function parseNumericLike(value: unknown): number | null {
  const parsed = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRiskRewardValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value))
    return `${value.toFixed(1)}:1`;
  if (typeof value === "string" && value.trim().length > 0) return value;
  return "N/A";
}

function calculateRiskRewardFromPrices(
  entry: unknown,
  stopLoss: unknown,
  target: unknown,
): string {
  const entryNum = parseNumericLike(entry);
  const slNum = parseNumericLike(stopLoss);
  const targetNum = parseNumericLike(target);
  if (entryNum === null || slNum === null || targetNum === null) return "N/A";
  const risk = Math.abs(entryNum - slNum);
  if (risk <= 0) return "N/A";
  const reward = Math.abs(targetNum - entryNum);
  return `${(reward / risk).toFixed(1)}:1`;
}

export function buildSmcSignalMessage(setup: TradeSetup): string {
  const grade = setup.grade ?? "N/A";
  const score = setup.score ?? setup.confidence ?? 0;
  const lines: string[] = [
    `[SIGNAL] ${setup.pair} - ${getSmcDirectionLabel(setup.direction)} | Grade: ${grade} | Score: ${score}/100`,
    SMC_SEPARATOR,
    `Timeframe: ${setup.primaryTimeframe ?? "N/A"}${setup.sessionLabel ? ` | Session: ${setup.sessionLabel}` : ""}`,
  ];

  const candleAge = formatCandleAge(setup.primaryTimeframe);
  if (candleAge) lines.push(candleAge);

  if (setup.market) lines.push(`Market: ${setup.market}`);
  lines.push(SMC_SEPARATOR, "", `[ENTRY] ${setup.entry}`);
  if (setup.entryZone)
    lines.push(`Entry Zone: ${setup.entryZone.low} - ${setup.entryZone.high}`);

  const stopLossDistance =
    setup.stopLossDistance ??
    (() => {
      const entry = parseNumericLike(setup.entry);
      const sl = parseNumericLike(setup.stopLoss);
      return entry !== null && sl !== null
        ? `$${Math.abs(entry - sl).toFixed(2)}`
        : null;
    })();
  lines.push(
    "",
    `[SL] ${setup.stopLoss}${stopLossDistance ? ` | SL Distance: ${stopLossDistance}` : ""}`,
  );

  const allocation = setup.takeProfitAllocations;
  const liquidityByTarget = new Map(
    (setup.liquidityTargets ?? []).map((item) => [item.target, item]),
  );
  const tpEntries = [
    { key: "TP1", price: setup.takeProfit1, alloc: allocation?.tp1 },
    { key: "TP2", price: setup.takeProfit2, alloc: allocation?.tp2 },
    ...(setup.takeProfit3
      ? [{ key: "TP3", price: setup.takeProfit3, alloc: allocation?.tp3 }]
      : []),
  ];
  for (const tp of tpEntries) {
    const liq = liquidityByTarget.get(tp.key as "TP1" | "TP2" | "TP3");
    const rr =
      liq?.riskReward !== undefined
        ? formatRiskRewardValue(liq.riskReward)
        : tp.key === "TP1"
          ? formatRiskRewardValue(setup.riskReward)
          : calculateRiskRewardFromPrices(
              setup.entry,
              setup.stopLoss,
              tp.price,
            );
    const allocText =
      typeof tp.alloc === "number" ? ` | Chốt ${tp.alloc}%` : "";
    const liqText = liq ? ` | ${liq.label} ${liq.price}` : "";
    lines.push("", `[${tp.key}] ${tp.price} | R:R ${rr}${allocText}${liqText}`);
  }

  lines.push("", SMC_SEPARATOR, "NHẬN ĐỊNH:");
  if (setup.reasons.length > 0) {
    for (const reason of setup.reasons) lines.push(`- ${reason}`);
  } else {
    lines.push("- (Không có nhận định chi tiết)");
  }

  lines.push("", "QUẢN LÝ VỐN:");
  const capitalManagement = setup.capitalManagement?.length
    ? setup.capitalManagement
    : [
        "Risk 1-2% tài khoản cho lệnh này.",
        setup.takeProfit3
          ? "Chiến lược chốt lời: 50% tại TP1, 30% tại TP2, 20% tại TP3."
          : "Chiến lược chốt lời: 50% tại TP1, 50% tại TP2.",
        "Kéo SL về entry (breakeven) ngay khi chạm TP1 để bảo toàn vốn.",
      ];
  for (const line of capitalManagement) lines.push(`- ${line}`);

  lines.push(
    "",
    `THẬN TRỌNG: ${setup.caution ?? "Thanh khoản thấp ngoài khung giờ vàng có thể gây biến động bất ngờ."}`,
  );
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
    "🫀 *SMC Multi-Timeframe Scanner heartbeat*",
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

export async function sendAllAnalysesSmc(
  result: AnalysisResult,
  notifier: Notifier = telegramNotifier,
  deliveryContext: { source?: "live" | "cached"; candleKey?: string } = {},
): Promise<void> {
  const timestamp = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const threshold = getConfiguredSmcMinSignalConfidence();
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
  const scannerLabel = "SMC Multi-Timeframe Scanner";

  if (setups.length === 0) {
    await notifier.sendMessage(
      [
        `⏸ *${scannerLabel}* — không có setup đạt ngưỡng (≥${threshold}%)${isCached ? " (cache)" : ""}`,
        `📅 ${timestamp} | Quét ${attemptedCount} cặp, ${summaries.length}/${result.summaries.length} đạt ngưỡng summary`,
      ].join("\n"),
    );
    logger.info(
      `  → No setups above threshold (${threshold}%). Notification sent with ${summaries.length} eligible summaries (${footerLabel}).`,
    );
    return;
  }

  await notifier.sendMessage(
    `🚀 *${scannerLabel}${sourceLabel}*\n📅 ${timestamp}\n${cacheLine ? `${cacheLine}\n` : ""}📊 Đã quét *${result.summaries.length}* cặp (D1/H4/M15 + volume)\n📊 Lọc còn *${summaries.length}* cặp đạt ngưỡng (≥${threshold}%) — tìm thấy *${setups.length}* setup${setupHeaderSuffix}\n\n_"Scanner luôn phân tích theo last closed candle, không dùng nến đang chạy."_`,
  );

  for (const setup of setups) {
    await notifier.sendMessage(buildSmcSignalMessage(setup));
    logger.info(`  ✓ Sent setup: ${setup.pair} ${setup.direction}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await notifier.sendMessage(
    `✅ *Scan hoàn tất* — ${summaries.length} cặp và ${setups.length} setup(s) đạt ngưỡng (≥${threshold}%)${isCached ? " từ cache" : " từ thuật toán"}\n\n⚠️ _Phân tích luôn bám theo last closed candle, không phải nến đang chạy._`,
  );
}
