import type { ChartTimeframe } from "./chart-types-common.js";
import type { CompressionWindow } from "./indicators.js";

export type SetupKind = "DD" | "FB" | "BB" | "RB" | "ARB" | "IRB" | "SB";

export type ChartMarker = {
  index: number;   // vị trí trong mảng candles
  price: number;
  label: string;   // ví dụ "Edge test #1", "Doji"
};

export type SetupChartGeometry = {
  /** Box chính (range/block) — BB, RB, ARB dùng 1 box; IRB dùng boxes[0]=inner, boxes[1]=outer. */
  boxes: CompressionWindow[];
  /** Điểm mốc phụ, ví dụ các nến edge-test bị false break (ARB). */
  markers: ChartMarker[];
};

export type DetectedSignal = {
  setup: SetupKind;
  pair: string;
  timeframe: ChartTimeframe;
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  confidence: number; // 0-100
  triggerIndex: number; // index trong mảng candles nơi tín hiệu kích hoạt
  ruleTrace: string[];
  /** Optional — chỉ set bởi BB/RB/ARB/IRB, dùng để vẽ chart. Không set thì downstream vẫn hoạt động như cũ. */
  geometry?: SetupChartGeometry;
};

export type DetectionContext = {
  ema20: (number | null)[];
  atr14: (number | null)[];
  pair: string;
  timeframe: ChartTimeframe;
};