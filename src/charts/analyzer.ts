import type { AnalysisResult, PairSummary, ScreenshotResult, TradeSetup } from "./chart-types.js";
import { withRetry } from "../shared/retry.js";
import { createLogger } from "../shared/logger.js";
import { recordOpenRouterUsage } from "../shared/ai-usage.js";
import { callOpenRouter, type OpenRouterRequest } from "../shared/openrouter.js";
import { getConfiguredChartSignalConfidenceThreshold } from "./chart-config-env.js";
import { findChartForPair } from "./screenshot.js";

const logger = createLogger("charts:analyzer");
const ANALYSIS_MODEL = process.env.AI_VISION_MODEL?.trim() || "xiaomi/mimo-v2.5";
const VERIFY_MODEL = process.env.AI_VERIFY_MODEL?.trim() || "moonshotai/kimi-k2.6";

type PairScreenshotGroup = { pair: string; screenshots: ScreenshotResult[] };

function getPairName(screenshot: ScreenshotResult): string {
  return screenshot.chart.name.replace(` ${screenshot.chart.timeframe}`, "");
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

function buildSystemPrompt(threshold: number): string {
  return `Act as a professional price-action trader using Bob Volman's methodology, EMA 20, and volume.

Analyze each instrument as one multi-timeframe package:
- D1 establishes the dominant trend and major support/resistance.
- H4 identifies the Volman setup (RB, BB, ARB, FB, SB, DD, or IRB) and is the primary decision timeframe.
- M15 refines entry timing and rejects entries with noisy, contradictory price action.
- Volume must confirm a breakout or rejection. Treat weak or declining volume as a risk, never as confirmation.

Only recommend TRADE when D1 and H4 direction agree, M15 does not contradict them, price is at or near H4 EMA 20 or has a clean buildup, and volume supports the move. Missing timeframes, conflicting trends, distant price without a pullback, flat EMA, weak volume, or poor risk/reward must reduce confidence. If fewer than two timeframes agree, or confidence is below ${threshold}%, conclude NO TRADE. Never invent unreadable price levels.`;
}

function buildUserPrompt(threshold: number): string {
  return `Analyze the attached chart packages. Each image label contains pair and timeframe. Return only JSON with keys summaries, setups, and noSetupReason.

In summaries include every pair with pair, trend (describe D1/H4/M15 alignment), emaProximity (tại/gần/xa), status, and confidence.
In setups include only confluence setups with confidence >=${threshold}%; include pair, direction, setup, emaTouch, reasons, risks, confidence, entry, stopLoss, takeProfit1, takeProfit2, riskReward, and summary. Reasons must explicitly mention D1, H4, M15, and volume evidence. Provide levels from H4/M15. Omit surrounding text.`;
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
- Entry: ${setup.entry}
- Stop loss: ${setup.stopLoss}
- Take profit 1: ${setup.takeProfit1}
- Take profit 2: ${setup.takeProfit2}
- Proposed confidence: ${setup.confidence}%
- Reasons: ${setup.reasons.slice(0, 3).join(" | ")}

Return only JSON with keys confirmed, confidence, comment.
Keep comment short and specific.`;
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
  const result: TradeSetup[] = [];
  for (const setup of setups) {
    const chart = findChartForPair(setup.pair, "H4");
    const screenshot = chart
      ? screenshots.find((item) => item.chart.symbol === chart.symbol && item.chart.timeframe === "H4")
      : undefined;
    if (!screenshot) {
      result.push(setup);
      continue;
    }

    try {
      logger.info(`  -> Verifying ${setup.pair} with ${VERIFY_MODEL}...`);
      const verification = await verifySetup(setup, screenshot.buffer);
      logger.info(
        `  ${verification.confirmed ? "✓" : "✗"} ${setup.pair}: ${verification.confirmed ? "confirmed" : "rejected"} (${verification.confidence}%) - ${verification.comment}`,
      );
      result.push({
        ...setup,
        verifiedConfirmed: verification.confirmed,
        verifiedConfidence: verification.confidence,
        verifiedComment: verification.comment,
        verifiedBy: verification.verifiedBy,
      });
    } catch (error) {
      logger.warn(`  ! Verify failed for ${setup.pair}: ${error instanceof Error ? error.message : error}`);
      result.push(setup);
    }
  }
  return result;
}

function toText(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") return [value];
  return [];
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
    const threshold = getConfiguredChartSignalConfidenceThreshold();
    const rawSetups = Array.isArray(parsed.setups) ? parsed.setups : [];
    const normalizedSetups: TradeSetup[] = rawSetups
      .filter((s): s is Record<string, unknown> => s !== null && typeof s === "object")
      .map((s) => ({
        ...s,
        reasons: toArray(s.reasons),
        risks: toArray(s.risks),
      } as unknown as TradeSetup))
      .filter((setup) => (setup.confidence ?? 0) >= threshold);
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
  const threshold = getConfiguredChartSignalConfidenceThreshold();
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
  userContent.push({ type: "text", text: buildUserPrompt(threshold) });

  const result = await withRetry(
    () => callOpenRouter({
      model: ANALYSIS_MODEL,
      systemPrompt: buildSystemPrompt(threshold),
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
  const threshold = getConfiguredChartSignalConfidenceThreshold();
  const groups = groupScreenshotsByPair(screenshots);
  const prefixReasons = groups.length > 1;
  logger.info(`  -> Trying ${ANALYSIS_MODEL} per pair...`, { pairs: groups.length });
  const summaries: PairSummary[] = [];
  const setups: TradeSetup[] = [];
  const noSetupReasons: string[] = [];
  const failedPairs: string[] = [];

  for (const group of groups) {
    try {
      logger.info(`  -> Analyzing ${group.pair} with ${ANALYSIS_MODEL}...`);
      const parsed = parseAnalysisResponse(await analyzeWithOpenRouter(group.screenshots));
      summaries.push(...parsed.summaries);
      setups.push(...parsed.setups);
      if (parsed.noSetupReason.trim()) {
        noSetupReasons.push(prefixReasons ? `[${group.pair}] ${parsed.noSetupReason.trim()}` : parsed.noSetupReason.trim());
      }
      logger.info(`  ✓ Analyzed ${group.pair} by ${ANALYSIS_MODEL}`);
    } catch (error) {
      failedPairs.push(group.pair);
      logger.warn(`  ! OpenRouter main analysis failed for ${group.pair} (${group.screenshots.length} screenshots): ${error instanceof Error ? error.message : error}`);
    }
  }
  if (summaries.length === 0 && setups.length === 0) {
    throw new Error(
      failedPairs.length > 0
        ? `OpenRouter main analysis failed for all pairs: ${failedPairs.join(", ")}`
        : "OpenRouter main analysis returned no usable results.",
    );
  }

  const availableTimeframes = new Map<string, Set<string>>();
  for (const screenshot of screenshots) {
    const timeframes = availableTimeframes.get(getPairName(screenshot)) ?? new Set<string>();
    timeframes.add(screenshot.chart.timeframe);
    availableTimeframes.set(getPairName(screenshot), timeframes);
  }
  const confluenceSetups = screenshots.every((s) => Boolean(s.chart.timeframe))
    ? setups.filter((setup) => ["D1", "H4", "M15"].every((tf) => availableTimeframes.get(setup.pair)?.has(tf)))
    : setups;
  logger.info(`  ✓ ${summaries.length} pairs scanned, ${confluenceSetups.length} complete multi-timeframe setup(s) >=${threshold}% confidence`);
  return { summaries, setups: confluenceSetups, noSetupReason: noSetupReasons.join("\n").trim(), screenshots };
}
