export type ChartConfig = {
  name: string;
  symbol: string;
  interval: string;
  description: string;
};

export type ScreenshotResult = {
  chart: ChartConfig;
  buffer: Buffer;
  filepath: string;
};

export type TradeSetup = {
  pair: string;
  direction: "LONG" | "SHORT";
  setup: string;
  reasons: string[];
  risks: string[];
  confidence: number;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  riskReward: string;
  summary: string;
};

export type AnalysisResult = {
  setups: TradeSetup[];
  noSetupReason: string;
  screenshots: ScreenshotResult[];
};
