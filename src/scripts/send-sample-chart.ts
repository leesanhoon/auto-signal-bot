import "../shared/infra/env.js";
import { writeFile } from "node:fs/promises";
import type { Candle } from "../charts/ohlc-provider.js";
import type { ChartContext } from "../charts/chart-types-volman.js";
import type { SetupChartGeometry } from "../charts/setup-types.js";
import { calculateEma } from "../charts/indicators.js";
import {
  buildSetupChartSvg,
  renderSetupChartPng,
  type SetupChartInput,
} from "../charts/setup-chart-renderer.js";
import { telegramNotifier } from "../shared/notification/telegram-client.js";

// Script demo: dựng một setup BB (Block Break) LONG mẫu bằng nến tổng hợp,
// render qua đúng renderer production rồi gửi vào Telegram để kiểm tra bằng mắt.

const buildSampleCandles = (): Candle[] => {
  const candles: Candle[] = [];
  const baseTime = Date.UTC(2026, 6, 14, 0, 0, 0);
  const intervalMs = 15 * 60 * 1000;
  let price = 64_000;

  const push = (open: number, close: number, high: number, low: number) => {
    candles.push({
      time: baseTime + candles.length * intervalMs,
      open,
      high,
      low,
      close,
      volume: 100,
    });
  };

  // Phase 1: uptrend rõ (nến 0–29), có vài nhịp điều chỉnh nhỏ
  for (let i = 0; i < 30; i++) {
    const up = i % 4 !== 3;
    const move = up ? 55 + (i % 3) * 15 : -30;
    const open = price;
    const close = price + move;
    const high = Math.max(open, close) + 20;
    const low = Math.min(open, close) - 20;
    push(open, close, high, low);
    price = close;
  }

  // Phase 2: block nén ngang phía trên EMA21 (nến 30–45)
  const blockHigh = price + 60;
  const blockLow = price - 60;
  for (let i = 0; i < 16; i++) {
    const open = price;
    const drift = (i % 2 === 0 ? 1 : -1) * 35;
    const close = Math.min(
      blockHigh - 15,
      Math.max(blockLow + 15, price + drift),
    );
    push(
      open,
      close,
      Math.min(blockHigh, Math.max(open, close) + 25),
      Math.max(blockLow, Math.min(open, close) - 25),
    );
    price = close;
  }

  // Phase 3: nến breakout khỏi block (nến 46) + 2 nến follow-through
  const breakoutOpen = price;
  const breakoutClose = blockHigh + 130;
  push(breakoutOpen, breakoutClose, breakoutClose + 30, breakoutOpen - 15);
  price = breakoutClose;
  for (let i = 0; i < 2; i++) {
    const open = price;
    const close = price + 60;
    push(open, close, close + 25, open - 20);
    price = close;
  }

  return candles;
};

const main = async (): Promise<void> => {
  const candles = buildSampleCandles();
  const ma21 = calculateEma(candles, 21);

  const blockStart = 30;
  const blockEnd = 45;
  const breakoutIndex = 46;
  const blockHigh = Math.max(
    ...candles.slice(blockStart, blockEnd + 1).map((c) => c.high),
  );
  const blockLow = Math.min(
    ...candles.slice(blockStart, blockEnd + 1).map((c) => c.low),
  );

  const entry = blockHigh + 10;
  const stopLoss = blockLow - 10;
  const risk = entry - stopLoss;
  const takeProfit = entry + 2 * risk; // TP_R_MULTIPLE = 2R
  const livePrice = candles[candles.length - 1].close;

  const geometry: SetupChartGeometry = {
    boxes: [
      {
        startIndex: blockStart,
        endIndex: blockEnd,
        high: blockHigh,
        low: blockLow,
        range: blockHigh - blockLow,
        distanceToEma: 0.5,
      },
    ],
    markers: [],
    highlightCandles: [{ index: breakoutIndex, label: "Breakout" }],
    patternLabel: {
      index: breakoutIndex,
      price: blockHigh,
      text: "BB",
    },
  };

  const chartContext: ChartContext = {
    candles,
    ma21,
    triggerIndex: breakoutIndex,
    sliceStartIndex: 0,
    geometry,
  };

  const input: SetupChartInput = {
    pair: "BTC/USDT (SAMPLE)",
    setup: "BB — Block Break (M15)",
    direction: "LONG",
    entry,
    stopLoss,
    takeProfit,
    livePrice,
    chartContext,
  };

  console.log("Render chart mẫu BB LONG...");
  const svg = buildSetupChartSvg(input);
  const png = await renderSetupChartPng(svg);

  const outPath = "sample-chart-bb-long.png";
  await writeFile(outPath, png);
  console.log(`Đã lưu ${outPath} (${png.length} bytes)`);

  console.log("Gửi chart mẫu vào Telegram...");
  await telegramNotifier.sendPhoto(
    png,
    `🧪 CHART MẪU (dữ liệu tổng hợp — không phải tín hiệu thật)\nBTC/USDT LONG — BB Block Break\nEntry ${entry} | SL ${stopLoss} | TP ${takeProfit} (2R)`,
  );
  await telegramNotifier.sendMessage(
    [
      "🧪 *Chart mẫu vừa gửi ở trên là dữ liệu tổng hợp để kiểm tra renderer.*",
      "Các thành phần cần kiểm tra bằng mắt:",
      "• Nến trắng/đen (tăng/giảm) + wick",
      "• Đường EMA21 (đường đen liền)",
      "• Hộp nén BB (khung đen quanh vùng đi ngang)",
      "• Nến breakout được khoanh viền cam",
      "• Label *BB* màu xanh chỉ vào điểm breakout",
      "• 3 đường ngang: Entry (vàng), SL (đỏ), TP (xanh lá)",
      // "• Đường *Giá hiện tại* màu xanh cyan",
    ].join("\n"),
  );
  console.log("Xong — kiểm tra Telegram.");
};

main().catch((error) => {
  console.error("send-sample-chart failed:", error);
  process.exitCode = 1;
});
