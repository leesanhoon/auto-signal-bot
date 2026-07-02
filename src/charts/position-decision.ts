import { withRetry } from "../shared/retry.js";
import type { OpenPosition } from "./positions-repository.js";
import { createLogger } from "../shared/logger.js";
import type { PositionDecisionOutcome } from "./position-engine.js";
import { recordOpenRouterUsage } from "../shared/ai-usage.js";
import { callOpenRouter } from "../shared/openrouter.js";
import type { ScreenshotResult } from "./chart-types.js";

const logger = createLogger("charts:position-decision");
const MODEL = process.env.AI_VISION_MODEL?.trim() || "xiaomi/mimo-v2.5";

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

export function parseDecisionResponse(text: string): PositionDecisionOutcome | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as Partial<PositionDecisionOutcome> & {
      managementAction?: string; partialClosePercent?: number; newStopLoss?: string;
      tp1Reached?: boolean; tp2Reached?: boolean;
    };
    const decision: PositionDecisionOutcome["decision"] =
      parsed.decision === "CLOSE" || parsed.decision === "STOP" ? parsed.decision : "HOLD";
    const tp1Reached = Boolean(parsed.tp1Reached);
    const tp2Reached = Boolean(parsed.tp2Reached);
    const managementAction: PositionDecisionOutcome["managementAction"] =
      parsed.managementAction === "PARTIAL_TP1" || parsed.managementAction === "MOVE_SL_TO_BE" ||
      parsed.managementAction === "TRAIL_SL" || parsed.managementAction === "TP2_CLOSE"
        ? parsed.managementAction
        : tp2Reached ? "TP2_CLOSE" : tp1Reached ? "PARTIAL_TP1" : "NONE";
    return {
      decision,
      confidence: clampConfidence(parsed.confidence),
      comment: String(parsed.comment || ""),
      managementAction,
      partialClosePercent: Math.max(0, Math.min(100, Math.round(Number(parsed.partialClosePercent ?? (managementAction === "PARTIAL_TP1" ? 50 : 0))))),
      newStopLoss: parsed.newStopLoss ? String(parsed.newStopLoss) : null,
      tp1Reached,
      tp2Reached,
      riskReward: parsed.riskReward === undefined ? null : Number(parsed.riskReward),
      tp1RiskReward: parsed.tp1RiskReward === undefined ? null : Number(parsed.tp1RiskReward),
      tp2RiskReward: parsed.tp2RiskReward === undefined ? null : Number(parsed.tp2RiskReward),
    };
  } catch {
    return null;
  }
}

export async function decidePosition(position: OpenPosition, screenshot: ScreenshotResult): Promise<PositionDecisionOutcome> {
  const prompt = `Review the current chart and the open trade below.

Trade:
- Pair: ${position.pair}
- Direction: ${position.direction}
- Setup: ${position.setup ?? ""}
- Entry: ${position.entry}
- Stop loss: ${position.stopLoss}
- Take profit 1: ${position.takeProfit1}
- Take profit 2: ${position.takeProfit2 ?? ""}
- Reasons: ${(position.reasons ?? []).slice(0, 4).join(" | ")}

All user-facing fields must be Vietnamese with accents. The comment must be Vietnamese, concise, and directly explain HOLD/CLOSE/STOP.
Return only JSON with keys decision, managementAction, partialClosePercent, newStopLoss, confidence, comment.
decision must be one of HOLD, CLOSE, STOP.
managementAction must be one of NONE, PARTIAL_TP1, MOVE_SL_TO_BE, TRAIL_SL, TP2_CLOSE.
If TP1 is reached, use PARTIAL_TP1 and set partialClosePercent to 50 unless a different configured partial close is justified.
If TP2 is reached, use decision CLOSE and managementAction TP2_CLOSE.
Comment should be short and practical.`;
  const mime = screenshot.buffer.length >= 8 && screenshot.buffer[0] === 0x89 && screenshot.buffer[1] === 0x50
    ? "image/png" : "image/jpeg";
  const response = await withRetry(
    () => callOpenRouter({
      model: MODEL,
      systemPrompt: "You manage open trades from chart evidence. Answer only with concise JSON. All user-facing text must be Vietnamese with accents.",
      userContent: [
        { type: "image_url", image_url: { url: `data:${mime};base64,${screenshot.buffer.toString("base64")}` } },
        { type: "text", text: prompt },
      ],
      maxTokens: 300,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    }),
    {
      onRetry: (error, attempt, maxAttempts, delayMs) =>
        logger.warn(`  ! OpenRouter position decision temporary error for ${position.pair} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${error instanceof Error ? error.message : error}`),
    },
  );
  void recordOpenRouterUsage(response, { model: MODEL, source: "chart" });
  const parsed = parseDecisionResponse(response.text);
  if (!parsed) throw new Error(`OpenRouter position decision parse failed for model ${MODEL}. Raw: ${response.text.slice(0, 300)}`);
  return parsed;
}
