import type {
  ChartTimeframe,
  ChartOrderType,
  ChartAnalysisSource,
  ScreenshotResult,
} from "./chart-types-common.js";
import type { Candle } from "./ohlc-provider.js";
import type { SetupChartGeometry } from "./setup-types.js";

export type {
  ChartTimeframe,
  ChartOrderType,
  ChartAnalysisSource,
  ScreenshotResult,
};

export type ChartContext = {
  candles: Candle[];       // slice gần triggerIndex, KHÔNG phải toàn bộ 200 nến
  ema20: (number | null)[]; // slice cùng độ dài, cùng offset với candles ở trên
  triggerIndex: number;     // index của triggerIndex GỐC (trong mảng đầy đủ) — renderer cần biết offset
  sliceStartIndex: number;  // index gốc của candles[0] trong mảy đầy đủ (để map lại geometry.boxes[].startIndex/endIndex)
  geometry?: SetupChartGeometry;
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
  chartContext?: ChartContext;
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
