import type { Candle } from "./ohlc-provider.js";
import type { ChartContext } from "../model/chart-types-volman.js";
import { chromium, type Browser } from "playwright";
import { createLogger } from "../../shared/infra/logger.js";

const logger = createLogger("charts:setup-chart-renderer");

export function getPlaywrightDiagnostics(): string {
  const browsersPath =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    "(không set — dùng default cache path)";

  let executablePath: string;
  try {
    executablePath = chromium.executablePath();
  } catch (error) {
    executablePath = `lỗi lấy path: ${error instanceof Error ? error.message : String(error)}`;
  }

  return `PLAYWRIGHT_BROWSERS_PATH=${browsersPath}\nchromium.executablePath=${executablePath}`;
}

export type SetupChartInput = {
  pair: string;
  setup: string;
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  livePrice?: number | null;
  chartContext: ChartContext;
};

interface CoordMap {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  chartWidth: number;
  chartHeight: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
}

function buildCoordMap(
  candles: Candle[],
  stopLoss: number,
  takeProfit: number,
  livePrice: number | null,
): CoordMap {
  const marginLeft = 40;
  // 110px để label giá bên phải (font-size 10, dài nhất ~"Entry 64210.00000" ≈ 95px)
  // nằm trọn trong viewBox 900px — 40px cũ làm chữ bị cắt ở mép phải.
  const marginRight = 110;
  const marginTop = 40;
  const marginBottom = 40;
  const chartWidth = 900 - marginLeft - marginRight;
  const chartHeight = 500 - marginTop - marginBottom;

  const priceInputs = [
    ...candles.map((c) => c.low),
    ...candles.map((c) => c.high),
    stopLoss,
    takeProfit,
    ...(livePrice !== null && Number.isFinite(livePrice) ? [livePrice] : []),
  ];
  let minPrice = Math.min(...priceInputs);
  let maxPrice = Math.max(...priceInputs);

  // Add 5% padding
  const padding = (maxPrice - minPrice) * 0.05;
  minPrice -= padding;
  maxPrice += padding;

  return {
    minX: 0,
    maxX: candles.length - 1,
    minY: minPrice,
    maxY: maxPrice,
    chartWidth,
    chartHeight,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
  };
}

function mapXCoord(index: number, coord: CoordMap): number {
  if (coord.maxX === coord.minX) return coord.marginLeft;
  const normalized = (index - coord.minX) / (coord.maxX - coord.minX);
  return coord.marginLeft + normalized * coord.chartWidth;
}

function mapYCoord(price: number, coord: CoordMap): number {
  if (coord.maxY === coord.minY) return coord.marginTop;
  const normalized = (price - coord.minY) / (coord.maxY - coord.minY);
  // Y is inverted (low price is at bottom)
  return coord.marginTop + coord.chartHeight - normalized * coord.chartHeight;
}

export function buildSetupChartSvg(input: SetupChartInput): string {
  const {
    pair,
    setup,
    direction,
    entry,
    stopLoss,
    takeProfit,
    livePrice,
    chartContext,
  } = input;
  const { candles, ma21, sliceStartIndex, geometry } = chartContext;

  const coord = buildCoordMap(candles, stopLoss, takeProfit, livePrice ?? null);

  let svg = `<svg viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg" style="font-family:Arial,sans-serif">`;

  // Background
  svg += `<defs><linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#b8bcc4"/>
    <stop offset="100%" stop-color="#8f95a0"/>
  </linearGradient></defs>`;
  svg += `<rect width="900" height="500" fill="url(#bgGrad)"/>`;

  // Draw geometry boxes (outer first, then inner)
  if (geometry?.boxes) {
    const boxes = geometry.boxes;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const box = boxes[i];
      const boxStartIndex = box.startIndex - sliceStartIndex;
      const boxEndIndex = box.endIndex - sliceStartIndex;

      const x1 = mapXCoord(boxStartIndex, coord);
      const x2 = mapXCoord(boxEndIndex, coord);
      const y1 = mapYCoord(box.high, coord);
      const y2 = mapYCoord(box.low, coord);

      svg += `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(
        x2 - x1,
      )}" height="${Math.abs(y2 - y1)}" fill="none" stroke="#000000" stroke-width="1.5"/>`;
    }
  }

  // Draw candlesticks
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const xCenter = mapXCoord(i, coord);
    const yHigh = mapYCoord(candle.high, coord);
    const yLow = mapYCoord(candle.low, coord);
    const yOpen = mapYCoord(candle.open, coord);
    const yClose = mapYCoord(candle.close, coord);

    const isUp = candle.close >= candle.open;
    const candleColor = "#000000";
    const bodyColor = isUp ? "#FFFFFF" : "#000000";

    // Wick
    svg += `<line x1="${xCenter}" y1="${yHigh}" x2="${xCenter}" y2="${yLow}" stroke="${candleColor}" stroke-width="0.5"/>`;

    // Body
    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.abs(yClose - yOpen);
    const bodyWidth = 8;
    svg += `<rect x="${xCenter - bodyWidth / 2}" y="${bodyTop}" width="${bodyWidth}" height="${bodyHeight || 1}" fill="${bodyColor}" stroke="${candleColor}" stroke-width="0.5"/>`;
  }

  // Highlight candles that are significant to the setup pattern
  if (geometry?.highlightCandles) {
    for (const h of geometry.highlightCandles) {
      const idx = h.index - sliceStartIndex;
      if (idx < 0 || idx >= candles.length) continue;
      const candle = candles[idx];
      const xCenter = mapXCoord(idx, coord);
      const yHigh = mapYCoord(candle.high, coord);
      const yLow = mapYCoord(candle.low, coord);
      svg += `<rect x="${xCenter - 8}" y="${yHigh - 4}" width="16" height="${
        yLow - yHigh + 8
      }" fill="none" stroke="#FFB300" stroke-width="1.5" rx="3"/>`;
    }
  }

  // Draw EMA21
  if (ma21 && ma21.length > 0) {
    let emaPath = "M";
    let firstPoint = true;
    for (let i = 0; i < ma21.length; i++) {
      if (ma21[i] !== null) {
        const x = mapXCoord(i, coord);
        const y = mapYCoord(ma21[i]!, coord);
        if (firstPoint) {
          emaPath += ` ${x},${y}`;
          firstPoint = false;
        } else {
          emaPath += ` L${x},${y}`;
        }
      }
    }
    svg += `<path d="${emaPath}" fill="none" stroke="#000000" stroke-width="2"/>`;
  }

  // Draw pullback and pattern lines
  if (geometry?.lines) {
    for (const line of geometry.lines) {
      if (line.points.length < 2) continue;
      const color = line.style === "pattern" ? "#1E5AFF" : "#555555";
      let path = "M";
      line.points.forEach((p, i) => {
        const idx = p.index - sliceStartIndex;
        const x = mapXCoord(idx, coord);
        const y = mapYCoord(p.price, coord);
        path += i === 0 ? ` ${x},${y}` : ` L${x},${y}`;
      });
      svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
    }
  }

  // Draw markers
  if (geometry?.markers) {
    for (const marker of geometry.markers) {
      const markerIndex = marker.index - sliceStartIndex;
      if (markerIndex >= 0 && markerIndex < candles.length) {
        const x = mapXCoord(markerIndex, coord);
        const y = mapYCoord(marker.price, coord);
        svg += `<circle cx="${x}" cy="${y}" r="4" fill="#FF00FF" stroke="#FF00FF" stroke-width="1">`;
        svg += `<title>${marker.label}</title>`;
        svg += `</circle>`;
      }
    }
  }

  // Draw entry/SL/TP lines
  const lines = [
    {
      price: entry,
      label: `Entry ${entry.toFixed(5)}`,
      color: "#FFFF00",
      dash: "5,5",
    },
    {
      price: stopLoss,
      label: `SL ${stopLoss.toFixed(5)}`,
      color: "#FF0000",
      dash: "5,5",
    },
    {
      price: takeProfit,
      label: `TP ${takeProfit.toFixed(5)}`,
      color: "#00AA00",
      dash: "5,5",
    },
  ];

  for (const line of lines) {
    const y = mapYCoord(line.price, coord);
    const x1 = coord.marginLeft;
    const x2 = 900 - coord.marginRight;

    svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${line.color}" stroke-width="1" stroke-dasharray="${line.dash}" opacity="0.8"/>`;

    // Label on the right
    svg += `<text x="${x2 + 5}" y="${y + 4}" font-size="10" fill="${line.color}">${line.label}</text>`;
  }

  // Draw live price line — distinct color/style from entry/SL/TP so the gap
  // between the (possibly stale) entry and current price is visually obvious.
  if (
    livePrice !== null &&
    livePrice !== undefined &&
    Number.isFinite(livePrice)
  ) {
    const y = mapYCoord(livePrice, coord);
    const x1 = coord.marginLeft;
    const x2 = 900 - coord.marginRight;

    svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#00CFFF" stroke-width="1.5" opacity="0.9"/>`;
    // svg += `<text x="${x1 + 5}" y="${y - 6}" font-size="10" fill="#00CFFF">Giá hiện tại ${livePrice.toFixed(5)}</text>`;
  }

  // Draw the setup label near its breakout/signal point
  if (geometry?.patternLabel) {
    const idx = geometry.patternLabel.index - sliceStartIndex;
    const x = mapXCoord(idx, coord);
    const y = mapYCoord(geometry.patternLabel.price, coord);
    const labelX = x + 20;
    const labelY = y - 30;
    svg += `<line x1="${labelX + 5}" y1="${labelY + 5}" x2="${x}" y2="${y}" stroke="#1E5AFF" stroke-width="1.5"/>`;
    svg += `<text x="${labelX}" y="${labelY}" font-size="16" font-weight="bold" font-style="italic" fill="#000000">${geometry.patternLabel.text}</text>`;
  }

  // Title
  svg += `<text x="10" y="25" font-size="14" font-weight="bold" fill="black">${pair} ${direction} — ${setup}</text>`;

  svg += `</svg>`;

  return svg;
}

export async function renderSetupChartPng(svg: string): Promise<Buffer> {
  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 500 },
    });
    await page.setContent(
      `<html><body style="margin:0;padding:0">${svg}</body></html>`,
    );
    const buffer = await page.screenshot({ type: "png" });
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}

async function renderOneSetupChart(
  browser: Browser,
  input: SetupChartInput,
): Promise<Buffer> {
  const svg = buildSetupChartSvg(input);
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
  try {
    await page.setContent(
      `<html><body style="margin:0;padding:0">${svg}</body></html>`,
    );
    const buffer = await page.screenshot({ type: "png" });
    return Buffer.from(buffer);
  } finally {
    await page.close();
  }
}

export async function renderSetupChartsBatch(
  inputs: SetupChartInput[],
): Promise<(Buffer | null)[]> {
  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const results: (Buffer | null)[] = [];

    for (const input of inputs) {
      let buffer: Buffer | null = null;

      try {
        buffer = await renderOneSetupChart(browser, input);
      } catch (error) {
        logger.warn(
          `Chart render attempt 1/2 failed for ${input.pair} ${input.setup}, retrying:`,
          error,
        );

        try {
          buffer = await renderOneSetupChart(browser, input);
        } catch (error2) {
          logger.error(
            `Chart render attempt 2/2 failed for ${input.pair} ${input.setup}, giving up:`,
            error2,
          );
          buffer = null;
        }
      }

      results.push(buffer);
    }

    return results;
  } finally {
    await browser.close();
  }
}
