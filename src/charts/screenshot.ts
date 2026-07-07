import { chromium, type BrowserContext, type Frame } from "playwright";
import { mkdir } from "fs/promises";
import { join } from "path";
import { CHARTS, buildChartHtml, getChartsForTimeframeMode } from "./charts.config.js";
import type { ChartTimeframeMode } from "./chart-config-env.js";
import type { CandleRangeStats, ChartTimeframe, ScreenshotResult } from "./chart-types.js";
import { createLogger } from "../shared/logger.js";

const SCREENSHOT_DIR = join(process.cwd(), "screenshots");
const VIEWPORT = { width: 1400, height: 900 };
const CHART_LOAD_TIMEOUT = 30_000;
const CHART_PRICE_POLL_INTERVAL = 500;
const CHART_PRICE_STABLE_READS = 2;
const CHART_PRICE_TIMEOUT = 8_000;
const CHART_FALLBACK_RENDER_DELAY = 3_000;
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
  priceTimeoutMs?: number;
  quality?: number;
};

const FALLBACK_SYMBOLS: Record<string, string> = {
  "OANDA:EURUSD": "EURUSD=X",
  "OANDA:GBPUSD": "GBPUSD=X",
  "OANDA:USDJPY": "USDJPY=X",
  "OANDA:AUDUSD": "AUDUSD=X",
  "OANDA:USDCHF": "USDCHF=X",
  "OANDA:USDCAD": "USDCAD=X",
  "OANDA:NZDUSD": "NZDUSD=X",
  "OANDA:XAUUSD": "GC=F",
  "OANDA:XAGUSD": "SI=F",
};

function parsePriceText(value: string): number | null {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function extractLegendPriceText(text: string): string | null {
  const normalized = text.replace(/\r/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const cIndex = lines.findIndex((line) => line === "C");
  if (cIndex !== -1) {
    const candidate = lines[cIndex + 1];
    if (candidate && /^[0-9][0-9,]*(?:\.[0-9]+)?$/.test(candidate)) {
      return candidate.replace(/,/g, "");
    }
  }

  const inline = normalized.match(/\bC\b\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (inline?.[1]) {
    return inline[1].replace(/,/g, "");
  }

  return null;
}

async function readLegendLastPriceText(frame: Frame): Promise<string | null> {
  const text = await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  if (!text.trim()) {
    return null;
  }

  return extractLegendPriceText(text);
}

async function fetchFallbackLastPrice(symbol: string): Promise<number | null> {
  const fallbackSymbol = FALLBACK_SYMBOLS[symbol];
  if (!fallbackSymbol) {
    return null;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(fallbackSymbol)}?interval=2m&range=1d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const closes = payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const lastClose = [...closes].reverse().find((value) => typeof value === "number" && Number.isFinite(value));
  return typeof lastClose === "number" ? lastClose : null;
}

export async function fetchCandleRangeStats(symbol: string, sinceMs: number): Promise<CandleRangeStats | null> {
  const fallbackSymbol = FALLBACK_SYMBOLS[symbol];
  if (!fallbackSymbol) {
    return null;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(fallbackSymbol)}?interval=2m&range=1d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!quote) {
    return null;
  }

  const timestamps = result?.timestamp ?? [];
  const highs = quote.high ?? [];
  const lows = quote.low ?? [];
  const closes = quote.close ?? [];

  // Yahoo Finance trả timestamp ở đơn vị epoch-seconds
  // Chuyển sinceMs về seconds để so sánh
  const sinceSec = Math.floor(sinceMs / 1000);

  // Nếu không có timestamp, không thể lọc theo sinceMs — trả null để fallback về AI vision
  if (timestamps.length === 0) {
    return null;
  }

  // Nếu timestamps không khớp độ dài với highs/lows → dữ liệu không nhất quán, trả null
  if (timestamps.length !== highs.length) {
    return null;
  }

  // Lọc chỉ giữ các nến có timestamp >= sinceMs
  const filteredHighs: number[] = [];
  const filteredLows: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (timestamps[i] < sinceSec) {
      continue;
    }
    const h = highs[i];
    const l = lows[i];
    if (typeof h === "number" && Number.isFinite(h)) {
      filteredHighs.push(h);
    }
    if (typeof l === "number" && Number.isFinite(l)) {
      filteredLows.push(l);
    }
  }

  if (filteredHighs.length === 0 || filteredLows.length === 0) {
    return null;
  }

  const high = Math.max(...filteredHighs);
  const low = Math.min(...filteredLows);

  // lastClose lấy từ toàn bộ mảng gốc (giá đóng cửa gần nhất luôn có nghĩa)
  const lastClose = [...closes].reverse().find((value) => typeof value === "number" && Number.isFinite(value));

  return {
    high,
    low,
    lastClose: typeof lastClose === "number" ? lastClose : null,
  };
}

async function resolveLastPrice(
  page: import("playwright").Page,
  frame: Frame,
  chart: (typeof CHARTS)[number],
  timeoutMs: number,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  let lastText: string | null = null;
  let stableReads = 0;

  while (Date.now() < deadline) {
    const text = await readLegendLastPriceText(frame);
    if (text && text === lastText) {
      stableReads += 1;
      if (stableReads >= CHART_PRICE_STABLE_READS) {
        return parsePriceText(text);
      }
    } else if (text) {
      lastText = text;
      stableReads = 1;
    } else {
      stableReads = 0;
    }

    await page.waitForTimeout(CHART_PRICE_POLL_INTERVAL);
  }

  if (lastText) {
    const parsed = parsePriceText(lastText);
    if (parsed !== null) {
      return parsed;
    }
  }

  return fetchFallbackLastPrice(chart.symbol);
}

function buildScreenshotPath(chart: (typeof CHARTS)[number]): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${chart.symbol.replace(/[:/]/g, "_")}_${chart.timeframe}_${timestamp}.jpg`;
  return join(SCREENSHOT_DIR, filename);
}

async function capturePageScreenshot(
  page: import("playwright").Page,
  chart: (typeof CHARTS)[number],
  quality: number,
  lastPrice: number | null,
): Promise<ScreenshotResult> {
  const filepath = buildScreenshotPath(chart);
  const buffer = await page.screenshot({
    path: filepath,
    fullPage: false,
    type: "jpeg",
    quality,
  });

  return { chart, buffer: Buffer.from(buffer), filepath, lastPrice };
}

export async function captureAllCharts(
  chartTimeframeMode: ChartTimeframeMode = "multi",
  primaryTimeframe: ChartTimeframe = "M15",
): Promise<ScreenshotResult[]> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results: ScreenshotResult[] = [];

  try {
    const context = await browser.newContext({ viewport: VIEWPORT });

    const runtimeCharts = getChartsForTimeframeMode(chartTimeframeMode, primaryTimeframe);
    for (let i = 0; i < runtimeCharts.length; i += PARALLEL_TABS) {
      const batch = runtimeCharts.slice(i, i + PARALLEL_TABS);
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
    priceTimeoutMs: 5_000,
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
        const lastPrice = await resolveLastPrice(
          page,
          contentFrame,
          chart,
          options.priceTimeoutMs ?? CHART_PRICE_TIMEOUT,
        );
        return await capturePageScreenshot(page, chart, options.quality ?? 75, lastPrice);
      }
    }

    await page.waitForTimeout(CHART_FALLBACK_RENDER_DELAY);
    return await capturePageScreenshot(page, chart, options.quality ?? 75, null);
  } finally {
    await page.close();
  }
}
