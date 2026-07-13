import type { Candle } from "./ohlc-provider.js";
import type { ChartContext } from "./chart-types-volman.js";
import { chromium, type Browser } from "playwright";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("charts:setup-chart-renderer");

export type SetupChartInput = {
  pair: string;
  setup: string;
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
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
  takeProfit2: number,
): CoordMap {
  const marginLeft = 40;
  const marginRight = 40;
  const marginTop = 40;
  const marginBottom = 40;
  const chartWidth = 900 - marginLeft - marginRight;
  const chartHeight = 500 - marginTop - marginBottom;

  // Find min/max price including SL and TP
  let minPrice = Math.min(...candles.map((c) => c.low), stopLoss, takeProfit2);
  let maxPrice = Math.max(...candles.map((c) => c.high), stopLoss, takeProfit2);

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
  const { pair, setup, direction, entry, stopLoss, takeProfit1, takeProfit2, chartContext } = input;
  const { candles, ema20, sliceStartIndex, geometry } = chartContext;

  const coord = buildCoordMap(candles, stopLoss, takeProfit2);

  let svg = `<svg viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg" style="background:white;font-family:Arial,sans-serif">`;

  // Background
  svg += `<rect width="900" height="500" fill="white"/>`;

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

      // Outer box (index 1) lighter, inner box (index 0) slightly darker
      const fillColor = i === 0 ? "rgba(100, 150, 200, 0.15)" : "rgba(100, 150, 200, 0.08)";

      svg += `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(
        x2 - x1,
      )}" height="${Math.abs(y2 - y1)}" fill="${fillColor}" stroke="none"/>`;
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
    const candleColor = isUp ? "#00AA00" : "#AA0000";
    const bodyColor = candleColor;

    // Wick
    svg += `<line x1="${xCenter}" y1="${yHigh}" x2="${xCenter}" y2="${yLow}" stroke="${candleColor}" stroke-width="0.5"/>`;

    // Body
    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.abs(yClose - yOpen);
    const bodyWidth = 8;
    svg += `<rect x="${xCenter - bodyWidth / 2}" y="${bodyTop}" width="${bodyWidth}" height="${bodyHeight || 1}" fill="${bodyColor}" stroke="${candleColor}" stroke-width="0.5"/>`;
  }

  // Draw EMA20
  if (ema20 && ema20.length > 0) {
    let emaPath = "M";
    let firstPoint = true;
    for (let i = 0; i < ema20.length; i++) {
      if (ema20[i] !== null) {
        const x = mapXCoord(i, coord);
        const y = mapYCoord(ema20[i]!, coord);
        if (firstPoint) {
          emaPath += ` ${x},${y}`;
          firstPoint = false;
        } else {
          emaPath += ` L${x},${y}`;
        }
      }
    }
    svg += `<path d="${emaPath}" fill="none" stroke="#FF8800" stroke-width="2"/>`;
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
    { price: entry, label: `Entry ${entry.toFixed(5)}`, color: "#FFFF00", dash: "5,5" },
    { price: stopLoss, label: `SL ${stopLoss.toFixed(5)}`, color: "#FF0000", dash: "5,5" },
    { price: takeProfit1, label: `TP1 ${takeProfit1.toFixed(5)}`, color: "#00AA00", dash: "5,5" },
    { price: takeProfit2, label: `TP2 ${takeProfit2.toFixed(5)}`, color: "#00AA00", dash: "5,5" },
  ];

  for (const line of lines) {
    const y = mapYCoord(line.price, coord);
    const x1 = coord.marginLeft;
    const x2 = 900 - coord.marginRight;

    svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${line.color}" stroke-width="1" stroke-dasharray="${line.dash}" opacity="0.8"/>`;

    // Label on the right
    svg += `<text x="${x2 + 5}" y="${y + 4}" font-size="10" fill="${line.color}">${line.label}</text>`;
  }

  // Title
  svg += `<text x="10" y="25" font-size="14" font-weight="bold" fill="black">${pair} ${direction} — ${setup}</text>`;

  svg += `</svg>`;

  return svg;
}

export async function renderSetupChartPng(svg: string): Promise<Buffer> {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    await page.setContent(`<html><body style="margin:0;padding:0">${svg}</body></html>`);
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
    await page.setContent(`<html><body style="margin:0;padding:0">${svg}</body></html>`);
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
