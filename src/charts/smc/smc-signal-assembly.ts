import type { PairSummary, TradeSetup } from "../chart-types.js";
import { applyPriceSanityChecks, formatPrice } from "../analyzer.js";
import type {
  SmcEntryZone,
  SmcGrade,
  SmcLiquidityTarget,
  SmcSignal,
} from "./smc-types.js";

function formatMoney(value: number): string {
  return `$${formatPrice(value)}`;
}

export function gradeFromScore(score: number): SmcGrade {
  if (score >= 80) return "A";
  if (score >= 50) return "B";
  if (score >= 35) return "C";
  return "D";
}

function mapOrderType(direction: "LONG" | "SHORT", entry: number, lastPrice: number | null | undefined) {
  if (lastPrice === null || lastPrice === undefined || !Number.isFinite(lastPrice)) {
    return direction === "LONG" ? "BUY_LIMIT" : "SELL_LIMIT";
  }
  if (direction === "LONG") {
    return entry <= lastPrice ? "BUY_LIMIT" : "BUY_STOP";
  }
  return entry >= lastPrice ? "SELL_LIMIT" : "SELL_STOP";
}

function buildReasons(signal: SmcSignal): string[] {
  const reasons = [
    `SMC setup ${signal.setup} cho ${signal.pair}.`,
    ...signal.ruleTrace.slice(0, 4).map((line) => `Luận điểm: ${line}`),
  ];
  if (signal.confluence && signal.confluence.agreementCount > 0) {
    const trendWord = signal.direction === "SHORT" ? "bearish" : "bullish";
    const trendLabelVi = signal.direction === "SHORT" ? "giảm" : "tăng";
    const tfList = signal.confluence.agreeingTimeframes.join(" & ");
    reasons.unshift(
      `Đa khung đồng thuận: ${tfList} đều ${trendWord}, hỗ trợ xu hướng ${trendLabelVi}.`,
    );
  }
  if (signal.structureEvent) {
    reasons.push(
      `${signal.structureEvent.kind} ${signal.structureEvent.direction === "LONG" ? "tăng" : "giảm"} tại mức ${formatPrice(signal.structureEvent.level)}.`,
    );
  }
  if (signal.liquiditySweep) {
    reasons.push(
      `Quét thanh khoản ${signal.liquiditySweep.direction === "LONG" ? "bên dưới" : "bên trên"} ${formatPrice(signal.liquiditySweep.sweptLevel)} rồi xác nhận lại.`,
    );
  }
  if (signal.orderBlock) {
    reasons.push(
      `Order block ${signal.orderBlock.direction} quanh ${formatPrice(signal.orderBlock.midpoint)}.`,
    );
  }
  if (signal.premiumDiscountZone) {
    const zoneLabel = signal.premiumDiscountZone.zone === "PREMIUM"
      ? "vùng premium"
      : signal.premiumDiscountZone.zone === "DISCOUNT"
        ? "vùng discount"
        : "vùng equilibrium";
    reasons.push(
      `Tại ${zoneLabel} (${signal.premiumDiscountZone.percentInRange.toFixed(0)}% range).`,
    );
  }
  if (signal.priorPeriodLevels) {
    const { priorDayLow, priorDayHigh } = signal.priorPeriodLevels;
    const relevantLevel = signal.direction === "SHORT" ? priorDayLow : priorDayHigh;
    if (relevantLevel !== null && relevantLevel !== undefined) {
      const entry = signal.entry;
      const tp1 = signal.takeProfit1;
      const between = signal.direction === "SHORT"
        ? relevantLevel < entry && relevantLevel > tp1
        : relevantLevel > entry && relevantLevel < tp1;
      if (between) {
        const label = signal.direction === "SHORT" ? "PDL" : "PDH";
        reasons.push(`Lưu ý: ${label} ${formatPrice(relevantLevel)} nằm trước TP1, có thể gây nhiễu.`);
      }
    }
  }
  if (signal.hasRejectionWick && signal.rvol !== undefined) {
    const pressureLabel = signal.direction === "SHORT" ? "áp lực bán mạnh" : "áp lực mua mạnh";
    reasons.push(
      `Xác nhận rejection_wick (RVOL ${signal.rvol.toFixed(2)}) cho thấy ${pressureLabel}.`,
    );
  }
  if (signal.fairValueGap) {
    reasons.push(
      `FVG ${signal.fairValueGap.direction} từ ${formatPrice(signal.fairValueGap.low)} đến ${formatPrice(signal.fairValueGap.high)}.`,
    );
  }
  return reasons;
}

function buildRisks(signal: SmcSignal): string[] {
  const risks = [
    "Khối lượng thay đổi nhanh có thể làm giá quét lại vùng entry.",
    "Chỉ vào lệnh khi cấu trúc SMC vẫn còn hợp lệ trên khung thời gian chính.",
  ];
  if (signal.takeProfit3 !== undefined) {
    risks.push("Chia lệnh chốt lời theo TP1/TP2/TP3 để giảm rủi ro đảo chiều.");
  }
  return risks;
}

function formatEntryZone(entryZone: SmcEntryZone | undefined): { low: string; high: string } | undefined {
  if (!entryZone) return undefined;
  return {
    low: formatPrice(entryZone.low),
    high: formatPrice(entryZone.high),
  };
}

function buildLiquidityTargets(targets: SmcLiquidityTarget[] | undefined): TradeSetup["liquidityTargets"] {
  return targets?.map((target) => ({
    label: target.label,
    price: formatPrice(target.price),
    target: target.target,
    riskReward: target.riskReward !== undefined ? target.riskReward.toFixed(1) : undefined,
  }));
}

function calculateRiskReward(entry: number, stopLoss: number, target: number): string {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(target - entry);
  return `${(reward / Math.max(0.00001, risk)).toFixed(1)}:1`;
}

function buildCapitalManagement(signal: SmcSignal): string[] {
  return signal.capitalManagement?.length
    ? signal.capitalManagement.slice()
    : [
        "Risk 1-2% tài khoản cho lệnh này.",
        signal.takeProfit3 !== undefined
          ? "Chiến lược chốt lời: 50% tại TP1, 30% tại TP2, 20% tại TP3."
          : "Chiến lược chốt lời: 50% tại TP1, 50% tại TP2.",
        "Kéo SL về entry/breakeven khi chạm TP1.",
      ];
}

export function buildTradeSetupFromSmcSignal(
  signal: SmcSignal,
  options: { lastPrice: number | null },
): TradeSetup | null {
  const lastPrice = options.lastPrice;
  const setup: TradeSetup = {
    pair: signal.pair,
    direction: signal.direction,
    setup: signal.setup,
    primaryTimeframe: signal.timeframe,
    reasons: buildReasons(signal),
    risks: buildRisks(signal),
    confidence: signal.confidence,
    entry: formatPrice(signal.entry),
    stopLoss: formatPrice(signal.stopLoss),
    takeProfit1: formatPrice(signal.takeProfit1),
    takeProfit2: formatPrice(signal.takeProfit2),
    riskReward: `${Math.max(0, Math.abs(signal.takeProfit1 - signal.entry) / Math.max(0.00001, Math.abs(signal.entry - signal.stopLoss))).toFixed(1)}:1`,
    summary: `${signal.pair} ${signal.direction} ${signal.setup} | Grade ${signal.grade} | Score ${signal.score}/100`,
    orderType: mapOrderType(signal.direction, signal.entry, lastPrice),
    entryCondition: signal.entryZone
      ? `Chờ giá vào vùng ${formatPrice(signal.entryZone.low)} - ${formatPrice(signal.entryZone.high)} rồi xác nhận cấu trúc SMC.`
      : "Chờ giá phản ứng theo setup SMC.",
    ruleTrace: signal.ruleTrace.slice(),
    detectionSource: "smc",
    lastPrice,
    grade: signal.grade,
    score: signal.score,
    market: signal.market,
    session: signal.session,
    sessionLabel: signal.sessionLabel,
    entryZone: formatEntryZone(signal.entryZone),
    stopLossDistance: formatMoney(Math.abs(signal.entry - signal.stopLoss)),
    takeProfit3: signal.takeProfit3 !== undefined ? formatPrice(signal.takeProfit3) : undefined,
    takeProfitAllocations: signal.takeProfit3 !== undefined
      ? { tp1: 50, tp2: 30, tp3: 20 }
      : { tp1: 50, tp2: 50, tp3: 0 },
    liquidityTargets: buildLiquidityTargets(signal.liquidityTargets),
    capitalManagement: buildCapitalManagement(signal),
  };

  setup.liquidityTargets = setup.liquidityTargets?.map((target) => ({
    ...target,
    riskReward:
      target.riskReward !== undefined
        ? target.riskReward
        : calculateRiskReward(signal.entry, signal.stopLoss, Number.parseFloat(target.price)),
  }));

  const checked = applyPriceSanityChecks(setup, lastPrice);
  return checked.setup;
}

export function buildSmcPairSummary(
  pair: string,
  trend: string,
  confidence: number,
  hasSetup: boolean,
  ruleTrace: string[] = [],
): PairSummary {
  return {
    pair,
    trend,
    status: hasSetup ? "Có setup SMC đang hoạt động" : "Không có setup SMC",
    confidence: hasSetup ? confidence : 0,
    ruleTrace: ruleTrace.length > 0 ? ruleTrace.slice() : undefined,
    detectionSource: "smc",
  };
}
