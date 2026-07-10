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
  detectionSource?: "smc";
  sourceCharts?: ChartAnalysisSource[];
  telegramChart?: ChartAnalysisSource;
  lastPrice?: number | null;
  // SMC-specific fields
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
  autoTracked?: boolean;
  ruleTrace?: string[];
  entryCondition?: string;
};

export type PairSummary = {
  pair: string;
  trend: string;
  status: string;
  confidence: number;
  ruleTrace?: string[];
  detectionSource?: "smc";
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
