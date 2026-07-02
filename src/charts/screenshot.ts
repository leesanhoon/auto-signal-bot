import { chromium, type BrowserContext } from "playwright";
import { mkdir } from "fs/promises";
import { join } from "path";
import { CHARTS, buildChartHtml } from "./charts.config.js";
import type { ChartTimeframe, ScreenshotResult } from "./chart-types.js";
import { createLogger } from "../shared/logger.js";

const SCREENSHOT_DIR = join(process.cwd(), "screenshots");
const VIEWPORT = { width: 1400, height: 900 };
const CHART_LOAD_TIMEOUT = 30_000;
const CHART_RENDER_DELAY = 4_000;
const PARALLEL_TABS = 8;
const logger = createLogger("charts:screenshot");

function getTimeframeRank(timeframe: ChartTimeframe): number {
  switch (timeframe) {
    case "D1":
      return 0;
    case "H4":
      return 1;
    case "M15":
      return 2;
  }
}

export function findChartForPair(pair: string, preferredTimeframe: ChartTimeframe = "H4") {
  const normalized = pair.replace("/", "").toUpperCase();
  const matches = CHARTS.filter((chart) => chart.symbol.toUpperCase().includes(normalized));
  if (matches.length === 0) {
    return undefined;
  }

  return (
    matches.find((chart) => chart.timeframe === preferredTimeframe) ??
    matches.find((chart) => chart.timeframe === "H4") ??
    matches.sort((left, right) => getTimeframeRank(left.timeframe) - getTimeframeRank(right.timeframe))[0]
  );
}

type CaptureOptions = {
  viewport?: { width: number; height: number };
  renderDelayMs?: number;
  quality?: number;
};

export async function captureAllCharts(): Promise<ScreenshotResult[]> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results: ScreenshotResult[] = [];

  try {
    const context = await browser.newContext({ viewport: VIEWPORT });

    for (let i = 0; i < CHARTS.length; i += PARALLEL_TABS) {
      const batch = CHARTS.slice(i, i + PARALLEL_TABS);
      const batchResults = await Promise.allSettled(batch.map((chart) => captureChart(context, chart)));

      for (const r of batchResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
          logger.info("Captured chart", { chart: r.value.chart.name });
        } else {
          logger.error("Failed to capture chart", { error: r.reason });
        }
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

export async function captureChartScreenshot(
  chart: (typeof CHARTS)[number],
  options: CaptureOptions = {},
): Promise<ScreenshotResult> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({ viewport: options.viewport ?? VIEWPORT });
    return await captureChart(context, chart, options);
  } finally {
    await browser.close();
  }
}

export async function captureVerificationChartScreenshot(chart: (typeof CHARTS)[number]): Promise<ScreenshotResult> {
  return captureChartScreenshot(chart, {
    viewport: { width: 1200, height: 750 },
    renderDelayMs: 5_000,
    quality: 55,
  });
}

async function captureChart(
  context: BrowserContext,
  chart: (typeof CHARTS)[number],
  options: CaptureOptions = {},
): Promise<ScreenshotResult> {
  const page = await context.newPage();
  const html = buildChartHtml(chart);

  try {
    await page.setContent(html, { waitUntil: "networkidle", timeout: CHART_LOAD_TIMEOUT });

    const frame = await page.waitForSelector("iframe", { timeout: CHART_LOAD_TIMEOUT });
    if (frame) {
      const contentFrame = await frame.contentFrame();
      if (contentFrame) {
        await contentFrame.waitForSelector("canvas", { timeout: CHART_LOAD_TIMEOUT });
      }
    }

    await page.waitForTimeout(options.renderDelayMs ?? CHART_RENDER_DELAY);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${chart.symbol.replace(/[:/]/g, "_")}_${chart.timeframe}_${timestamp}.jpg`;
    const filepath = join(SCREENSHOT_DIR, filename);

    const buffer = await page.screenshot({
      path: filepath,
      fullPage: false,
      type: "jpeg",
      quality: options.quality ?? 75,
    });

    return { chart, buffer: Buffer.from(buffer), filepath };
  } finally {
    await page.close();
  }
}
