import { GoogleGenAI } from "@google/genai";
import type { ScreenshotResult } from "../shared/types.js";
import { getClaudeClient, extractTextFromClaudeResponse } from "../shared/claude.js";
import { withRetry } from "../shared/retry.js";
import type { OpenPosition } from "./positions-repository.js";
import { getVerifyProvider } from "./verify-provider.js";
import { createLogger } from "../shared/logger.js";
import { withConfiguredRateLimit } from "../shared/rate-limit.js";

const logger = createLogger("charts:position-decision");
const GEMINI_RATE_LIMIT = {
  key: "gemini",
  envVar: "GEMINI_RATE_LIMIT_RPM",
  defaultRpm: 15,
};
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }
  return new GoogleGenAI({ apiKey });
}

export function buildGenerationConfig(model: string, maxOutputTokens: number) {
  const config: {
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    responseMimeType: "application/json";
    thinkingConfig?: { thinkingBudget: number };
  } = {
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens,
    responseMimeType: "application/json",
  };

  if (model !== "gemini-2.5-pro") {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  return config;
}

export function cleanResponse(text: string): string {
  return text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

export function extractJsonObject(text: string): string {
  const cleaned = cleanResponse(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }
  return cleaned;
}

export function clampConfidence(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function parseDecisionResponse(
  text: string,
): { decision: "HOLD" | "CLOSE" | "STOP"; confidence: number; comment: string } | null {
  const cleaned = extractJsonObject(text);
  try {
    const parsed = JSON.parse(cleaned) as Partial<{ decision: string; confidence: number; comment: string }>;
    const decision = parsed.decision === "CLOSE" || parsed.decision === "STOP" ? parsed.decision : "HOLD";
    return {
      decision,
      confidence: clampConfidence(parsed.confidence),
      comment: String(parsed.comment || ""),
    };
  } catch {
    return null;
  }
}

async function decidePositionWithClaude(
  position: OpenPosition,
  screenshot: ScreenshotResult,
): Promise<{ decision: "HOLD" | "CLOSE" | "STOP"; confidence: number; comment: string }> {
  const ai = getClaudeClient();

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

Return only JSON with keys decision, confidence, comment.
decision must be one of HOLD, CLOSE, STOP.
Comment should be short and practical.`;

  const request = () =>
    ai.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      temperature: 0.2,
      system: "You manage open trades from chart evidence. Answer only with concise JSON.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: screenshot.buffer.toString("base64"),
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

  const response = await withRetry(request, {
    onRetry: (error, attempt, maxAttempts, delayMs) => {
      logger.warn(
        `  ! Claude position decision temporary error for ${position.pair} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
          error instanceof Error ? error.message : error
        }`,
      );
    },
  });

  const parsed = parseDecisionResponse(extractTextFromClaudeResponse(response as { content?: Array<{ type: string; text?: string }> }));
  if (!parsed) {
    throw new Error("Claude position decision parse failed");
  }
  return parsed;
}

async function decidePositionWithGemini(
  position: OpenPosition,
  screenshot: ScreenshotResult,
): Promise<{ decision: "HOLD" | "CLOSE" | "STOP"; confidence: number; comment: string }> {
  const ai = getClient();
  const model = "gemini-2.5-pro";

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

Return only JSON with keys decision, confidence, comment.
decision must be one of HOLD, CLOSE, STOP.
Comment should be short and practical.`;

  const request = () =>
    withConfiguredRateLimit(GEMINI_RATE_LIMIT, async () =>
      ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: screenshot.buffer.toString("base64"),
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: buildGenerationConfig(model, 300),
      }),
    );

  const response = await withRetry(request, {
    onRetry: (error, attempt, maxAttempts, delayMs) => {
      logger.warn(
        `  ! Gemini position decision temporary error for ${position.pair} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
          error instanceof Error ? error.message : error
        }`,
      );
    },
  });

  const parsed = parseDecisionResponse(response.text ?? "");
  if (!parsed) {
    throw new Error(`Gemini position decision parse failed for model ${model}. Raw: ${(response.text ?? "").slice(0, 300)}`);
  }
  return parsed;
}

export async function decidePosition(
  position: OpenPosition,
  screenshot: ScreenshotResult,
): Promise<{ decision: "HOLD" | "CLOSE" | "STOP"; confidence: number; comment: string }> {
  const provider = getVerifyProvider();
  return provider === "claude"
    ? decidePositionWithClaude(position, screenshot)
    : decidePositionWithGemini(position, screenshot);
}

export { decidePositionWithClaude };


