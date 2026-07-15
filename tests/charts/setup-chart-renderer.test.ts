import { describe, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Candle } from "../../src/charts/ohlc-provider.js";
import { calculateEma } from "../../src/charts/indicators.js";
import {
  buildSetupChartSvg,
  renderSetupChartPng,
  renderSetupChartsBatch,
  getPlaywrightDiagnostics,
} from "../../src/charts/setup-chart-renderer.js";

function buildTrendingCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push({
      time: 1700000000000 + i * 3600000,
      open: 100 + i * 0.1,
      high: 100.5 + i * 0.1,
      low: 99.5 + i * 0.1,
      close: 100.2 + i * 0.1,
      volume: 100,
    });
  }
  return candles;
}

describe("getPlaywrightDiagnostics", () => {
  test("trả về chuỗi chứa PLAYWRIGHT_BROWSERS_PATH và chromium.executablePath", () => {
    const result = getPlaywrightDiagnostics();

    expect(result).toContain("PLAYWRIGHT_BROWSERS_PATH=");
    expect(result).toContain("chromium.executablePath=");
  });
});

describe("Chart renderer", () => {
  describe("buildSetupChartSvg", () => {
    test("builds SVG with candlesticks, EMA, geometry, and price lines", () => {
      // 25 candles so calculateEma(candles, 20) actually produces non-null values
      // (period 20 needs >=20 candles) — otherwise the EMA draw branch never runs.
      const candles = buildTrendingCandles(25);
      candles[1] = {
        ...candles[1],
        open: 100.3,
        close: 100.1,
      };
      const ma21 = calculateEma(candles, 21);
      expect(ma21.some((v) => v !== null)).toBe(true);

      const svg = buildSetupChartSvg({
        pair: "BTC/USDT",
        setup: "ARB",
        direction: "LONG",
        entry: 100.5,
        stopLoss: 99.5,
        takeProfit: 102.5,
        chartContext: {
          candles,
          ma21,
          triggerIndex: 24,
          sliceStartIndex: 0,
          geometry: {
            boxes: [
              {
                startIndex: 2,
                endIndex: 7,
                high: 100.5,
                low: 99.9,
                range: 0.6,
                distanceToEma: 0.1,
              },
            ],
            markers: [
              { index: 3, price: 100.4, label: "Edge test #1" },
              { index: 5, price: 100.3, label: "Edge test #2" },
            ],
            lines: [
              {
                points: [
                  { index: 8, price: candles[8].close },
                  { index: 12, price: candles[12].close },
                ],
                label: "Pullback",
                style: "pullback",
              },
              {
                points: [
                  { index: 12, price: candles[12].close },
                  { index: 16, price: candles[16].close },
                ],
                label: "Pattern",
                style: "pattern",
              },
            ],
            highlightCandles: [{ index: 12, label: "Signal candle" }],
            patternLabel: { index: 16, price: 101.8, text: "ARB" },
          },
        },
      });

      expect(svg).toContain("<svg");
      expect(svg).toContain("BTC/USDT LONG — ARB");
      expect(svg).toContain("Entry");
      expect(svg).toContain("SL");
      expect(svg).toContain("TP 102.50000");
      expect(svg).not.toContain("TP1");
      expect(svg).not.toContain("TP2");
      expect(svg).toMatch(/<rect/g);
      expect(svg).toContain("Edge test #1");
      expect(svg).toContain('fill="url(#bgGrad)"');
      expect(svg).toContain('fill="none" stroke="#000000" stroke-width="1.5"');
      expect(svg).toContain('fill="#FFFFFF" stroke="#000000"');
      expect(svg).toContain('fill="#000000" stroke="#000000"');
      expect(svg).toContain('stroke-dasharray="3,2"');
      expect(svg).toContain('stroke="#555555"');
      expect(svg).toContain('stroke="#1E5AFF"');
      expect(svg).toContain('stroke="#FFB300"');
      expect(svg).toContain('font-style="italic" fill="#000000">ARB</text>');

      // EMA20 must actually render as a <path> with real coordinate data (not just "M"
      // with nothing after it) — this is what regressed before: <polyline points="M ... L ...">
      // is invalid SVG (points only accepts numeric pairs, not path commands) and silently
      // renders no line at all.
      const pathMatch = svg.match(
        /<path d="([^"]+)" fill="none" stroke="#000000" stroke-width="2"/,
      );
      expect(pathMatch).not.toBeNull();
      const pathData = pathMatch![1];
      expect(pathData).toMatch(/^M \d/); // starts with "M <number>", not bare "M"
      expect(pathData).toContain("L");
      expect(pathData.split("L").length).toBeGreaterThan(1); // at least one line segment
    });

    test("builds SVG without geometry (backward compat)", () => {
      const candles = buildTrendingCandles(10);
      const ma21 = calculateEma(candles, 21);
      const svg = buildSetupChartSvg({
        pair: "ETH/USDT",
        setup: "BB",
        direction: "SHORT",
        entry: 100.0,
        stopLoss: 101.0,
        takeProfit: 98.0,
        chartContext: {
          candles,
          ma21,
          triggerIndex: 9,
          sliceStartIndex: 0,
        },
      });

      expect(svg).toContain("<svg");
      expect(svg).toContain("ETH/USDT SHORT — BB");
      expect(svg).toContain("Entry");
    });

    test("draws a distinctly-colored live price line when livePrice is provided", () => {
      const svg = buildSetupChartSvg({
        pair: "EUR/USD",
        setup: "RB",
        direction: "LONG",
        entry: 1.1,
        stopLoss: 1.09,
        takeProfit: 1.12,
        livePrice: 1.115,
        chartContext: {
          candles: [
            { time: 1, open: 1.1, high: 1.11, low: 1.09, close: 1.105, volume: 10 },
            { time: 2, open: 1.105, high: 1.116, low: 1.1, close: 1.115, volume: 12 },
          ],
          ma21: [1.1, 1.11],
          triggerIndex: 0,
          sliceStartIndex: 0,
        },
      });

      // Live price line must use a color distinct from entry (#FFFF00), SL (#FF0000), TP (#00AA00).
      expect(svg).toContain('stroke="#00CFFF"');
    });

    test("omits the live price line when livePrice is not provided", () => {
      const svg = buildSetupChartSvg({
        pair: "EUR/USD",
        setup: "RB",
        direction: "LONG",
        entry: 1.1,
        stopLoss: 1.09,
        takeProfit: 1.12,
        chartContext: {
          candles: [{ time: 1, open: 1.1, high: 1.11, low: 1.09, close: 1.105, volume: 10 }],
          ma21: [1.1],
          triggerIndex: 0,
          sliceStartIndex: 0,
        },
      });

      expect(svg).not.toContain("Giá hiện tại");
    });

    test("label giá Entry/SL/TP bên phải có đủ chỗ ngang, không bị cắt ở mép 900px", () => {
      const candles = buildTrendingCandles(25);
      const ma21 = calculateEma(candles, 21);
      const svg = buildSetupChartSvg({
        pair: "BTC/USDT",
        setup: "BB",
        direction: "LONG",
        entry: 64210,
        stopLoss: 64020,
        takeProfit: 64590,
        chartContext: {
          candles,
          ma21,
          triggerIndex: 24,
          sliceStartIndex: 0,
        },
      });

      // Bắt đúng 3 label Entry (vàng #FFFF00), SL (đỏ #FF0000), TP (xanh #00AA00)
      const labelMatches = [
        ...svg.matchAll(
          /<text x="([\d.]+)" y="[\d.-]+" font-size="10" fill="(#FFFF00|#FF0000|#00AA00)">/g,
        ),
      ];
      expect(labelMatches).toHaveLength(3);

      for (const match of labelMatches) {
        const x = Number(match[1]);
        // Chuỗi dài nhất "Entry 64210.00000" = 17 ký tự × ~5.6px (Arial 10px) ≈ 95px.
        // Yêu cầu tối thiểu 100px từ vị trí label tới mép phải 900px.
        expect(900 - x).toBeGreaterThanOrEqual(100);
      }
    });
  });

  describe("renderSetupChartPng", () => {
    test("renders SVG to PNG buffer with valid PNG signature", async () => {
      const candles = buildTrendingCandles(10);
      const ma21 = calculateEma(candles, 21);
      const svg = buildSetupChartSvg({
        pair: "BTC/USDT",
        setup: "ARB",
        direction: "LONG",
        entry: 100.5,
        stopLoss: 99.5,
        takeProfit: 102.5,
        chartContext: {
          candles,
          ma21,
          triggerIndex: 9,
          sliceStartIndex: 0,
        },
      });

      const buffer = await renderSetupChartPng(svg);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      // PNG signature: 89 50 4E 47
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
      expect(buffer[2]).toBe(0x4e);
      expect(buffer[3]).toBe(0x47);
    });
  });

  describe("renderSetupChartsBatch", () => {
    test("renders batch of charts, returns nulls for failed items", async () => {
      const candles = buildTrendingCandles(10);
      const ma21 = calculateEma(candles, 21);

      const inputs = [
        {
          pair: "BTC/USDT",
          setup: "ARB",
          direction: "LONG" as const,
          entry: 100.5,
          stopLoss: 99.5,
          takeProfit: 102.5,
          chartContext: {
            candles,
            ma21,
            triggerIndex: 9,
            sliceStartIndex: 0,
          },
        },
        {
          pair: "ETH/USDT",
          setup: "BB",
          direction: "SHORT" as const,
          entry: 100.0,
          stopLoss: 101.0,
          takeProfit: 98.0,
          chartContext: {
            candles,
            ma21,
            triggerIndex: 9,
            sliceStartIndex: 0,
          },
        },
      ];

      const buffers = await renderSetupChartsBatch(inputs);
      expect(buffers).toHaveLength(2);
      expect(buffers[0]).toBeInstanceOf(Buffer);
      expect(buffers[1]).toBeInstanceOf(Buffer);
      expect(buffers[0]!.length).toBeGreaterThan(0);
      expect(buffers[1]!.length).toBeGreaterThan(0);
    });
  });
});
