import type { AnalysisResult, ChartOrderType, PairSummary, ScreenshotResult, TradeSetup, ChartAnalysisSource } from "./chart-types.js";
import { withRetry } from "../shared/retry.js";
import { createLogger } from "../shared/logger.js";
import { recordOpenRouterUsage } from "../shared/ai-usage.js";
import { callOpenRouter, type OpenRouterRequest } from "../shared/openrouter.js";
import { findChartForPair } from "./screenshot.js";

const logger = createLogger("charts:analyzer");
const ANALYSIS_MODEL = process.env.AI_VISION_MODEL?.trim() || "xiaomi/mimo-v2.5";
const VERIFY_MODEL = process.env.AI_VERIFY_MODEL?.trim() || "moonshotai/kimi-k2.6";

type PairScreenshotGroup = { pair: string; screenshots: ScreenshotResult[] };

function getPairName(screenshot: ScreenshotResult): string {
  return screenshot.chart.name.replace(` ${screenshot.chart.timeframe}`, "");
}

function toChartAnalysisSource(screenshot: ScreenshotResult): ChartAnalysisSource {
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

function findScreenshotByProvenance(
  pair: string,
  screenshots: ScreenshotResult[],
  preferredSource?: ChartAnalysisSource,
): ScreenshotResult | undefined {
  if (preferredSource) {
    const exactTriples = screenshots.find(
      (s) =>
        s.filepath === preferredSource.filepath &&
        s.chart.symbol === preferredSource.symbol &&
        s.chart.timeframe === preferredSource.timeframe,
    );
    if (exactTriples) return exactTriples;

    const exactSymbolTimeframe = screenshots.find(
      (s) =>
        s.chart.symbol === preferredSource.symbol &&
        s.chart.timeframe === preferredSource.timeframe,
    );
    if (exactSymbolTimeframe) return exactSymbolTimeframe;

    if (preferredSource.filepath) {
      const exactFilepath = screenshots.find((s) => s.filepath === preferredSource.filepath);
      if (exactFilepath) return exactFilepath;
    }
  }

  const preferredTimeframe = preferredSource?.timeframe ?? "H4";
  const chart = findChartForPair(pair, preferredTimeframe);
  return chart
    ? screenshots.find((s) => s.chart.symbol === chart.symbol && s.chart.timeframe === chart.timeframe)
    : undefined;
}

function groupScreenshotsByPair(screenshots: ScreenshotResult[]): PairScreenshotGroup[] {
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
    "setups: chỉ các setup AI thấy đáng chú ý, gồm pair, direction, setup, orderType, entryCondition, currentPriceContext, emaTouch, reasons, risks, confidence, entry, stopLoss, takeProfit1, takeProfit2, riskReward, summary.",
    "Mỗi setup phải khớp rõ với 1 pattern trong RB, ARB, IRB, BB, FB, SB, DD; nếu không khớp rõ thì không tạo setup và ghi lý do vào noSetupReason.",
    "Trong reasons/currentPriceContext hãy nói rõ EMA20 slope, giá ở trên/dưới EMA20, và volume tại điểm breakout nếu quan sát được.",
    "Không cần ép đủ mọi rule; nếu không chắc thì giảm confidence, ghi rõ trong risks hoặc noSetupReason, và không gán pattern bừa.",
    "Giữ output ngắn gọn, logic chặt, tiếng Việt có dấu, không markdown.",
  ].join(" ");
}

export function cleanResponse(text: string): string {
  return text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
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

export function buildVerificationPrompt(setup: TradeSetup): string {
  return `Check this H4 EMA20 setup against the attached chart.

Setup:
- Pair: ${setup.pair}
- Direction: ${setup.direction}
- Pattern: ${setup.setup}
- Order type: ${setup.orderType ?? ""}
- Entry condition: ${setup.entryCondition ?? ""}
- Current price context: ${setup.currentPriceContext ?? ""}
- Entry: ${setup.entry}
- Stop loss: ${setup.stopLoss}
- Take profit 1: ${setup.takeProfit1}
- Take profit 2: ${setup.takeProfit2}
- Proposed confidence: ${setup.confidence}%
- Reasons: ${setup.reasons.slice(0, 3).join(" | ")}

Reject if the order type is inconsistent with direction, current price context, or entry/SL/TP levels. Reject if the setup is described like an already-open trade while orderType is pending.
Return only JSON with keys confirmed, confidence, comment.
Keep comment short, specific, and in Vietnamese with accents.`;
}

function parseVerificationResponse(
  text: string,
): { confirmed: boolean; confidence: number; comment: string } | null {
  const cleaned = extractJsonObject(text);
  try {
    const parsed = JSON.parse(cleaned) as { confirmed?: unknown; confidence?: unknown; comment?: unknown };
    return {
      confirmed: Boolean(parsed.confirmed),
      confidence: clampConfidence(parsed.confidence),
      comment: String(parsed.comment || ""),
    };
  } catch {
    return null;
  }
}

async function verifySetup(
  setup: TradeSetup,
  imageBuffer: Buffer,
): Promise<{ confirmed: boolean; confidence: number; comment: string; verifiedBy: string }> {
  const mime = detectImageMimeType(imageBuffer);
  const response = await withRetry(
    () => callOpenRouter({
      model: VERIFY_MODEL,
      systemPrompt: "You independently verify trading setups. Return only concise JSON.",
      userContent: [
        {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${imageBuffer.toString("base64")}` },
        },
        { type: "text", text: buildVerificationPrompt(setup) },
      ],
      maxTokens: 300,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    }),
    {
      onRetry: (error, attempt, maxAttempts, delayMs) =>
        logger.warn(
          `  ! OpenRouter verify temporary error for ${setup.pair} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${error instanceof Error ? error.message : error}`,
        ),
    },
  );
  void recordOpenRouterUsage(response, { model: VERIFY_MODEL, source: "chart" });
  const parsed = parseVerificationResponse(response.text);
  if (!parsed) {
    throw new Error(`OpenRouter verify parse failed. Raw: ${response.text.slice(0, 300)}`);
  }
  return { ...parsed, verifiedBy: VERIFY_MODEL };
}

export async function confirmHighConfidenceSetups(
  setups: TradeSetup[],
  screenshots: ScreenshotResult[],
): Promise<TradeSetup[]> {
  return Promise.all(
    setups.map(async (setup) => {
      const preferredSource = setup.sourceCharts?.find((chart) => chart.timeframe === "H4") ?? setup.sourceCharts?.[0];
      const screenshot = findScreenshotByProvenance(setup.pair, screenshots, preferredSource);
      if (!screenshot) return setup;

      try {
        logger.info(`  -> Verifying ${setup.pair} with ${VERIFY_MODEL}...`);
        const verification = await verifySetup(setup, screenshot.buffer);
        logger.info(
          `  ${verification.confirmed ? "✓" : "✗"} ${setup.pair}: ${verification.confirmed ? "confirmed" : "rejected"} (${verification.confidence}%) - ${verification.comment}`,
        );
        return {
          ...setup,
          verifiedConfirmed: verification.confirmed,
          verifiedConfidence: verification.confidence,
          verifiedComment: verification.comment,
          verifiedBy: verification.verifiedBy,
          telegramChart: toChartAnalysisSource(screenshot),
        };
      } catch (error) {
        logger.warn(`  ! Verify failed for ${setup.pair}: ${error instanceof Error ? error.message : error}`);
        return setup;
      }
    }),
  );
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

function normalizeOrderType(value: unknown, direction: unknown): ChartOrderType {
  const raw = String(value ?? "").trim().toUpperCase();
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
  return String(direction ?? "").toUpperCase() === "SHORT" ? "SELL_STOP" : "BUY_STOP";
}

function detectImageMimeType(buffer: Buffer): "image/png" | "image/jpeg" {
  return buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
    ? "image/png"
    : "image/jpeg";
}

export function parseAnalysisResponse(text: string): {
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
    const normalizedSetups: TradeSetup[] = rawSetups
      .filter((s): s is Record<string, unknown> => s !== null && typeof s === "object")
      .map((s) => ({
        ...s,
        reasons: toArray(s.reasons),
        risks: toArray(s.risks),
        orderType: normalizeOrderType(s.orderType, s.direction),
        entryCondition: toText(
          s.entryCondition,
          "Chờ giá xác nhận đúng vùng entry trước khi vào lệnh.",
        ),
        currentPriceContext: toText(
          s.currentPriceContext,
          "Model chưa mô tả rõ vị trí giá hiện tại so với entry.",
        ),
      } as unknown as TradeSetup));
    return {
      summaries: Array.isArray(parsed.summaries) ? parsed.summaries : [],
      setups: normalizedSetups,
      noSetupReason: toText(parsed.noSetupReason),
    };
  } catch {
    return { summaries: [], setups: [], noSetupReason: "Failed to parse AI response. Raw: " + text.slice(0, 300) };
  }
}

async function analyzeWithOpenRouter(screenshots: ScreenshotResult[]): Promise<string> {
  const userContent: OpenRouterRequest["userContent"] = [];
  const ordered = [...screenshots].sort((left, right) => {
    const pairOrder = left.chart.symbol.localeCompare(right.chart.symbol);
    return pairOrder !== 0
      ? pairOrder
      : ["D1", "H4", "M15"].indexOf(left.chart.timeframe) - ["D1", "H4", "M15"].indexOf(right.chart.timeframe);
  });
  for (const screenshot of ordered) {
    const mime = detectImageMimeType(screenshot.buffer);
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${screenshot.buffer.toString("base64")}` },
    });
    userContent.push({
      type: "text",
      text: `[PAIR=${getPairName(screenshot)}; TIMEFRAME=${screenshot.chart.timeframe}]`,
    });
  }
  userContent.push({ type: "text", text: buildUserPrompt() });

  const result = await withRetry(
    () => callOpenRouter({
      model: ANALYSIS_MODEL,
      systemPrompt: buildSystemPrompt(),
      userContent,
      maxTokens: 4000,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    }),
    {
      onRetry: (error, attempt, maxAttempts, delayMs) =>
        logger.warn(
          `  ! OpenRouter main analysis temporary error (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${error instanceof Error ? error.message : error}`,
        ),
    },
  );
  void recordOpenRouterUsage(result, { model: ANALYSIS_MODEL, source: "chart" });
  return result.text;
}

export async function analyzeAllCharts(screenshots: ScreenshotResult[]): Promise<AnalysisResult> {
  const groups = groupScreenshotsByPair(screenshots);
  logger.info(`  -> Trying ${ANALYSIS_MODEL} per pair...`, { pairs: groups.length });
  const summaries: PairSummary[] = [];
  const setups: TradeSetup[] = [];
  const noSetupReasons: string[] = [];
  const failedPairs: string[] = [];

  const analysisResults = await Promise.all(
    groups.map(async (group) => {
      try {
        logger.info(`  -> Analyzing ${group.pair} with ${ANALYSIS_MODEL}...`);
        const parsed = parseAnalysisResponse(await analyzeWithOpenRouter(group.screenshots));
        const sourceCharts = group.screenshots.map(toChartAnalysisSource);
        logger.info(`  ✓ Analyzed ${group.pair} by ${ANALYSIS_MODEL}`);
        return {
          kind: "ok" as const,
          pair: group.pair,
          summaries: parsed.summaries,
          setups: parsed.setups.map((setup) => ({ ...setup, sourceCharts })),
          noSetupReason: parsed.noSetupReason,
        };
      } catch (error) {
        logger.warn(`  ! OpenRouter main analysis failed for ${group.pair} (${group.screenshots.length} screenshots): ${error instanceof Error ? error.message : error}`);
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

  logger.info(`  ✓ ${summaries.length} pairs scanned, ${setups.length} setup(s) returned by AI`);
  return { summaries, setups, noSetupReason: noSetupReasons.join("\n").trim(), screenshots };
}
