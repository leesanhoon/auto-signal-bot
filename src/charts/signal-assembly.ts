import type { DetectedSignal, SetupKind } from "./setup-types.js";
import type { TradeSetup, PairSummary, ChartTimeframe, ChartOrderType } from "./chart-types-volman.js";
import type { Candle } from "./ohlc-provider.js";
import type { TrendState } from "./indicators.js";
import { formatPrice, applyPriceSanityChecks } from "./analyzer-volman.js";
import { getConfiguredTpRMultiple } from "./volman-config-env.js";

// ---------------------------------------------------------------------------
// Rule-to-Vietnamese mapping for reasons
// ---------------------------------------------------------------------------

const REASON_TEMPLATES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /Trend=(UPTREND|DOWNTREND),?.*/, replacement: "EMA21 đang dốc $1 rõ ràng" },
  { pattern: /Trend=FLAT.*/, replacement: "EMA21 đang đi ngang, phù hợp bối cảnh Range" },
  { pattern: /slope > 0\.3/, replacement: "Độ dốc EMA21 rất mạnh" },
  { pattern: /Gia pullback ve EMA(?:20|21).*/, replacement: "Giá pullback chạm EMA21" },
  { pattern: /(\d+) doji lien tiep.*/, replacement: "$1 doji liên tiếp" },
  { pattern: /nen (.*) pha vo.*entry (LONG|SHORT).*/, replacement: "Nến $1 xác nhận breakout" },
  { pattern: /entry (LONG|SHORT) tai (\S+)/i, replacement: "Entry $1 tại $2" },
  { pattern: /^Cum doji: dinh=(\S+), day=(\S+)$/, replacement: "Cụm doji: đỉnh=$1, đáy=$2" },
  { pattern: /^Hop nen: dinh=(\S+), day=(\S+)$/, replacement: "Hộp nén: đỉnh=$1, đáy=$2" },
  { pattern: /^Hop range: dinh=(\S+), day=(\S+)$/, replacement: "Hộp range: đỉnh=$1, đáy=$2" },
  { pattern: /block.*near EMA.*/, replacement: "Block nén chặt sát EMA20" },
  { pattern: /range.*window.*/, replacement: "Vùng tích lũy rõ ràng" },
  { pattern: /Bonus confidence.*/, replacement: "Tín hiệu mạnh (trend rõ)" },
  { pattern: /Penalty.*/, replacement: "Cảnh báo: breakout yếu" },
  { pattern: /^Range detected w=\d+, range=(\S+)$/, replacement: "Phát hiện vùng tích lũy (range=$1)" },
  { pattern: /^Khong phat hien Range$/, replacement: "Không phát hiện vùng tích lũy" },
  { pattern: /^Nen (\S+) \(range=(\S+), max=(\S+)\)$/, replacement: "Nến nén $1 (range=$2, max=$3)" },
  { pattern: /^Gia chua pha range \(close=(\S+)\)$/, replacement: "Giá chưa phá vùng tích lũy (close=$1)" },
  { pattern: /^Breakout (LONG|SHORT) phat hien$/, replacement: "Breakout $1 đã xuất hiện" },
  { pattern: /^EMA21 slope=(\S+) khong cung huong breakout (LONG|SHORT)$/, replacement: "EMA21 slope=$1 không cùng hướng breakout $2" },
  { pattern: /^EMA21 slope=(\S+) cung huong breakout (LONG|SHORT)$/, replacement: "EMA21 slope=$1 cùng hướng breakout $2" },
  { pattern: /^EMA21 da doc tu truoc \(slopeBefore=(\S+)\) -> khong phai boi canh Range \(MA phang\)$/, replacement: "EMA21 đã dốc từ trước (slopeBefore=$1) — không phải bối cảnh Range (MA phẳng)" },
  { pattern: /^EMA21 phang truoc breakout \(slopeBefore=(\S+)\)$/, replacement: "EMA21 phẳng trước breakout (slopeBefore=$1)" },
  { pattern: /^Range qua xa EMA21 \(khoang cach=(\S+) > (\S+)\) -> gia khong con ton trong EMA$/, replacement: "Range quá xa EMA21 (khoảng cách=$1 > $2) — giá không còn tôn trọng EMA" },
  { pattern: /^Range gan EMA21 \(khoang cach=(\S+) <= (\S+)\)$/, replacement: "Range gần EMA21 (khoảng cách=$1 <= $2)" },
  { pattern: /^Edge test #(\d+) at index (\d+): (high|low)=(\S+), close=(\S+)$/, replacement: "Test biên #$1 tại nến $2: $3=$4, close=$5" },
  { pattern: /^edgeTestCount=(\d+) < 2 -> khong du test bien cho ARB$/, replacement: "edgeTestCount=$1 < 2 — chưa đủ số lần test biên cho ARB" },
  { pattern: /^edgeTestCount=(\d+) >= 3 -> range da het hieu luc$/, replacement: "edgeTestCount=$1 >= 3 — vùng tích lũy đã hết hiệu lực" },
  { pattern: /^Current breakout is false \(edgeTestCount now (\d+)\)$/, replacement: "Breakout hiện tại là false break (edgeTestCount hiện là $1)" },
  { pattern: /^Lan that bai thu 3 -> range het hieu luc$/, replacement: "Lần thất bại thứ 3 — vùng tích lũy hết hiệu lực" },
  { pattern: /^Current breakout khong bi false$/, replacement: "Breakout hiện tại không phải false break" },
  { pattern: /^Vung moi: high=(\S+), low=(\S+)$/, replacement: "Vùng mồi: đỉnh=$1, đáy=$2" },
  { pattern: /^Pha vo muc moi tai gia (\S+), gap=(\S+)$/, replacement: "Phá vỡ mức mồi tại giá $1 (gap=$2)" },
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
  ohlcContext: { lastPrice: number | null; candles?: Candle[]; ma21?: (number | null)[] },
): TradeSetup | null {
  const { setup, pair, direction, entry, stopLoss, takeProfit, confidence, triggerIndex, ruleTrace, timeframe, geometry } = signal;

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
  const takeProfitStr = formatPrice(takeProfit);

  // Build chartContext if candles and ma21 are available
  const CHART_CONTEXT_WINDOW = 60;
  let chartContext: TradeSetup["chartContext"];
  if (ohlcContext.candles && ohlcContext.ma21) {
    const sliceStartIndex = Math.max(0, triggerIndex - CHART_CONTEXT_WINDOW);
    const sliceEndIndex = Math.min(ohlcContext.candles.length, triggerIndex + 2);
    chartContext = {
      candles: ohlcContext.candles.slice(sliceStartIndex, sliceEndIndex),
      ma21: ohlcContext.ma21.slice(sliceStartIndex, sliceEndIndex),
      triggerIndex,
      sliceStartIndex,
      geometry,
    };
  }

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
    takeProfit1: takeProfitStr,
    takeProfit2: null,
    riskReward: `1:${getConfiguredTpRMultiple()}`,
    summary,
    orderType,
    entryCondition,
    lastPrice: ohlcContext.lastPrice ?? undefined,
    ruleTrace,
    detectionSource: "deterministic",
    chartContext,
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
