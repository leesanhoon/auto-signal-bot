export type ChartTimeframe = "M15" | "H4" | "D1";

export type ChartOrderType =
  | "MARKET_NOW"
  | "BUY_STOP"
  | "SELL_STOP"
  | "BUY_LIMIT"
  | "SELL_LIMIT"
  | "WAIT_FOR_CONFIRMATION";

export type ChartConfig = {
  name: string;
  symbol: string;
  interval: string;
  description: string;
  timeframe: ChartTimeframe;
};

export type ChartAnalysisSource = {
  symbol: string;
  timeframe: ChartTimeframe;
  name: string;
  filepath: string;
};

export type ScreenshotResult = {
  chart: ChartConfig;
  buffer: Buffer;
  filepath: string;
};

export type PairSummary = {
  pair: string;
  trend: string;
  emaProximity?: "tại" | "gần" | "xa";
  status: string;
  confidence: number;
};

export type TradeSetup = {
  pair: string;
  direction: "LONG" | "SHORT";
  setup: string;
  emaTouch?: boolean;
  reasons: string[];
  risks: string[];
  confidence: number;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  riskReward: string;
  summary: string;
  orderType?: ChartOrderType;
  entryCondition?: string;
  currentPriceContext?: string;
  verifiedConfirmed?: boolean;
  verifiedConfidence?: number;
  verifiedComment?: string;
  verifiedBy?: string;
  autoTracked?: boolean;
  sourceCharts?: ChartAnalysisSource[];
  telegramChart?: ChartAnalysisSource;
};
export type AnalysisResult = {
  summaries: PairSummary[];
  setups: TradeSetup[];
  noSetupReason: string;
  screenshots: ScreenshotResult[];
};
