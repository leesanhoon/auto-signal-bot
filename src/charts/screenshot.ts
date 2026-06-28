import { chromium, type BrowserContext } from "playwright";
import { mkdir } from "fs/promises";
import { join } from "path";
import { CHARTS, buildChartHtml } from "./charts.config.js";
import type { ScreenshotResult } from "../shared/types.js";

const SCREENSHOT_DIR = join(process.cwd(), "screenshots");
const VIEWPORT = { width: 1400, height: 900 };
const CHART_LOAD_TIMEOUT = 30_000;
const CHART_RENDER_DELAY = 8_000;
const PARALLEL_TABS = 4;

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
      const batchResults = await Promise.allSettled(
        batch.map((chart) => captureChart(context, chart)),
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
          console.log(`  ✓ Captured: ${r.value.chart.name}`);
        } else {
          console.error(`  ✗ Failed:`, r.reason);
        }
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function captureChart(
  context: BrowserContext,
  chart: (typeof CHARTS)[number],
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

    await page.waitForTimeout(CHART_RENDER_DELAY);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${chart.symbol.replace(/[:/]/g, "_")}_${timestamp}.jpg`;
    const filepath = join(SCREENSHOT_DIR, filename);

    const buffer = await page.screenshot({
      path: filepath,
      fullPage: false,
      type: "jpeg",
      quality: 75,
    });

    return { chart, buffer: Buffer.from(buffer), filepath };
  } finally {
    await page.close();
  }
}
