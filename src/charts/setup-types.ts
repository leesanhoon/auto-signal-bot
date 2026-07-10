import type { ChartTimeframe } from "./chart-types-common.js";

export type SetupKind = "DD" | "FB" | "BB" | "RB" | "ARB" | "IRB" | "SB";

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
};

export type DetectionContext = {
  ema20: (number | null)[];
  atr14: (number | null)[];
  pair: string;
  timeframe: ChartTimeframe;
};