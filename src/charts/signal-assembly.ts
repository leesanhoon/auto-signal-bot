import type { DetectedSignal, SetupKind } from "./setup-types.js";
import type { TradeSetup, PairSummary, ChartTimeframe, ChartOrderType } from "./chart-types-volman.js";
import type { TrendState } from "./indicators.js";
import { formatPrice, applyPriceSanityChecks } from "./analyzer-volman.js";
import { calculateRiskRewardPlan } from "./position-engine-volman.js";

// ---------------------------------------------------------------------------
// Rule-to-Vietnamese mapping for reasons
// ---------------------------------------------------------------------------

const REASON_TEMPLATES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /Trend=(UPTREND|DOWNTREND),?.*/, replacement: "EMA20 đang dốc $1 rõ ràng" },
  { pattern: /Trend=FLAT.*/, replacement: "EMA20 đang đi ngang" },
  { pattern: /slope > 0\.3/, replacement: "Độ dốc EMA20 rất mạnh" },
  { pattern: /Gia pullback ve EMA20.*/, replacement: "Giá pullback chạm EMA20" },
  { pattern: /(\d+) doji lien tiep.*/, replacement: "$1 doji liên tiếp" },
  { pattern: /nen (.*) pha vo.*entry (LONG|SHORT).*/, replacement: "Nến $1 xác nhận breakout" },
  { pattern: /entry (LONG|SHORT) tai (\S+)/, replacement: "Entry $1 tại $2" },
  { pattern: /block.*near EMA.*/, replacement: "Block nén chặt sát EMA20" },
  { pattern: /range.*window.*/, replacement: "Vùng tích lũy rõ ràng" },
  { pattern: /Bonus confidence.*/, replacement: "Tín hiệu mạnh (trend rõ)" },
  { pattern: /Penalty.*/, replacement: "Cảnh báo: breakout yếu" },
  { pattern: /edgeTestCount.*/, replacement: "Đã test biên nhiều lần, breakout đáng tin" },
  { pattern: /break.*direction.*/, replacement: "Breakout theo xu hướng chính" },
  { pattern: /false.break/, replacement: "False break phát hiện, chờ xác nhận lại" },
];

/**
 * Dịch 1 dòng ruleTrace thành câu tiếng Việt tự nhiên.
 * Nếu không có template khớp, giữ nguyên dòng gốc.
 */
function translateRule(rule: string): string {
  for (const { pattern, replacement } of REASON_TEMPLATES) {
    if (pattern.test(rule)) {
      return rule.replace(pattern, replacement);
    }
  }
  return rule;
}

/**
 * Map SetupKind → tên hiển thị (giữ nguyên format telegram.ts `getPatternInfo` parse được).
 */
function setupDisplayName(kind: SetupKind): string {
  return kind; // Giữ nguyên "DD", "FB", "BB", "RB", "ARB", "IRB", "SB"
}

/**
 * Build risks from confidence penalties.
 */
function buildRisks(signal: DetectedSignal): string[] {
  const risks: string[] = [];

  if (signal.confidence < 70) {
    // Look for penalties in ruleTrace
    const hasWeakBreakout = signal.ruleTrace.some(
      (r) => r.includes("Penalty") || r.includes("yeu"),
    );
    const hasLowVolume = signal.ruleTrace.some((r) => r.includes("volume"));
    const hasNoTrend = signal.ruleTrace.some((r) => r.includes("FLAT"));

    if (hasWeakBreakout) {
      risks.push("Nến breakout yếu, cần thêm xác nhận trước khi vào lệnh");
    }
    if (hasLowVolume) {
      risks.push("Volume tại điểm breakout thấp, khả năng false break cao");
    }
    if (hasNoTrend) {
      risks.push("Trend chưa rõ ràng, breakout có thể yếu");
    }
    // Generic low confidence risk
    if (risks.length === 0) {
      risks.push("Tín hiệu chưa đủ mạnh, cần theo dõi thêm xác nhận");
    }
  }

  return risks;
}

// ---------------------------------------------------------------------------
// Main assembly functions
// ---------------------------------------------------------------------------

/**
 * Build a TradeSetup (compatible with downstream code) from a DetectedSignal.
 */
export function buildTradeSetupFromSignal(
  signal: DetectedSignal,
  ohlcContext: { lastPrice: number | null },
): TradeSetup | null {
  const { setup, pair, direction, entry, stopLoss, takeProfit1, takeProfit2, confidence, triggerIndex, ruleTrace, timeframe } = signal;

  // Determine order type
  const isLastCandle = triggerIndex === triggerIndex; // signal is at current index - no way to know "last" without passing array length
  const orderType: ChartOrderType = direction === "LONG" ? "BUY_STOP" : "SELL_STOP";

  // Map ruleTrace to Vietnamese reasons
  const reasons = ruleTrace.map(translateRule);

  // Build risks
  const risks = buildRisks(signal);

  // Entry condition from last ruleTrace line
  const lastRule = ruleTrace[ruleTrace.length - 1] || "";
  const entryCondition = translateRule(lastRule);

  // Summary
  const summary = `${pair} ${direction} — ${setup} (${confidence}%)`;

  // Format prices
  const entryStr = formatPrice(entry);
  const stopStr = formatPrice(stopLoss);
  const tp1Str = formatPrice(takeProfit1);
  const tp2Str = formatPrice(takeProfit2);

  // Calculate risk-reward via position-engine's function
  const mockSetup: Pick<TradeSetup, "direction" | "entry" | "stopLoss" | "takeProfit1" | "takeProfit2" | "setup"> = {
    direction,
    entry: entryStr,
    stopLoss: stopStr,
    takeProfit1: tp1Str,
    takeProfit2: tp2Str,
    setup: setupDisplayName(setup),
  };
  const rrp = calculateRiskRewardPlan(mockSetup);

  const tradeSetup: TradeSetup = {
    pair,
    direction,
    setup: setupDisplayName(setup),
    primaryTimeframe: timeframe,
    reasons,
    risks,
    confidence,
    entry: entryStr,
    stopLoss: stopStr,
    takeProfit1: tp1Str,
    takeProfit2: tp2Str,
    riskReward: rrp ? `${rrp.tp1RiskReward.toFixed(1)}R` : "N/A",
    summary,
    orderType,
    entryCondition,
    lastPrice: ohlcContext.lastPrice ?? undefined,
    ruleTrace,
    detectionSource: "deterministic",
  };

  // Apply price sanity checks
  const checked = applyPriceSanityChecks(tradeSetup, ohlcContext.lastPrice);
  // Trả null khi price sanity reject setup (vd giá đã vượt stop loss)
  if (checked.setup === null) return null;
  return checked.setup;
}

/**
 * Build a PairSummary (compatible with downstream code) from context.
 */
export function buildPairSummaryFromContext(
  pair: string,
  trend: TrendState,
  emaDistanceAtr: number,
  hasActiveSignal: boolean,
): PairSummary {
  // Map TrendState to Vietnamese
  const trendMap: Record<TrendState, string> = {
    UPTREND: "Tăng",
    DOWNTREND: "Giảm",
    FLAT: "Đi ngang",
  };

  // Determine emaProximity
  const emaProximity: "tại" | "gần" | "xa" =
    emaDistanceAtr <= 0.3 ? "tại" : emaDistanceAtr <= 1 ? "gần" : "xa";

  // Status based on active signal
  const status = hasActiveSignal ? "Có setup chờ xác nhận" : "Không có setup";

  // Confidence
  const confidence = hasActiveSignal ? 70 : 0;

  return {
    pair,
    trend: trendMap[trend],
    emaProximity,
    status,
    confidence,
    detectionSource: "deterministic",
  };
}