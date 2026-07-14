import "../shared/env.js";
import { writeFile } from "node:fs/promises";
import type { Candle } from "../charts/ohlc-provider.js";
import type { ChartContext } from "../charts/chart-types-volman.js";
import type { SetupChartGeometry } from "../charts/setup-types.js";
import { calculateEma } from "../charts/indicators.js";
import {
  renderSetupChartsBatch,
  type SetupChartInput,
} from "../charts/setup-chart-renderer.js";
import { telegramNotifier } from "../shared/telegram-client.js";

// Script demo: dựng chart mẫu cho 6 setup còn lại (RB, ARB, IRB, FB, SB, DDB)
// bằng nến tổng hợp, render qua đúng renderer production rồi gửi vào Telegram.
// (BB đã có script riêng: send-sample-chart.ts)

const START_TIME = Date.UTC(2026, 6, 14, 0, 0, 0);
const INTERVAL_MS = 15 * 60 * 1000;

const fromCloses = (closes: number[], wick = 20): Candle[] => {
  const candles: Candle[] = [];
  let prev = closes[0];
  for (const close of closes) {
    const open = prev;
    candles.push({
      time: START_TIME + candles.length * INTERVAL_MS,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
      volume: 100,
    });
    prev = close;
  }
  return candles;
};

const sliceHigh = (candles: Candle[], start: number, end: number): number =>
  Math.max(...candles.slice(start, end + 1).map((c) => c.high));
const sliceLow = (candles: Candle[], start: number, end: number): number =>
  Math.min(...candles.slice(start, end + 1).map((c) => c.low));

type Sample = {
  fileName: string;
  caption: string;
  input: SetupChartInput;
};

const makeInput = (
  setupLabel: string,
  direction: "LONG" | "SHORT",
  candles: Candle[],
  geometry: SetupChartGeometry,
  triggerIndex: number,
  entry: number,
  stopLoss: number,
): SetupChartInput => {
  const risk = Math.abs(entry - stopLoss);
  const takeProfit = direction === "LONG" ? entry + 2 * risk : entry - 2 * risk;
  const chartContext: ChartContext = {
    candles,
    ma21: calculateEma(candles, 21),
    triggerIndex,
    sliceStartIndex: 0,
    geometry,
  };
  return {
    pair: "BTC/USDT (SAMPLE)",
    setup: setupLabel,
    direction,
    entry,
    stopLoss,
    takeProfit,
    livePrice: candles[candles.length - 1].close,
    chartContext,
  };
};

// RB — Range Break SHORT: vùng phạm vi (EMA phẳng), nén sát biên dưới rồi phá vỡ xuống
const buildRbShort = (): Sample => {
  const closes: number[] = [];
  for (let i = 0; i < 48; i++) closes.push(64200 + 180 * Math.sin(i * 0.5));
  for (let i = 0; i < 8; i++) closes.push(64060 + 30 * Math.sin(i * 1.3));
  closes.push(63830, 63760, 63700);
  const candles = fromCloses(closes);

  const boxHigh = sliceHigh(candles, 1, 55);
  const boxLow = sliceLow(candles, 1, 55);
  const entry = boxLow + 5;
  const stopLoss = sliceHigh(candles, 48, 55) + 10;

  const geometry: SetupChartGeometry = {
    boxes: [
      { startIndex: 1, endIndex: 55, high: boxHigh, low: boxLow, range: boxHigh - boxLow, distanceToEma: 0.3 },
    ],
    markers: [
      { index: 3, price: candles[3].high, label: "Chạm biên trên" },
      { index: 9, price: candles[9].low, label: "Chạm biên dưới" },
      { index: 16, price: candles[16].high, label: "Chạm biên trên" },
      { index: 22, price: candles[22].low, label: "Chạm biên dưới" },
    ],
    highlightCandles: [{ index: 56, label: "Breakout" }],
    patternLabel: { index: 56, price: entry, text: "RB" },
  };

  return {
    fileName: "sample-chart-rb-short.png",
    caption: "🧪 MẪU 1/6 — RB Range Break SHORT: range đi ngang, nén sát biên dưới, phá vỡ xuống. Marker hồng = các lần chạm biên.",
    input: makeInput("RB — Range Break (M15)", "SHORT", candles, geometry, 56, entry, stopLoss),
  };
};

// ARB — Advanced Range Break LONG: phá vỡ mồi (false break), nén lại trong vùng rồi phá vỡ thật
const buildArbLong = (): Sample => {
  const closes: number[] = [];
  for (let i = 0; i < 26; i++) closes.push(64000 + 170 * Math.sin(i * 0.55));
  closes.push(64330); // false break lên trên biên
  closes.push(64150, 64020, 63980, 64050);
  for (let i = 0; i < 12; i++) closes.push(64120 + 40 * Math.sin(i * 1.1));
  closes.push(64350, 64430, 64500);
  const candles = fromCloses(closes);

  const rangeHigh = sliceHigh(candles, 1, 25);
  const rangeLow = sliceLow(candles, 1, 25);
  const entry = rangeHigh + 10;
  const stopLoss = sliceLow(candles, 31, 42) - 10;

  const geometry: SetupChartGeometry = {
    boxes: [
      { startIndex: 1, endIndex: 42, high: rangeHigh, low: rangeLow, range: rangeHigh - rangeLow, distanceToEma: 0.4 },
    ],
    markers: [{ index: 26, price: candles[26].high, label: "False break (phá vỡ mồi)" }],
    highlightCandles: [{ index: 43, label: "Breakout thật" }],
    patternLabel: { index: 43, price: entry, text: "ARB" },
  };

  return {
    fileName: "sample-chart-arb-long.png",
    caption: "🧪 MẪU 2/6 — ARB Advanced Range Break LONG: marker hồng = phá vỡ mồi thất bại, sau đó nén lại rồi phá vỡ thật lên trên.",
    input: makeInput("ARB — Advanced Range Break (M15)", "LONG", candles, geometry, 43, entry, stopLoss),
  };
};

// IRB — Inside Range Break LONG: hộp nén nhỏ nằm giữa vùng phạm vi lớn, phá vỡ hướng về biên vùng
const buildIrbLong = (): Sample => {
  const closes: number[] = [];
  for (let i = 0; i < 32; i++) closes.push(64000 + 350 * Math.sin(i * 0.4));
  for (let i = 0; i < 15; i++) closes.push(64050 + 60 * Math.sin(i * 0.9));
  closes.push(64280, 64340, 64400);
  const candles = fromCloses(closes);

  const outerHigh = sliceHigh(candles, 1, 31);
  const outerLow = sliceLow(candles, 1, 31);
  const innerHigh = sliceHigh(candles, 32, 46);
  const innerLow = sliceLow(candles, 32, 46);
  const entry = innerHigh + 10;
  const stopLoss = innerLow - 10;

  const geometry: SetupChartGeometry = {
    boxes: [
      { startIndex: 32, endIndex: 46, high: innerHigh, low: innerLow, range: innerHigh - innerLow, distanceToEma: 0.3 },
      { startIndex: 1, endIndex: 46, high: outerHigh, low: outerLow, range: outerHigh - outerLow, distanceToEma: 0.5 },
    ],
    markers: [],
    highlightCandles: [{ index: 47, label: "Breakout" }],
    patternLabel: { index: 47, price: entry, text: "IRB" },
  };

  return {
    fileName: "sample-chart-irb-long.png",
    caption: "🧪 MẪU 3/6 — IRB Inside Range Break LONG: 2 hộp lồng nhau — hộp nén nhỏ bên trong vùng phạm vi lớn, phá vỡ hướng lên biên trên.",
    input: makeInput("IRB — Inside Range Break (M15)", "LONG", candles, geometry, 47, entry, stopLoss),
  };
};

// FB — First Break SHORT: pullback hài hòa đầu tiên của xu hướng giảm mới, có đường trendline pullback
const buildFbShort = (): Sample => {
  const closes: number[] = [];
  for (let i = 0; i < 15; i++) closes.push(64650 + i * 10);
  closes.push(64500);
  for (let i = 0; i < 9; i++) closes.push(64440 - 60 * i);
  for (let i = 0; i < 6; i++) closes.push(63990 + 35 * i);
  closes.push(63980, 63850, 63780);
  const candles = fromCloses(closes);

  const entry = sliceLow(candles, 25, 30) - 10;
  const stopLoss = sliceHigh(candles, 25, 30) + 10;

  const geometry: SetupChartGeometry = {
    boxes: [],
    markers: [],
    lines: [
      {
        points: [
          // Từ cực trị trend (đáy nến 24) về nến break — khớp hành vi mới của fb.ts
          { index: 24, price: candles[24].low },
          { index: 31, price: candles[31].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
    highlightCandles: [{ index: 31, label: "Break" }],
    patternLabel: { index: 31, price: entry, text: "FB" },
  };

  return {
    fileName: "sample-chart-fb-short.png",
    caption: "🧪 MẪU 4/6 — FB First Break SHORT: pullback hài hòa đầu tiên về EMA21 của xu hướng giảm mới. Đường đứt xám = trendline pullback.",
    input: makeInput("FB — First Break (M15)", "SHORT", candles, geometry, 31, entry, stopLoss),
  };
};

// SB — Second Break LONG: phá vỡ đầu thất bại tạo mô hình W quanh EMA21, vào lần phá vỡ thứ hai
const buildSbLong = (): Sample => {
  const closes: number[] = [];
  for (let i = 0; i < 30; i++) closes.push(63200 + i * 38);
  closes.push(64230, 64160, 64090, 64030, 63990); // pullback → bottom 1 (34)
  closes.push(64060, 64110, 64150); // đỉnh giữa (37)
  closes.push(64090, 64040, 64000); // bottom 2 (40)
  closes.push(64060, 64120); // hồi lên
  closes.push(64260, 64320, 64380); // second break (43)
  const candles = fromCloses(closes);

  const entry = candles[37].high + 10;
  const stopLoss = Math.min(candles[34].low, candles[40].low) - 10;

  const geometry: SetupChartGeometry = {
    boxes: [],
    markers: [],
    highlightCandles: [
      { index: 34, label: "Bottom 1" },
      { index: 40, label: "Bottom 2" },
    ],
    lines: [
      {
        points: [
          { index: 30, price: candles[30].close },
          { index: 34, price: candles[34].low },
        ],
        label: "Pullback",
        style: "pullback",
      },
      {
        points: [
          { index: 34, price: candles[34].low },
          { index: 37, price: candles[37].high },
          { index: 40, price: candles[40].low },
          { index: 43, price: candles[43].close },
        ],
        label: "W-pattern",
        style: "pattern",
      },
    ],
    patternLabel: { index: 43, price: entry, text: "SB" },
  };

  return {
    fileName: "sample-chart-sb-long.png",
    caption: "🧪 MẪU 5/6 — SB Second Break LONG: 2 đáy khoanh cam = mô hình W quanh EMA21, đường xanh đứt = W-pattern, vào lần phá vỡ thứ hai.",
    input: makeInput("SB — Second Break (M15)", "LONG", candles, geometry, 43, entry, stopLoss),
  };
};

// DDB — Double Doji Break SHORT: cụm doji sát EMA21 sau pullback hài hòa, phá vỡ xuống
const buildDdbShort = (): Sample => {
  const closes: number[] = [];
  for (let i = 0; i < 25; i++) closes.push(64800 - 36 * i);
  for (let i = 0; i < 7; i++) closes.push(63960 + 30 * i);
  closes.push(64150, 64145, 64155); // cụm doji (32-34)
  closes.push(64000, 63900, 63820);
  const candles = fromCloses(closes);

  // Chỉnh 3 nến doji: thân siêu nhỏ, wick 2 phía
  for (const i of [32, 33, 34]) {
    const c = candles[i];
    c.open = c.close - 3;
    c.high = c.close + 50;
    c.low = c.close - 50;
  }

  const entry = sliceLow(candles, 32, 34) - 10;
  const stopLoss = sliceHigh(candles, 32, 34) + 10;

  const geometry: SetupChartGeometry = {
    boxes: [],
    markers: [],
    highlightCandles: [
      { index: 32, label: "Doji" },
      { index: 33, label: "Doji" },
      { index: 34, label: "Doji" },
    ],
    lines: [
      {
        points: [
          { index: 25, price: candles[25].close },
          { index: 32, price: candles[32].close },
        ],
        label: "Pullback",
        style: "pullback",
      },
    ],
    patternLabel: { index: 35, price: entry, text: "DDB" },
  };

  return {
    fileName: "sample-chart-ddb-short.png",
    caption: "🧪 MẪU 6/6 — DDB Double Doji Break SHORT: cụm 3 doji (khoanh cam) sát EMA21 sau pullback hài hòa, phá vỡ xuống dưới đáy doji.",
    input: makeInput("DDB — Double Doji Break (M15)", "SHORT", candles, geometry, 35, entry, stopLoss),
  };
};

const main = async (): Promise<void> => {
  const samples: Sample[] = [
    buildRbShort(),
    buildArbLong(),
    buildIrbLong(),
    buildFbShort(),
    buildSbLong(),
    buildDdbShort(),
  ];

  console.log(`Render ${samples.length} chart mẫu...`);
  const buffers = await renderSetupChartsBatch(samples.map((s) => s.input));

  await telegramNotifier.sendMessage(
    "🧪 *Bộ chart mẫu 6 setup còn lại (dữ liệu tổng hợp — không phải tín hiệu thật):*\nRB, ARB, IRB, FB, SB, DDB — kiểm tra box, marker, trendline, highlight và Entry/SL/TP trên từng ảnh.",
  );

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const buffer = buffers[i];
    if (!buffer) {
      console.error(`Render thất bại: ${sample.fileName}`);
      continue;
    }
    await writeFile(sample.fileName, buffer);
    console.log(`Đã lưu ${sample.fileName} (${buffer.length} bytes)`);
    await telegramNotifier.sendPhoto(buffer, sample.caption);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  console.log("Xong — kiểm tra Telegram.");
};

main().catch((error) => {
  console.error("send-sample-charts-all failed:", error);
  process.exitCode = 1;
});
