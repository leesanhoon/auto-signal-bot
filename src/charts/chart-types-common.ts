export type CandleRangeStats = {
  high: number;
  low: number;
  lastClose: number | null;
};

export type ChartTimeframe = "M15" | "M30" | "H1" | "H4" | "D1";

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
  lastPrice?: number | null;
};

export type PendingOrderStatus = "PENDING" | "TRIGGERED" | "EXPIRED" | "CANCELLED";

export type PendingOrder = {
  id: number;
  pair: string;
  direction: "LONG" | "SHORT";
  setup: string | null;
  orderType: ChartOrderType;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string | null;
  confidence: number | null;
  reasons: string[] | null;
  risks: string[] | null;
  primaryTimeframe: ChartTimeframe | null;
  sourceChartFilepath: string | null;
  status: PendingOrderStatus;
  runCount: number;
  expiryRuns: number;
  createdAt: string;
  resolvedAt: string | null;
  resolvedReason: string | null;
  triggeredPositionId: number | null;
};
