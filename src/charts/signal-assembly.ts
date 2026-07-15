import type { DetectedSignal, SetupKind } from "./model/setup-types.js";
import type { TradeSetup, PairSummary, ChartTimeframe, ChartOrderType } from "./model/chart-types-volman.js";
import type { Candle } from "./client/ohlc-provider.js";
import type { TrendState } from "./indicators.js";
import { formatPrice, applyPriceSanityChecks } from "./analyzer-volman.js";
import { getConfiguredTpRMultiple } from "./model/volman-config-env.js";

// ---------------------------------------------------------------------------
// Rule-to-Vietnamese mapping for reasons
// ---------------------------------------------------------------------------

const REASON_TEMPLATES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /^Trend=UPTREND,?.*$/, replacement: "EMA21 đang dốc lên rõ ràng" },
  { pattern: /^Trend=DOWNTREND,?.*$/, replacement: "EMA21 đang dốc xuống rõ ràng" },
  { pattern: /Trend=(UPTREND|DOWNTREND),?.*/, replacement: "EMA21 đang dốc $1 rõ ràng" },
  { pattern: /Trend=FLAT.*/, replacement: "EMA21 đang đi ngang, phù hợp bối cảnh Range" },
  { pattern: /slope > 0\.3/, replacement: "Độ dốc EMA21 rất mạnh" },
  { pattern: /Gia pullback ve EMA(?:20|21).*/, replacement: "Giá pullback chạm EMA21" },
  { pattern: /^(\d+) doji lien tiep tai index (\d+)-(\d+)$/, replacement: "$1 nến doji liên tiếp tại nến $2-$3" },
  { pattern: /(\d+) doji lien tiep.*/, replacement: "$1 doji liên tiếp" },
  { pattern: /nen (.*) pha vo.*entry (LONG|SHORT).*/, replacement: "Nến $1 xác nhận breakout" },
  { pattern: /^Nen (\d+) xac nhan -> entry (LONG|SHORT) tai (\S+)$/, replacement: "Nến $1 xác nhận — entry $2 tại $3" },
  { pattern: /^Entry (LONG|SHORT) tai (\S+), Stop=(\S+)$/, replacement: "Entry $1 tại $2, Stop tại $3" },
  { pattern: /^Entry (LONG|SHORT) tai (\S+), rangeHeight=(\S+)$/, replacement: "Entry $1 tại $2, chiều cao vùng=$3" },
  { pattern: /entry (LONG|SHORT) tai (\S+)/i, replacement: "Entry $1 tại $2" },
  { pattern: /^Trend bat dau tu index (\d+)$/, replacement: "Xu hướng mới bắt đầu hình thành tại nến $1" },
  { pattern: /^Trend chuyen tu FLAT tai ~index (\d+)$/, replacement: "EMA21 chuyển từ đi ngang sang xu hướng mới quanh nến $1" },
  { pattern: /^Trend dao chieu tai ~index (\d+)$/, replacement: "Xu hướng đảo chiều quanh nến $1" },
  { pattern: /^Cham EMA21, distance=(\S+) ATR$/, replacement: "Giá chạm EMA21 (cách $1 ATR)" },
  { pattern: /^touchCount=(\d+) \(tu trendStartIndex (\d+)\)$/, replacement: "Đã chạm EMA21 $1 lần kể từ khi xu hướng hình thành tại nến $2" },
  { pattern: /^Pullback la song hieu hoa$/, replacement: "Sóng kéo ngược là sóng hài hòa (đơn lẻ, không nằm ngang)" },
  { pattern: /^Cham EMA21, dat stop order tai bien nen tin hieu, bodyRatio hien tai=(\S+)$/, replacement: "Giá chạm EMA21; đặt stop order tại biên nến tín hiệu (tỷ lệ thân nến=$1)" },
  { pattern: /^Custer doji sat EMA21, distance=(\S+) ATR$/, replacement: "Cụm doji sát EMA21 (cách $1 ATR)" },
  { pattern: /^Pattern W: low1=(\S+) @ index (\d+), low2=(\S+) @ index (\d+)$/, replacement: "Mô hình chữ W: đáy 1=$1 tại nến $2, đáy 2=$3 tại nến $4" },
  { pattern: /^Pattern W: high1=(\S+) @ index (\d+), high2=(\S+) @ index (\d+)$/, replacement: "Mô hình chữ M: đỉnh 1=$1 tại nến $2, đỉnh 2=$3 tại nến $4" },
  { pattern: /^Song dan toi day 1 la song hai hoa$/, replacement: "Sóng dẫn tới đáy thứ nhất là sóng hài hòa" },
  { pattern: /^Song dan toi dinh 1 la song hai hoa$/, replacement: "Sóng dẫn tới đỉnh thứ nhất là sóng hài hòa" },
  { pattern: /^Day 1 bi false break \(xac nhan pattern W\)$/, replacement: "Đáy thứ nhất bị phá vỡ mồi, xác nhận mô hình chữ W" },
  { pattern: /^Dinh 1 bi false break \(xac nhan pattern W\)$/, replacement: "Đỉnh thứ nhất bị phá vỡ mồi, xác nhận mô hình chữ M" },
  { pattern: /^Pattern W san sang, cho gia pha len tren (\S+) de xac nhan \(Alert\)$/, replacement: "Mô hình chữ W đã sẵn sàng; chờ giá phá lên trên $1 để xác nhận" },
  { pattern: /^Pattern W san sang, cho gia pha xuong duoi (\S+) de xac nhan \(Alert\)$/, replacement: "Mô hình chữ M đã sẵn sàng; chờ giá phá xuống dưới $1 để xác nhận" },
  { pattern: /^Cum doji: dinh=(\S+), day=(\S+)$/, replacement: "Cụm doji: đỉnh=$1, đáy=$2" },
  { pattern: /^Hop nen: dinh=(\S+), day=(\S+)$/, replacement: "Hộp nén: đỉnh=$1, đáy=$2" },
  { pattern: /^Hop range: dinh=(\S+), day=(\S+)$/, replacement: "Hộp tích lũy: đỉnh=$1, đáy=$2" },
  { pattern: /^EMA21 slope=(\S+)$/, replacement: "Độ dốc EMA21=$1" },
  { pattern: /^Block detected w=(\d+), range=(\S+), distanceToEma=(\S+)$/, replacement: "Phát hiện hộp nén $1 nến (biên độ=$2, cách EMA21 $3 ATR)" },
  { pattern: /^Block sat EMA21, distance=(\S+) ATR$/, replacement: "Hộp nén nằm sát EMA21 (cách $1 ATR)" },
  { pattern: /^Block san sang, theo trend (LONG|SHORT): STOP chap Binance truoc khi gia breakout$/, replacement: "Hộp nén đã sẵn sàng theo hướng $1; đặt stop order được Binance chấp nhận trước khi giá phá vỡ" },
  { pattern: /^Range detected w=(\d+), range=(\S+), distanceToEma=(\S+)$/, replacement: "Phát hiện vùng tích lũy $1 nến (biên độ=$2, cách EMA21 $3 ATR)" },
  { pattern: /^(\d+) lan cham bat bien (tren|duoi) \(>=2, dat\)$/, replacement: "Đã chạm bật biên quan trọng $1 lần (đạt yêu cầu tối thiểu 2 lần)" },
  { pattern: /^EMA21 phang truoc breakout \(slopeBefore=(\S+)\), chuyen sang doc \(slopeNow=(\S+)\)$/, replacement: "EMA21 phẳng trước phá vỡ (độ dốc trước=$1), sau đó chuyển sang dốc (độ dốc hiện tại=$2)" },
  { pattern: /^Breakout (LONG|SHORT) pha ca RangeInner va RangeOuter$/, replacement: "Phá vỡ $1 xuyên qua cả vùng nén trong và vùng nén ngoài" },
  { pattern: /^RangeInner pha index (\d+), RangeOuter pha index (\d+) -> chap nhan \((LONG|SHORT)\)$/, replacement: "Vùng nén trong bị phá tại nến $1, vùng nén ngoài bị phá tại nến $2 — chấp nhận hướng $3" },
  { pattern: /^RangeOuter detected w=(\d+), range=(\S+), high=(\S+), low=(\S+)$/, replacement: "Phát hiện vùng nén ngoài $1 nến (biên độ=$2, đỉnh=$3, đáy=$4)" },
  { pattern: /^RangeInner detected w=(\d+), range=(\S+)$/, replacement: "Phát hiện vùng nén trong $1 nến (biên độ=$2)" },
  { pattern: /^RangeInner nam giua RangeOuter \(centerOffset=(\S+) <= (\S+)\)$/, replacement: "Vùng nén trong nằm giữa vùng nén ngoài (độ lệch tâm=$1 <= $2)" },
  { pattern: /^RangeInner TIGHT, RangeOuter TIGHT$/, replacement: "Vùng nén trong chặt, vùng nén ngoài chặt" },
  { pattern: /^RangeInner TIGHT, RangeOuter LOOSE$/, replacement: "Vùng nén trong chặt, vùng nén ngoài lỏng" },
  { pattern: /^RangeInner LOOSE, RangeOuter TIGHT$/, replacement: "Vùng nén trong lỏng, vùng nén ngoài chặt" },
  { pattern: /^RangeInner LOOSE, RangeOuter LOOSE$/, replacement: "Vùng nén trong lỏng, vùng nén ngoài lỏng" },
  { pattern: /^RangeInner (\S+), RangeOuter (\S+)$/, replacement: "Độ nén vùng trong=$1, độ nén vùng ngoài=$2" },
  { pattern: /^Edge test bonus: \+(\d+) \((\d+) tests x 10\)$/, replacement: "Thưởng độ tin cậy: +$1 (đã test biên $2 lần)" },
  { pattern: /block.*near EMA.*/, replacement: "Block nén chặt sát EMA20" },
  { pattern: /range.*window.*/, replacement: "Vùng tích lũy rõ ràng" },
  { pattern: /^Bonus confidence: trend ro \(\|slope\|>0\.3\)$/, replacement: "Thưởng độ tin cậy: xu hướng rõ (|độ dốc| > 0.3)" },
  { pattern: /^Bonus confidence: FLAT->trend ro ret$/, replacement: "Thưởng độ tin cậy: EMA21 chuyển rõ từ phẳng sang dốc" },
  { pattern: /^Bonus confidence: nen chặt, phá vỡ đáng tin cậy \(\+5\)$/, replacement: "Thưởng độ tin cậy: +5 (đoạn nén chặt, phá vỡ đáng tin cậy)" },
  { pattern: /^Penalty: nen pha vo yeu \(bodyRatio=(\S+) < 0\.3\)$/, replacement: "Cảnh báo: nến phá vỡ yếu (tỷ lệ thân nến=$1 < 0.3)" },
  { pattern: /Bonus confidence.*/, replacement: "Tín hiệu mạnh (trend rõ)" },
  { pattern: /Penalty.*/, replacement: "Cảnh báo: breakout yếu" },
  { pattern: /^Range detected w=(\d+), range=(\S+)$/, replacement: "Phát hiện vùng tích lũy $1 nến (biên độ=$2)" },
  { pattern: /^Khong phat hien Range$/, replacement: "Không phát hiện vùng tích lũy" },
  { pattern: /^Nen TIGHT \(range=(\S+), max=(\S+)\)$/, replacement: "Đoạn nén chặt (biên độ=$1, tối đa=$2)" },
  { pattern: /^Nen LOOSE \(range=(\S+), max=(\S+)\)$/, replacement: "Đoạn nén lỏng (biên độ=$1, tối đa=$2)" },
  { pattern: /^Nen (\S+) \(range=(\S+), max=(\S+)\)$/, replacement: "Độ nén $1 (biên độ=$2, tối đa=$3)" },
  { pattern: /^Gia chua pha range \(close=(\S+)\)$/, replacement: "Giá chưa phá vùng tích lũy (close=$1)" },
  { pattern: /^Breakout (LONG|SHORT) phat hien$/, replacement: "Phá vỡ $1 đã xuất hiện" },
  { pattern: /^EMA21 slope=(\S+) khong cung huong breakout (LONG|SHORT)$/, replacement: "Độ dốc EMA21=$1 không cùng hướng phá vỡ $2" },
  { pattern: /^EMA21 slope=(\S+) cung huong breakout (LONG|SHORT)$/, replacement: "Độ dốc EMA21=$1 cùng hướng phá vỡ $2" },
  { pattern: /^EMA21 da doc tu truoc \(slopeBefore=(\S+)\) -> khong phai boi canh Range \(MA phang\)$/, replacement: "EMA21 đã dốc từ trước (slopeBefore=$1) — không phải bối cảnh Range (MA phẳng)" },
  { pattern: /^EMA21 phang truoc breakout \(slopeBefore=(\S+)\)$/, replacement: "EMA21 phẳng trước phá vỡ (độ dốc trước=$1)" },
  { pattern: /^Range qua xa EMA21 \(khoang cach=(\S+) > (\S+)\) -> gia khong con ton trong EMA$/, replacement: "Range quá xa EMA21 (khoảng cách=$1 > $2) — giá không còn tôn trọng EMA" },
  { pattern: /^Range gan EMA21 \(khoang cach=(\S+) <= (\S+)\)$/, replacement: "Vùng tích lũy gần EMA21 (khoảng cách=$1 <= $2)" },
  { pattern: /^Edge test #(\d+) at index (\d+): high=(\S+), close=(\S+)$/, replacement: "Chạm bật biên trên #$1 tại nến $2: đỉnh=$3, giá đóng=$4" },
  { pattern: /^Edge test #(\d+) at index (\d+): low=(\S+), close=(\S+)$/, replacement: "Chạm bật biên dưới #$1 tại nến $2: đáy=$3, giá đóng=$4" },
  { pattern: /^Edge test #(\d+) at index (\d+): (high|low)=(\S+), close=(\S+)$/, replacement: "Chạm bật biên #$1 tại nến $2: mức=$4, giá đóng=$5" },
  { pattern: /^edgeTestCount=(\d+) < 2 -> khong du test bien cho ARB$/, replacement: "edgeTestCount=$1 < 2 — chưa đủ số lần test biên cho ARB" },
  { pattern: /^edgeTestCount=(\d+) >= 3 -> range da het hieu luc$/, replacement: "edgeTestCount=$1 >= 3 — vùng tích lũy đã hết hiệu lực" },
  { pattern: /^Current breakout is false \(edgeTestCount now (\d+)\)$/, replacement: "Lần phá vỡ hiện tại là phá vỡ mồi (số lần chạm bật biên hiện là $1)" },
  { pattern: /^Lan that bai thu 3 -> range het hieu luc$/, replacement: "Lần thất bại thứ 3 — vùng tích lũy hết hiệu lực" },
  { pattern: /^Current breakout khong bi false$/, replacement: "Lần phá vỡ hiện tại không phải phá vỡ mồi" },
  { pattern: /^Vung moi: high=(\S+), low=(\S+)$/, replacement: "Vùng mồi: đỉnh=$1, đáy=$2" },
  { pattern: /^Pha vo muc moi tai gia (\S+), gap=(\S+)$/, replacement: "Phá vỡ mức mồi tại giá $1 (khoảng trống=$2)" },
  { pattern: /edgeTestCount.*/, replacement: "Đã chạm bật biên nhiều lần, phá vỡ đáng tin cậy" },
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
    const sliceEndIndex = ohlcContext.candles.length;
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
