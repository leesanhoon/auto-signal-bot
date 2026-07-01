import { GoogleGenAI } from "@google/genai";
import type { AnalysisResult, PairSummary, ScreenshotResult, TradeSetup } from "../shared/types.js";
import { extractTextFromClaudeResponse, getClaudeClient } from "../shared/claude.js";
import { withRetry } from "../shared/retry.js";
import { captureVerificationChartScreenshot, findChartForPair } from "./screenshot.js";
import { createLogger } from "../shared/logger.js";
import { withConfiguredRateLimit } from "../shared/rate-limit.js";

const logger = createLogger("charts:analyzer");
const VERIFY_MODEL_PRIMARY = "gemini-2.5-pro";
const ANALYSIS_MODEL = "gemini-3.5-flash";
const GEMINI_RATE_LIMIT = {
  key: "gemini",
  envVar: "GEMINI_RATE_LIMIT_RPM",
  defaultRpm: 15,
};

type VerificationResult = {
  confirmed: boolean;
  confidence: number;
  comment: string;
  verifiedBy: string;
};

const SYSTEM_PROMPT = `Act as a professional price action trader who follows Bob Volman's methodology ("Understanding Price Action") and exclusively analyzes H4 charts with EMA 20. For each instrument provided, deliver a structured report comprising the following sections:

1. Trend Context - State whether the market is trending up, down, or ranging, describe price relation to EMA 20 (above/below/crossing), and assess EMA 20's slope.
2. EMA 20 Proximity (Primary Factor) - Quantify distance between price and EMA 20, classify proximity (at EMA, near within 2%, far above 2%), note any pullback or buildup/doji touches increasing confidence, and highlight that if price is far with no pullback, the guidance is to refrain from trading despite other patterns.
3. Support/Resistance - Identify nearby S/R levels, round numbers, or accumulation zones being tested or broken.
4. Volman's 7 Setups - Evaluate presence of RB, BB, ARB, FB, SB, DD, IRB patterns relative to EMA 20, indicating which setup is developing and its alignment with current trend.
5. Three or More Reasons Not to Trade - List specific concerns (e.g. false break risk, lack of buildup, flat EMA, rejection candles, choppiness, price distant from EMA) that argue against entering.
6. Conclusion - Recommend TRADE or NO TRADE, include a confidence percentage, and justify decision. If confidence is below 70%, conclude NO TRADE. Emphasize that only clear setups should trigger entries and urge waiting for pullbacks to EMA 20 before chasing breakouts.

Ensure each section is concise, factual, and consistent with the stated rules (EMA proximities prioritized, pullbacks preferred, no chasing distant breakouts).`;

const USER_PROMPT = `Analyze all attached H4 charts. Return only JSON with two keys: summaries and setups. In summaries include every pair with trend, emaProximity (tại/gần/xa EMA 20), status, and confidence. In setups include only setups with confidence >=70%; include pair, direction, setup description, emaTouch (true if price at EMA 20), reasons array, risks array, confidence, entry, stopLoss, takeProfit1, takeProfit2, riskReward, and summary. Provide specific price levels from the chart for entry, stopLoss, and takeProfits. Ensure status and setup descriptions reflect actual chart conditions, and omit any surrounding text.`;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenAI({ apiKey });
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

function detectImageMimeType(buffer: Buffer): "image/png" | "image/jpeg" {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  return "image/jpeg";
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

  if (model === VERIFY_MODEL_PRIMARY) {
    config.maxOutputTokens = Math.max(maxOutputTokens, 900);
    config.thinkingConfig = { thinkingBudget: 128 };
  } else {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  return config;
}

export function parseAnalysisResponse(text: string): { summaries: PairSummary[]; setups: TradeSetup[]; noSetupReason: string } {
  const cleaned = extractJsonObject(text);
  try {
    const parsed = JSON.parse(cleaned) as Partial<{ summaries: PairSummary[]; setups: TradeSetup[]; noSetupReason: string }>;
    const setups = (parsed.setups || []).filter((s) => (s.confidence ?? 0) >= 70);
    return {
      summaries: parsed.summaries || [],
      setups,
      noSetupReason: parsed.noSetupReason || "",
    };
  } catch {
    return { summaries: [], setups: [], noSetupReason: "Failed to parse AI response. Raw: " + text.slice(0, 300) };
  }
}

function parseVerificationResponse(text: string): VerificationResult | null {
  const cleaned = extractJsonObject(text);

  try {
    const parsed = JSON.parse(cleaned) as { confirmed?: unknown; confidence?: unknown; comment?: unknown };
    return {
      confirmed: Boolean(parsed.confirmed),
      confidence: clampConfidence(parsed.confidence),
      comment: String(parsed.comment || ""),
      verifiedBy: "",
    };
  } catch {
    return null;
  }
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

async function analyzeWithGemini(screenshots: ScreenshotResult[]): Promise<string> {
  const ai = getClient();
  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  for (const screenshot of screenshots) {
    parts.push({
      inlineData: { mimeType: detectImageMimeType(screenshot.buffer), data: screenshot.buffer.toString("base64") },
    });
    parts.push({ text: `[${screenshot.chart.name}]` });
  }
  parts.push({ text: SYSTEM_PROMPT + "\n\n" + USER_PROMPT });

  const request = () =>
    withConfiguredRateLimit(GEMINI_RATE_LIMIT, async () =>
      ai.models.generateContent({
        model: ANALYSIS_MODEL,
        contents: [{ role: "user", parts }],
        config: buildGenerationConfig(ANALYSIS_MODEL, 4000),
      }),
    );

  const result = await withRetry(request, {
    onRetry: (error, attempt, maxAttempts, delayMs) => {
      logger.warn(
        `  ! Gemini main analysis temporary error (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
          error instanceof Error ? error.message : error
        }`,
      );
    },
  });

  return result.text ?? "";
}

async function verifySetupWithClaude(
  setup: TradeSetup,
  chart: NonNullable<ReturnType<typeof findChartForPair>>,
): Promise<VerificationResult> {
  const ai = getClaudeClient();
  const verificationChart = await captureVerificationChartScreenshot(chart);
  const userPrompt = buildVerificationPrompt(setup);

  const request = () =>
    ai.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      temperature: 0.2,
      system: "You verify chart setups. Answer only with concise JSON.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: detectImageMimeType(verificationChart.buffer),
                data: verificationChart.buffer.toString("base64"),
              },
            },
            { type: "text", text: userPrompt },
          ],
        },
      ],
    });

  const result = await withRetry(request, {
    onRetry: (error, attempt, maxAttempts, delayMs) => {
      logger.warn(
        `  ! Claude verify temporary error for ${setup.pair} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
          error instanceof Error ? error.message : error
        }`,
      );
    },
  });

  const cleaned = extractJsonObject(
    extractTextFromClaudeResponse(result as { content?: Array<{ type: string; text?: string }> }),
  );
  const parsed = JSON.parse(cleaned) as Partial<{ confirmed: boolean; confidence: number; comment: string }>;
  return {
    confirmed: Boolean(parsed.confirmed),
    confidence: clampConfidence(parsed.confidence),
    comment: String(parsed.comment || ""),
    verifiedBy: "claude-sonnet-4-6",
  };
}

export async function verifySetupWithGeminiModel(
  setup: TradeSetup,
  imageBuffer: Buffer,
  model: string,
  ai: GoogleGenAI = getClient(),
): Promise<VerificationResult> {
  const userPrompt = buildVerificationPrompt(setup);

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
                  mimeType: detectImageMimeType(imageBuffer),
                  data: imageBuffer.toString("base64"),
                },
              },
              { text: userPrompt },
            ],
          },
        ],
        config: buildGenerationConfig(model, 500),
      }),
    );

  const result = await withRetry(request, {
    onRetry: (error, attempt, maxAttempts, delayMs) => {
      logger.warn(
        `  ! Gemini verify temporary error with ${model} for ${setup.pair} (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
          error instanceof Error ? error.message : error
        }`,
      );
    },
  });

  const parsed = parseVerificationResponse(result.text ?? "");
  if (!parsed) {
    throw new Error(`Gemini verify parse failed for model ${model}. Raw: ${(result.text ?? "").slice(0, 300)}`);
  }

  return {
    ...parsed,
    verifiedBy: model,
  };
}

async function verifySetupWithGemini(
  setup: TradeSetup,
  chart: NonNullable<ReturnType<typeof findChartForPair>>,
): Promise<VerificationResult> {
  const verificationChart = await captureVerificationChartScreenshot(chart);

  try {
    return await verifySetupWithGeminiModel(setup, verificationChart.buffer, VERIFY_MODEL_PRIMARY);
  } catch (primaryError) {
    logger.warn(
      `  ! Gemini verify failed with ${VERIFY_MODEL_PRIMARY} for ${setup.pair}, falling back to Claude Sonnet 4.6: ${
        primaryError instanceof Error ? primaryError.message : primaryError
      }`,
    );
    return await verifySetupWithClaude(setup, chart);
  }
}

/**
 * Re-checks high-confidence (>80%) setups against the configured verify provider independently,
 * one chart at a time, so a single bad pair can't sink the rest.
 */
export async function confirmHighConfidenceSetups(
  setups: TradeSetup[],
  screenshots: ScreenshotResult[],
): Promise<TradeSetup[]> {
  const result: TradeSetup[] = [];

  for (const setup of setups) {
    const chart = findChartForPair(setup.pair);
    const screenshot = chart ? screenshots.find((s) => s.chart.symbol === chart.symbol) : undefined;
    if (!screenshot || !chart) {
      result.push(setup);
      continue;
    }

    try {
      logger.info(`  -> Verifying ${setup.pair} with Gemini 2.5 Pro (fallback Claude Sonnet 4.6)...`);
      const verification = await verifySetupWithGemini(setup, chart);
      logger.info(
        `  ${verification.confirmed ? "✓" : "✗"} ${setup.pair}: ${verification.verifiedBy} ${
          verification.confirmed ? "confirmed" : "rejected"
        } (${verification.confidence}%) - ${verification.comment}`,
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

export async function analyzeAllCharts(screenshots: ScreenshotResult[]): Promise<AnalysisResult> {
  logger.info("  -> Trying Gemini 3.5 Flash...");
  const rawResponse = await analyzeWithGemini(screenshots);
  logger.info("  ✓ Analyzed by Gemini 3.5 Flash");

  const { summaries, setups, noSetupReason } = parseAnalysisResponse(rawResponse);
  logger.info(`  ✓ ${summaries.length} pairs scanned, ${setups.length} setup(s) >=70% confidence`);

  return { summaries, setups, noSetupReason, screenshots };
}


