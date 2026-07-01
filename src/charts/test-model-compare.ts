import "../shared/env.js";
import { readFile, readdir } from "fs/promises";
import { extname, join } from "path";
import { GoogleGenAI } from "@google/genai";
import { analyzeAllCharts, buildVerificationPrompt, verifySetupWithGeminiModel } from "./analyzer.js";
import { extractTextFromClaudeResponse, getClaudeClient } from "../shared/claude.js";
import { withRetry } from "../shared/retry.js";
import type { ChartConfig, ScreenshotResult, TradeSetup } from "../shared/types.js";
import { createLogger } from "../shared/logger.js";
import { withConfiguredRateLimit } from "../shared/rate-limit.js";

const logger = createLogger("charts:test-model-compare");
const TEST_DIR = join(process.cwd(), "test-charts");
const GEMINI_PRO_MODEL = "gemini-2.5-pro";
const GEMINI_FLASH_MODEL = "gemini-3.5-flash";
const GEMINI_RATE_LIMIT = {
  key: "gemini",
  envVar: "GEMINI_RATE_LIMIT_RPM",
  defaultRpm: 15,
};

type VerifyResult = { confirmed: boolean; confidence: number; comment: string };
type VerifyFailure = { error: string };
type CompareResult = VerifyResult | VerifyFailure;
type CompareRow = [string, () => Promise<VerifyResult>];

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenAI({ apiKey });
}

function cleanResponse(text: string): string {
  return text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function extractJsonObject(text: string): string {
  const cleaned = cleanResponse(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }
  return cleaned;
}

function clampConfidence(value: unknown): number {
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

function parseVerificationResponse(text: string): VerifyResult | null {
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

async function readFixtures(): Promise<ScreenshotResult[]> {
  const files = (await readdir(TEST_DIR))
    .filter((file) => [".png", ".jpg", ".jpeg"].includes(extname(file).toLowerCase()))
    .sort();

  if (files.length === 0) {
    throw new Error(`No images found in ${TEST_DIR}`);
  }

  const screenshots: ScreenshotResult[] = [];
  for (const file of files) {
    const filepath = join(TEST_DIR, file);
    const buffer = await readFile(filepath);
    const name = file.replace(extname(file), "").replace(/[-_]/g, " ");
    const chart: ChartConfig = {
      name,
      symbol: name,
      interval: "240",
      description: `Fixture - ${name}`,
    };
    screenshots.push({ chart, buffer: Buffer.from(buffer), filepath });
  }

  return screenshots;
}

async function verifyWithClaude(setup: TradeSetup, imageBuffer: Buffer): Promise<VerifyResult> {
  const ai = getClaudeClient();
  const prompt = buildVerificationPrompt(setup);

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
                media_type: detectImageMimeType(imageBuffer),
                data: imageBuffer.toString("base64"),
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
        `  ! Claude compare temporary error (${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
          error instanceof Error ? error.message : error
        }`,
      );
    },
  });

  const rawText = extractTextFromClaudeResponse(response as { content?: Array<{ type: string; text?: string }> });
  const parsed = parseVerificationResponse(rawText);
  if (!parsed) {
    throw new Error(`Claude verify parse failed. Raw: ${rawText.slice(0, 300)}`);
  }

  return parsed;
}

async function verifyGeminiModel(model: string, setup: TradeSetup, imageBuffer: Buffer): Promise<VerifyResult> {
  return withConfiguredRateLimit(GEMINI_RATE_LIMIT, async () =>
    verifySetupWithGeminiModel(setup, imageBuffer, model, getGeminiClient()),
  );
}

function formatRow(model: string, elapsedMs: number, result: CompareResult): string {
  if ("error" in result) {
    return `${model.padEnd(18)} | ${String(elapsedMs).padStart(7)} | ERROR     | ---        | ${result.error}`;
  }

  return `${model.padEnd(18)} | ${String(elapsedMs).padStart(7)} | ${String(result.confirmed).padEnd(9)} | ${String(result.confidence).padEnd(10)} | ${result.comment}`;
}

async function compareForScreenshot(screenshot: ScreenshotResult): Promise<void> {
  logger.info(`\nFixture: ${screenshot.filepath}`);

  const analysis = await analyzeAllCharts([screenshot]);
  if (analysis.setups.length === 0) {
    logger.info("No setup >=70% found from Gemini 3.5 Flash analysis. Skipping compare.");
    if (analysis.noSetupReason) {
      logger.info(`Reason: ${analysis.noSetupReason}`);
    }
    return;
  }

  const setup = analysis.setups[0];
  logger.info(`Candidate setup: ${setup.pair} | ${setup.direction} | ${setup.setup} | ${setup.confidence}%`);

  const rows: CompareRow[] = [
    ["Gemini 2.5 Pro", () => verifyGeminiModel(GEMINI_PRO_MODEL, setup, screenshot.buffer)],
    ["Gemini 3.5 Flash", () => verifyGeminiModel(GEMINI_FLASH_MODEL, setup, screenshot.buffer)],
    ["Claude Sonnet 4.6", () => verifyWithClaude(setup, screenshot.buffer)],
  ];

  logger.info("\nmodel              | time(ms) | confirmed | confidence | comment");
  logger.info("-------------------|----------|-----------|------------|--------");

  for (const [label, fn] of rows) {
    const started = Date.now();
    try {
      const result = await fn();
      logger.info(formatRow(label, Date.now() - started, result));
    } catch (error) {
      logger.info(
        formatRow(label, Date.now() - started, {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

async function main(): Promise<void> {
  logger.info("Chart model compare test\n");
  const screenshots = await readFixtures();

  for (const screenshot of screenshots) {
    await compareForScreenshot(screenshot);
  }
}

main().catch((error) => {
  logger.error("Error:", error);
  process.exit(1);
});


