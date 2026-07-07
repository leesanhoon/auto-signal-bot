import type {
  AnalysisResult,
  ChartOrderType,
  PairSummary,
  ScreenshotResult,
  TradeSetup,
  ChartAnalysisSource,
  ChartTimeframe,
  PendingOrder,
} from "./chart-types.js";
import { withRetry } from "../shared/retry.js";
import { createLogger } from "../shared/logger.js";
import { recordOpenRouterUsage } from "../shared/ai-usage.js";
import {
  callOpenRouter,
  type OpenRouterRequest,
} from "../shared/openrouter.js";
import { callOpenRouterWithFallback, parseModelFallbacks } from "../shared/ai-model-fallback.js";
import type { ChartTimeframeMode } from "./chart-config-env.js";

const logger = createLogger("charts:analyzer");
const ANALYSIS_MODEL =
  process.env.AI_VISION_MODEL?.trim() || "xiaomi/mimo-v2.5";
const ANALYSIS_MODEL_FALLBACKS = parseModelFallbacks(
  process.env.AI_VISION_MODEL_FALLBACKS?.trim(),
);

type PairScreenshotGroup = { pair: string; screenshots: ScreenshotResult[] };

function getPairName(screenshot: ScreenshotResult): string {
  return screenshot.chart.name.replace(` ${screenshot.chart.timeframe}`, "");
}

function toChartAnalysisSource(
  screenshot: ScreenshotResult,
): ChartAnalysisSource {
  return {
    symbol: screenshot.chart.symbol,
    timeframe: screenshot.chart.timeframe,
    name: screenshot.chart.name,
    filepath: screenshot.filepath,
  };
}

function normalizePairKey(value: string): string {
  return value.replace(/[\s\/_.:-]+/g, "").toUpperCase();
}

function getReferenceLastPrice(screenshots: ScreenshotResult[]): number | null {
  const h4 = screenshots.find(
    (s) => s.chart.timeframe === "H4" && typeof s.lastPrice === "number",
  );
  if (typeof h4?.lastPrice === "number") {
    return h4.lastPrice;
  }

  const anyPrice = screenshots.find((s) => typeof s.lastPrice === "number");
  return typeof anyPrice?.lastPrice === "number" ? anyPrice.lastPrice : null;
}

function parsePrice(value: string): number | null {
  const parsed = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatPrice(value: number): string {
  const precision = value >= 1000 ? 2 : value >= 100 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(precision);
}

export function applyPriceSanityChecks(
  setup: TradeSetup,
  lastPrice: number | null,
): { setup: TradeSetup | null; note?: string } {
  if (lastPrice === null || !Number.isFinite(lastPrice)) {
    return { setup };
  }

  const entry = parsePrice(setup.entry);
  const stopLoss = parsePrice(setup.stopLoss);
  const takeProfit1 = parsePrice(setup.takeProfit1);
  const takeProfit2 = setup.takeProfit2 ? parsePrice(setup.takeProfit2) : null;

  const currentPriceContext = setup.currentPriceContext
    ? `${setup.currentPriceContext} | Giá thật hiện tại: ${formatPrice(lastPrice)}`
    : `Giá thật hiện tại: ${formatPrice(lastPrice)}`;

  if (entry === null || stopLoss === null || takeProfit1 === null) {
    return {
      setup: {
        ...setup,
        lastPrice,
        currentPriceContext,
      },
    };
  }

  const marketNowDeviation =
    Math.abs(lastPrice - entry) / Math.max(lastPrice, entry);
  if (setup.orderType === "MARKET_NOW" && marketNowDeviation > 0.005) {
    return {
      setup: null,
      note: `Loại setup ${setup.pair} vì MARKET_NOW lệch quá xa so với giá thật ${formatPrice(lastPrice)}.`,
    };
  }

  if (setup.direction === "LONG" && lastPrice <= stopLoss) {
    return {
      setup: null,
      note: `Loại setup ${setup.pair} vì giá thật ${formatPrice(lastPrice)} đã nằm dưới stop loss.`,
    };
  }

  if (setup.direction === "SHORT" && lastPrice >= stopLoss) {
    return {
      setup: null,
      note: `Loại setup ${setup.pair} vì giá thật ${formatPrice(lastPrice)} đã nằm trên stop loss.`,
    };
  }

  const updatedSetup: TradeSetup = {
    ...setup,
    lastPrice,
    currentPriceContext,
  };

  if (
    setup.direction === "LONG" &&
    takeProfit2 !== null &&
    lastPrice >= takeProfit2
  ) {
    updatedSetup.currentPriceContext += ` | Giá đã vượt TP2 ${formatPrice(takeProfit2)}.`;
  } else if (
    setup.direction === "SHORT" &&
    takeProfit2 !== null &&
    lastPrice <= takeProfit2
  ) {
    updatedSetup.currentPriceContext += ` | Giá đã vượt TP2 ${formatPrice(takeProfit2)}.`;
  } else if (setup.direction === "LONG" && lastPrice >= takeProfit1) {
    updatedSetup.currentPriceContext += ` | Giá đã chạm/vượt TP1 ${formatPrice(takeProfit1)}.`;
  } else if (setup.direction === "SHORT" && lastPrice <= takeProfit1) {
    updatedSetup.currentPriceContext += ` | Giá đã chạm/vượt TP1 ${formatPrice(takeProfit1)}.`;
  }

  return { setup: updatedSetup };
}

function groupScreenshotsByPair(
  screenshots: ScreenshotResult[],
): PairScreenshotGroup[] {
  const groups = new Map<string, ScreenshotResult[]>();
  for (const screenshot of screenshots) {
    const pair = getPairName(screenshot);
    const items = groups.get(pair) ?? [];
    items.push(screenshot);
    groups.set(pair, items);
  }
  return Array.from(groups.entries()).map(([pair, groupScreenshots]) => ({
    pair,
    screenshots: groupScreenshots.sort(
      (left, right) =>
        ["D1", "H4", "M15"].indexOf(left.chart.timeframe) -
        ["D1", "H4", "M15"].indexOf(right.chart.timeframe),
    ),
  }));
}

function buildSystemPrompt(): string {
  return [
    "Bạn là chuyên gia phân tích biểu đồ forex/kim loại theo phương pháp Bob Volman.",
    "Hãy đọc trực tiếp các ảnh chart được gửi, gồm pair và timeframe trong label.",
    "Luôn xác nhận trước EMA20 đang flat, dốc lên hay dốc xuống, và giá đang ở trên hay dưới EMA20 trước khi kết luận.",
    "Ưu tiên volume tại điểm breakout: volume tăng xác nhận break thật, volume yếu hoặc hụt lực thì nghi ngờ false break.",
    "Chỉ gán đúng 1 pattern khi cấu trúc trên chart khớp rõ ràng, không đoán ép tên pattern.",
    "RB: EMA20 đi ngang một thời gian rồi bắt đầu dốc theo hướng breakout khỏi vùng tích lũy.",
    "ARB: range lớn, nhiều lần test biên và false break trước khi break thật.",
    "IRB: range nhỏ nằm trong range lớn, breakout của range nhỏ kéo phá luôn range lớn.",
    "BB: block nến nhỏ nằm sát EMA20, break theo đúng hướng trend chính khi EMA20 đang dốc.",
    "FB: breakout lần đầu ra khỏi range lớn, có nến thân dài xác nhận momentum.",
    "SB: false break lần 1, buildup rồi break lần 2 mới là hướng thật.",
    "DD: 2-3 doji liền kề sát EMA20 trong trend rõ ràng rồi break theo hướng trend.",
    "Nếu chart chưa rõ hoặc tín hiệu yếu, hãy nói không vào lệnh/chờ thêm xác nhận.",
    "Không bịa level nếu không đọc được trên chart.",
    "Tất cả field text bằng tiếng Việt có dấu.",
  ].join(" ");
}

function buildUserPrompt(): string {
  return [
    "Return only JSON with keys summaries, setups, and noSetupReason.",
    "summaries: mỗi pair gồm pair, trend, emaProximity nếu thấy, status, confidence; nếu thấy rõ thì nêu EMA20 slope và vị trí giá so với EMA20.",
    "setups: chỉ các setup AI thấy đáng chú ý, gồm pair, direction, setup, primaryTimeframe, orderType, entryCondition, currentPriceContext, emaTouch, reasons, risks, confidence, entry, stopLoss, takeProfit1, takeProfit2, riskReward, summary.",
    "Mỗi setup phải khớp rõ với 1 pattern trong RB, ARB, IRB, BB, FB, SB, DD; nếu không khớp rõ thì không tạo setup và ghi lý do vào noSetupReason.",
    "Trong reasons/currentPriceContext hãy nói rõ EMA20 slope, giá ở trên/dưới EMA20, và volume tại điểm breakout nếu quan sát được.",
    "Luôn bám theo LAST_PRICE từ dữ liệu ảnh để kiểm tra entry/stop loss/take profit; nếu giá thật mâu thuẫn với setup thì giảm confidence hoặc không tạo setup.",
    "Không cần ép đủ mọi rule; nếu không chắc thì giảm confidence, ghi rõ trong risks hoặc noSetupReason, và không gán pattern bừa.",
    "Giữ output ngắn gọn, logic chặt, tiếng Việt có dấu, không markdown.",
  ].join(" ");
}

export function buildPendingOrderCheckPrompt(
  order: PendingOrder,
  lastPrice: number | null = null,
): string {
  return [
    "You assess whether a pending forex setup has triggered, failed, or is still pending.",
    "Return only JSON with keys status, confidence, comment.",
    "Possible status values: TRIGGERED, CANCELLED, PENDING.",
    "Use the attached chart and the order details below.",
    `- Pair: ${order.pair}`,
    `- Direction: ${order.direction}`,
    `- Order type: ${order.orderType}`,
    `- Setup: ${order.setup ?? ""}`,
    `- Primary timeframe: ${order.primaryTimeframe ?? "H4"}`,
    `- Entry: ${order.entry}`,
    `- Stop loss: ${order.stopLoss}`,
    `- Take profit 1: ${order.takeProfit1}`,
    `- Take profit 2: ${order.takeProfit2 ?? ""}`,
    `- Confidence: ${order.confidence ?? 0}%`,
    `- Reasons: ${(order.reasons ?? []).slice(0, 3).join(" | ")}`,
    `- Risks: ${(order.risks ?? []).slice(0, 3).join(" | ")}`,
    `- Last price: ${lastPrice ?? "unknown"}`,
    "",
    "TRIGGERED: price has touched or broken the entry in the correct direction and the setup still looks valid.",
    "CANCELLED: price moved against the setup, hit stop-loss before entry, or the structure is no longer valid.",
    "PENDING: entry has not been reached yet and the structure remains valid.",
    "Use Vietnamese with accents in comment.",
  ].join("\n");
}

export function buildChartAnalysisCacheKey(
  candleKey: string,
  engineMode: string,
  timeframeMode: ChartTimeframeMode,
  primaryTimeframe?: string,
): string {
  return timeframeMode === "single"
    ? `${candleKey}:${engineMode}:${timeframeMode}:${primaryTimeframe ?? "M15"}`
    : `${candleKey}:${engineMode}:${timeframeMode}`;
}

export function cleanResponse(text: string): string {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

export function extractJsonObject(text: string): string {
  const cleaned = cleanResponse(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

export function clampConfidence(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : 0;
}

function toText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") return [value];
  return [];
}

function normalizeOrderType(
  value: unknown,
  direction: unknown,
): ChartOrderType {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (
    raw === "MARKET_NOW" ||
    raw === "BUY_STOP" ||
    raw === "SELL_STOP" ||
    raw === "BUY_LIMIT" ||
    raw === "SELL_LIMIT" ||
    raw === "WAIT_FOR_CONFIRMATION"
  ) {
    return raw;
  }
  return String(direction ?? "").toUpperCase() === "SHORT"
    ? "SELL_STOP"
    : "BUY_STOP";
}

function normalizeDirection(value: unknown): "LONG" | "SHORT" {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["LONG", "BUY", "MUA", "LEN", "TANG", "UP"].includes(raw)) return "LONG";
  if (["SHORT", "SELL", "BAN", "XUONG", "GIAM", "DOWN"].includes(raw))
    return "SHORT";
  return raw.includes("SHORT") || raw.includes("SELL") ? "SHORT" : "LONG";
}

function normalizeTimeframe(value: unknown): ChartTimeframe {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  return raw === "D1" || raw === "H4" || raw === "M15" ? raw : "H4";
}

function normalizePendingStatus(
  value: unknown,
): "TRIGGERED" | "CANCELLED" | "PENDING" {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (raw === "TRIGGERED" || raw === "CANCELLED" || raw === "PENDING")
    return raw;
  return "PENDING";
}

function detectImageMimeType(buffer: Buffer): "image/png" | "image/jpeg" {
  return buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
    ? "image/png"
    : "image/jpeg";
}

export function parseAnalysisResponse(
  text: string,
  options: { lastPriceByPair?: Map<string, number | null> } = {},
): {
  summaries: PairSummary[];
  setups: TradeSetup[];
  noSetupReason: string;
} {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as Partial<{
      summaries: unknown;
      setups: unknown;
      noSetupReason: string;
    }>;
    const rawSetups = Array.isArray(parsed.setups) ? parsed.setups : [];
    const noSetupNotes: string[] = [];
    const normalizedSetups = rawSetups
      .filter(
        (s): s is Record<string, unknown> =>
          s !== null && typeof s === "object",
      )
      .map((s): TradeSetup | null => {
        const direction = normalizeDirection(s.direction);
        const setup = {
          ...s,
          direction,
          reasons: toArray(s.reasons),
          risks: toArray(s.risks),
          primaryTimeframe: normalizeTimeframe(s.primaryTimeframe),
          orderType: normalizeOrderType(s.orderType, direction),
          entryCondition: toText(
            s.entryCondition,
            "Chờ giá xác nhận đúng vùng entry trước khi vào lệnh.",
          ),
          currentPriceContext: toText(
            s.currentPriceContext,
            "Model chưa mô tả rõ vị trí giá hiện tại so với entry.",
          ),
        } as unknown as TradeSetup;
        const lastPrice =
          options.lastPriceByPair?.get(normalizePairKey(setup.pair)) ?? null;
        const checked = applyPriceSanityChecks(setup, lastPrice);
        if (!checked.setup && checked.note) {
          noSetupNotes.push(checked.note);
          return null;
        }
        return checked.setup;
      });
    return {
      summaries: Array.isArray(parsed.summaries) ? parsed.summaries : [],
      setups: normalizedSetups.filter((setup): setup is TradeSetup =>
        Boolean(setup),
      ),
      noSetupReason: [toText(parsed.noSetupReason), ...noSetupNotes]
        .filter(Boolean)
        .join("\n"),
    };
  } catch {
    return {
      summaries: [],
      setups: [],
      noSetupReason: "Failed to parse AI response. Raw: " + text.slice(0, 300),
    };
  }
}

export function parsePendingOrderCheckResponse(text: string): {
  status: "TRIGGERED" | "CANCELLED" | "PENDING";
  confidence: number;
  comment: string;
} | null {
  const cleaned = extractJsonObject(text);
  try {
    const parsed = JSON.parse(cleaned) as {
      status?: unknown;
      confidence?: unknown;
      comment?: unknown;
    };
    return {
      status: normalizePendingStatus(parsed.status),
      confidence: clampConfidence(parsed.confidence),
      comment: toText(parsed.comment),
    };
  } catch {
    return null;
  }
}

async function analyzeWithOpenRouter(
  screenshots: ScreenshotResult[],
): Promise<string> {
  const userContent: OpenRouterRequest["userContent"] = [];
  const ordered = [...screenshots].sort((left, right) => {
    const pairOrder = left.chart.symbol.localeCompare(right.chart.symbol);
    return pairOrder !== 0
      ? pairOrder
      : ["D1", "H4", "M15"].indexOf(left.chart.timeframe) -
          ["D1", "H4", "M15"].indexOf(right.chart.timeframe);
  });
  for (const screenshot of ordered) {
    const mime = detectImageMimeType(screenshot.buffer);
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${mime};base64,${screenshot.buffer.toString("base64")}`,
      },
    });
    userContent.push({
      type: "text",
      text: `[PAIR=${getPairName(screenshot)}; TIMEFRAME=${screenshot.chart.timeframe}; LAST_PRICE=${screenshot.lastPrice ?? "unknown"}]`,
    });
  }
  userContent.push({ type: "text", text: buildUserPrompt() });

  const { response: result, model: usedModel } = await callOpenRouterWithFallback(
    ANALYSIS_MODEL,
    ANALYSIS_MODEL_FALLBACKS,
    (model) => ({
      model,
      systemPrompt: buildSystemPrompt(),
      userContent,
      maxTokens: 4000,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    }),
    (error, attempt, maxAttempts, delayMs) =>
      logger.warn(
        `  ! OpenRouter main analysis temporary error (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${error instanceof Error ? error.message : error}`,
      ),
  );
  void recordOpenRouterUsage(result, {
    model: usedModel,
    source: "chart",
  });
  return result.text;
}

export async function analyzeAllCharts(
  screenshots: ScreenshotResult[],
): Promise<AnalysisResult> {
  const groups = groupScreenshotsByPair(screenshots);
    logger.info(`  -> Trying ${ANALYSIS_MODEL} per pair...`, {
      pairs: groups.length,
    });
  const summaries: PairSummary[] = [];
  const setups: TradeSetup[] = [];
  const noSetupReasons: string[] = [];
  const failedPairs: string[] = [];

  const analysisResults = await Promise.all(
    groups.map(async (group) => {
      try {
        logger.info(`  -> Analyzing ${group.pair} with ${ANALYSIS_MODEL}...`);
        const referenceLastPrice = getReferenceLastPrice(group.screenshots);
        const parsed = parseAnalysisResponse(
          await analyzeWithOpenRouter(group.screenshots),
          {
            lastPriceByPair: new Map([
              [normalizePairKey(group.pair), referenceLastPrice],
            ]),
          },
        );
        const sourceCharts = group.screenshots.map(toChartAnalysisSource);
        logger.info(`  ✓ Analyzed ${group.pair} by ${ANALYSIS_MODEL}`);
        return {
          kind: "ok" as const,
          pair: group.pair,
          summaries: parsed.summaries,
          setups: parsed.setups.map((setup) => ({
            ...setup,
            sourceCharts,
            lastPrice: referenceLastPrice,
          })),
          noSetupReason: parsed.noSetupReason,
        };
      } catch (error) {
        logger.warn(
          `  ! OpenRouter main analysis failed for ${group.pair} (${group.screenshots.length} screenshots): ${error instanceof Error ? error.message : error}`,
        );
        return { kind: "err" as const, pair: group.pair };
      }
    }),
  );

  for (const result of analysisResults) {
    if (result.kind === "ok") {
      summaries.push(...result.summaries);
      setups.push(...result.setups);
      if (result.noSetupReason.trim()) {
        noSetupReasons.push(`[${result.pair}] ${result.noSetupReason.trim()}`);
      }
    } else {
      failedPairs.push(result.pair);
    }
  }
  if (summaries.length === 0 && setups.length === 0) {
    throw new Error(
      failedPairs.length > 0
        ? `OpenRouter main analysis failed for all pairs: ${failedPairs.join(", ")}`
        : "OpenRouter main analysis returned no usable results.",
    );
  }

  logger.info(
    `  ✓ ${summaries.length} pairs scanned, ${setups.length} setup(s) returned by AI`,
  );
  return {
    summaries,
    setups,
    noSetupReason: noSetupReasons.join("\n").trim(),
    screenshots,
  };
}
