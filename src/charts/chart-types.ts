export type CandleRangeStats = {
  high: number;
  low: number;
  lastClose: number | null;
};

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
  lastPrice?: number | null;
};

export type ScreenshotResult = {
  chart: ChartConfig;
  buffer: Buffer;
  filepath: string;
  lastPrice: number | null;
};

export type PairSummary = {
  pair: string;
  trend: string;
  emaProximity?: "tại" | "gần" | "xa";
  status: string;
  confidence: number;
  ruleTrace?: string[];
  detectionSource?: "deterministic" | "ai" | "smc";
};

export type TradeSetup = {
  pair: string;
  direction: "LONG" | "SHORT";
  setup: string;
  primaryTimeframe?: ChartTimeframe;
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
  autoTracked?: boolean;
  chartFallbackUsed?: boolean;
  ruleTrace?: string[];
  detectionSource?: "deterministic" | "ai" | "smc";
  sourceCharts?: ChartAnalysisSource[];
  telegramChart?: ChartAnalysisSource;
  lastPrice?: number | null;
  // ---- SMC metadata (optional, không phá Bob Volman fields) ----
  grade?: "A" | "B" | "C" | "D";
  score?: number;
  market?: string;
  session?: string;
  sessionLabel?: string;
  entryZone?: { low: string; high: string };
  stopLossDistance?: string;
  takeProfit3?: string;
  takeProfitAllocations?: { tp1: number; tp2: number; tp3: number };
  liquidityTargets?: Array<{
    label: string;
    price: string;
    target: "TP1" | "TP2" | "TP3";
    riskReward?: string;
  }>;
  caution?: string;
  capitalManagement?: string[];
};

export type AnalysisStats = {
  attemptedPairs: number;
  okPairs: number;
  noSetupPairs: number;
  skippedPairs: number;
  setupCount: number;
};

export type AnalysisResult = {
  summaries: PairSummary[];
  setups: TradeSetup[];
  noSetupReason: string;
  screenshots: ScreenshotResult[];
  analysisStats?: AnalysisStats;
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
