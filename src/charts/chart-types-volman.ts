import type {
  ChartTimeframe,
  ChartOrderType,
  ChartAnalysisSource,
  ScreenshotResult,
} from "./chart-types-common.js";

export type {
  ChartTimeframe,
  ChartOrderType,
  ChartAnalysisSource,
  ScreenshotResult,
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
  detectionSource?: "deterministic" | "ai";
  sourceCharts?: ChartAnalysisSource[];
  telegramChart?: ChartAnalysisSource;
  lastPrice?: number | null;
};

export type PairSummary = {
  pair: string;
  trend: string;
  emaProximity?: "tại" | "gần" | "xa";
  status: string;
  confidence: number;
  ruleTrace?: string[];
  detectionSource?: "deterministic" | "ai";
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
