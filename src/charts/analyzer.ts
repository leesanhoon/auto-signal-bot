import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import type { ScreenshotResult, AnalysisResult, TradeSetup, PairSummary } from "../shared/types.js";

const SYSTEM_PROMPT = `Act as a professional price action trader who follows Bob Volman’s methodology (“Understanding Price Action”) and exclusively analyzes H4 charts with EMA 20. For each instrument provided, deliver a structured report comprising the following sections:

1. **Trend Context** – State whether the market is trending up, down, or ranging, describe price relation to EMA 20 (above/below/crossing), and assess EMA 20’s slope.
2. **EMA 20 Proximity (Primary Factor)** – Quantify distance between price and EMA 20, classify proximity (at EMA, near within 2%, far above 2%), note any pullback or buildup/doji touches increasing confidence, and highlight that if price is far with no pullback, the guidance is to refrain from trading despite other patterns.
3. **Support/Resistance** – Identify nearby S/R levels, round numbers, or accumulation zones being tested or broken.
4. **Volman’s 7 Setups** – Evaluate presence of RB, BB, ARB, FB, SB, DD, IRB patterns relative to EMA 20, indicating which setup is developing and its alignment with current trend.
5. **Three or More Reasons Not to Trade** – List specific concerns (e.g., false break risk, lack of buildup, flat EMA, rejection candles, choppiness, price distant from EMA) that argue against entering.
6. **Conclusion** – Recommend TRADE or NO TRADE, include a confidence percentage, and justify decision. If confidence is below 70%, conclude NO TRADE. Emphasize that only clear setups should trigger entries and urge waiting for pullbacks to EMA 20 before chasing breakouts.

Ensure each section is concise, factual, and consistent with the stated rules (EMA proximities prioritized, pullbacks preferred, no chasing distant breakouts).`;

const USER_PROMPT = `Analyze all attached H4 charts. Return only JSON with two keys: summaries and setups. In summaries include every pair with trend, emaProximity (tại/gần/xa EMA 20), status, and confidence. In setups include only setups with confidence ≥70%; include pair, direction, setup description, emaTouch (true if price at EMA 20), reasons array, risks array, confidence, entry, stopLoss, takeProfit1, takeProfit2, riskReward, and summary. Provide specific price levels from the chart for entry, stopLoss, and takeProfits. Ensure status and setup descriptions reflect actual chart conditions, and omit any surrounding text.`;

function parseAnalysisResponse(text: string): { summaries: PairSummary[]; setups: TradeSetup[]; noSetupReason: string } {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const setups = (parsed.setups || []).filter((s: TradeSetup) => (s.confidence ?? 0) >= 70);
    return {
      summaries: parsed.summaries || [],
      setups,
      noSetupReason: parsed.noSetupReason || "",
    };
  } catch {
    return { summaries: [], setups: [], noSetupReason: "Lỗi parse AI response. Raw: " + text.slice(0, 300) };
  }
}

async function analyzeWithClaude(screenshots: ScreenshotResult[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];
  for (const screenshot of screenshots) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: screenshot.buffer.toString("base64") },
    });
    content.push({
      type: "text",
      text: `[${screenshot.chart.name}]`,
    });
  }
  content.push({ type: "text", text: USER_PROMPT });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    thinking: { type: "enabled", budget_tokens: 4096 },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function analyzeWithGemini(screenshots: ScreenshotResult[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const ai = new GoogleGenAI({ apiKey });
  const prompt = SYSTEM_PROMPT + "\n\n" + USER_PROMPT;

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  for (const screenshot of screenshots) {
    parts.push({
      inlineData: { mimeType: "image/jpeg", data: screenshot.buffer.toString("base64") },
    });
    parts.push({ text: `[${screenshot.chart.name}]` });
  }
  parts.push({ text: prompt });

  const result = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [{ role: "user", parts }],
  });

  return result.text ?? "";
}

function findScreenshotForPair(pair: string, screenshots: ScreenshotResult[]): ScreenshotResult | undefined {
  const normalized = pair.replace("/", "").toUpperCase();
  return screenshots.find((s) => s.chart.symbol.toUpperCase().includes(normalized));
}

async function verifySetupWithClaude(
  setup: TradeSetup,
  screenshot: ScreenshotResult,
): Promise<{ confirmed: boolean; confidence: number; comment: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const userPrompt = `Analyze the described H4 EMA 20 setup for ${setup.pair}, independently applying the Bob Volman framework to assess whether the setup described (Direction: ${setup.direction}, Pattern: ${setup.setup}, Entry: ${setup.entry}, SL: ${setup.stopLoss}, TP1: ${setup.takeProfit1}, TP2: ${setup.takeProfit2}, Confidence proposal: ${setup.confidence}%, Reasons: ${setup.reasons.join("; ")}) is accurate and reliable. Evaluate entry validity, stop placement, structure around EMA 20, and confirm if pullback or price action aligns with Volman’s principles. Return only JSON with keys confirmed (true/false), confidence (0-100), and comment summarizing the analysis and reliability judgment.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: screenshot.buffer.toString("base64") },
          },
          { type: "text", text: userPrompt },
        ],
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);
  return {
    confirmed: Boolean(parsed.confirmed),
    confidence: Number(parsed.confidence) || 0,
    comment: String(parsed.comment || ""),
  };
}

/**
 * Re-checks Gemini's high-confidence (>80%) setups against Claude Sonnet 4.6
 * independently, one chart at a time, so a single bad pair can't sink the rest.
 */
export async function confirmHighConfidenceSetups(
  setups: TradeSetup[],
  screenshots: ScreenshotResult[],
): Promise<TradeSetup[]> {
  const result: TradeSetup[] = [];

  for (const setup of setups) {
    const screenshot = findScreenshotForPair(setup.pair, screenshots);
    if (!screenshot) {
      result.push(setup);
      continue;
    }

    try {
      console.log(`  → Verifying ${setup.pair} with Claude Sonnet 4.6...`);
      const verification = await verifySetupWithClaude(setup, screenshot);
      console.log(
        `  ${verification.confirmed ? "✓" : "✗"} ${setup.pair}: Claude ${verification.confirmed ? "confirmed" : "rejected"} (${verification.confidence}%) — ${verification.comment}`,
      );
      result.push({
        ...setup,
        claudeConfirmed: verification.confirmed,
        claudeConfidence: verification.confidence,
        claudeComment: verification.comment,
      });
    } catch (error) {
      console.warn(
        `  ⚠ Claude verification failed for ${setup.pair}: ${error instanceof Error ? error.message : error}`,
      );
      result.push(setup);
    }
  }

  return result;
}

export async function analyzeAllCharts(
  screenshots: ScreenshotResult[],
): Promise<AnalysisResult> {
  let rawResponse: string;
  let provider: string;

  try {
    console.log("  → Trying Gemini 3.5 Flash...");
    rawResponse = await analyzeWithGemini(screenshots);
    provider = "Gemini 3.5 Flash";
  } catch (geminiError) {
    console.warn(`  ⚠ Gemini failed: ${geminiError instanceof Error ? geminiError.message : geminiError}`);
    console.log("  → Falling back to Claude Sonnet 4.6...");
    rawResponse = await analyzeWithClaude(screenshots);
    provider = "Claude Sonnet 4.6";
  }

  console.log(`  ✓ Analyzed by ${provider}`);

  const { summaries, setups, noSetupReason } = parseAnalysisResponse(rawResponse);
  console.log(`  ✓ ${summaries.length} pairs scanned, ${setups.length} setup(s) ≥70% confidence`);

  return { summaries, setups, noSetupReason, screenshots };
}
