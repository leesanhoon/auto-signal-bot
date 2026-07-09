import type { AnalysisResult, ChartTimeframe, PairSummary, TradeSetup } from "../chart-types.js";
import { fetchOhlcHistory } from "../ohlc-provider.js";
import { createLogger } from "../../shared/logger.js";
import { buildSmcPairSummary, buildTradeSetupFromSmcSignal, gradeFromScore } from "./smc-signal-assembly.js";
import { checkMultiTimeframeConfluence, detectTimeframeBias } from "./smc-confluence.js";
import {
  calculatePremiumDiscountZone,
  calculatePriorPeriodLevels,
  calculateRvol,
  detectRejectionWick,
  findEqualLevels,
} from "./smc-liquidity-context.js";
import { detectSession } from "./smc-session.js";
import {
  detectFairValueGap,
  detectStructureBreak,
  findRecentOrderBlock,
  findSwingPoints,
} from "./smc-structure.js";
import type { SmcSignal, SmcSetupName, SmcDirection } from "./smc-types.js";
import { buildHtfContext } from "./smc-htf-context.js";
import type { HtfContext } from "./smc-htf-context.js";
import type { Candle } from "../ohlc-provider.js";

const logger = createLogger("charts:smc-pipeline");

type PairInput = { pair: string; symbol: string };

type CandidateSource = {
  signal: SmcSignal;
  confidence: number;
  triggerIndex: number;
};

function analysisTimeframe(
  options: { timeframeMode?: "multi" | "single"; primaryTimeframe?: ChartTimeframe } = {},
): ChartTimeframe {
  return options.timeframeMode === "single" ? (options.primaryTimeframe ?? "M15") : "M15";
}

function gradeToTrend(direction: SmcDirection): string {
  return direction === "LONG" ? "UPTREND" : "DOWNTREND";
}

function calculateLocalAtr(candles: Candle[], endIndex: number, lookback = 14): number {
  if (candles.length === 0 || endIndex < 0 || endIndex >= candles.length) return 0;

  const startIndex = Math.max(0, endIndex - lookback + 1);
  let sum = 0;
  let count = 0;

  for (let i = startIndex; i <= endIndex; i += 1) {
    const current = candles[i];
    const previousClose = i > 0 ? candles[i - 1].close : current.close;
    const trueRange = Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    );
    sum += trueRange;
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

function isValidLiquidityTarget(
  direction: SmcDirection,
  entry: number,
  risk: number,
  targetPrice: number,
): boolean {
  const isCorrectSide = direction === "LONG" ? targetPrice > entry : targetPrice < entry;
  const reward = Math.abs(targetPrice - entry);
  return isCorrectSide && reward > risk;
}

function sessionConfidencePenalty(session: string): number {
  if (session === "ASIA") return -5;
  if (session === "OFF_HOURS") return -10;
  return 0;
}

function isAgainstHtfBias(htfContext: HtfContext | null | undefined, direction: SmcDirection): boolean {
  return htfContext?.bias !== null && htfContext?.bias !== undefined && htfContext.bias !== direction;
}

function buildSignal(
  pair: string,
  timeframe: ChartTimeframe,
  kind: SmcSetupName,
  direction: SmcDirection,
  triggerIndex: number,
  entry: number,
  stopLoss: number,
  takeProfit1: number,
  takeProfit2: number,
  opts: Partial<Pick<SmcSignal, "takeProfit3" | "entryZone" | "liquidityTargets" | "structureEvent" | "liquiditySweep" | "orderBlock" | "premiumDiscountZone" | "priorPeriodLevels" | "rvol" | "hasRejectionWick" | "fairValueGap">> & {
    confidence: number;
    grade: SmcSignal["grade"];
    score: number;
    ruleTrace: string[];
    market?: string;
    session?: string;
    sessionLabel?: string;
  },
): SmcSignal {
  return {
    setup: kind,
    pair,
    timeframe,
    direction,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    triggerIndex,
    confidence: opts.confidence,
    grade: opts.grade,
    score: opts.score,
    ruleTrace: opts.ruleTrace,
    takeProfit3: opts.takeProfit3,
    entryZone: opts.entryZone,
    liquidityTargets: opts.liquidityTargets,
    structureEvent: opts.structureEvent,
    liquiditySweep: opts.liquiditySweep,
    orderBlock: opts.orderBlock,
    premiumDiscountZone: opts.premiumDiscountZone,
    priorPeriodLevels: opts.priorPeriodLevels,
    rvol: opts.rvol,
    hasRejectionWick: opts.hasRejectionWick,
    fairValueGap: opts.fairValueGap,
    market: opts.market,
    session: opts.session,
    sessionLabel: opts.sessionLabel,
  };
}

function applySessionPenalty(
  sessionInfo: { session: string; sessionLabel: string },
  confidence: number,
  score: number,
  ruleTrace: string[],
): Pick<SmcSignal, "confidence" | "score" | "grade" | "ruleTrace" | "session" | "sessionLabel"> {
  const penalty = sessionConfidencePenalty(sessionInfo.session);
  const adjustedConfidence = Math.max(0, confidence + penalty);
  const adjustedScore = Math.max(0, score + penalty);
  const adjustedRuleTrace = penalty === 0
    ? ruleTrace
    : [...ruleTrace, `Session ${sessionInfo.sessionLabel}: thanh khoan thap, da ha diem ${Math.abs(penalty)}.`];

  return {
    confidence: adjustedConfidence,
    score: adjustedScore,
    grade: gradeFromScore(adjustedScore),
    ruleTrace: adjustedRuleTrace,
    session: sessionInfo.session,
    sessionLabel: sessionInfo.sessionLabel,
  };
}

function buildSmcCandidatesAtIndex(
  candles: Awaited<ReturnType<typeof fetchOhlcHistory>> extends infer T ? T extends Error ? never : T : never,
  pair: string,
  timeframe: ChartTimeframe,
  index: number,
  htfContext?: HtfContext | null,
): CandidateSource[] {
  if (index < 4 || index >= candles.length) return [];

  const scopedCandles = candles.slice(0, index + 1);
  const swings = findSwingPoints(scopedCandles, { left: 2, right: 2 });
  const candidates: CandidateSource[] = [];

  const priorCandles = scopedCandles.slice(0, index);
  const previousBias = detectTimeframeBias(priorCandles) ?? undefined;
  const structure = detectStructureBreak(scopedCandles, swings, index, previousBias);
  if (structure) {
    const ob = findRecentOrderBlock(scopedCandles, index, structure.direction, 12);
    if (ob) {
      if (!isAgainstHtfBias(htfContext, structure.direction)) {
        const entry = ob.midpoint;
        const pdZone = htfContext
          ? calculatePremiumDiscountZone(entry, htfContext.swings, htfContext.candlesLength)
          : calculatePremiumDiscountZone(entry, swings, index);
        const isWrongPremiumDiscountZone = pdZone !== null && (
          (structure.direction === "LONG" && pdZone.zone === "PREMIUM")
          || (structure.direction === "SHORT" && pdZone.zone === "DISCOUNT")
        );
        const baseConfidence = structure.kind === "CHOCH" ? 72 : 80;
        const confidence = isWrongPremiumDiscountZone ? baseConfidence - 15 : baseConfidence;
        const score = isWrongPremiumDiscountZone ? baseConfidence - 15 : baseConfidence;
        const premiumDiscountTrace = pdZone
          ? isWrongPremiumDiscountZone
            ? `Canh bao: vao lenh ${structure.direction} tai vung ${pdZone.zone} - nguoc nguyen tac premium/discount, da ha diem.`
            : `Premium/Discount: ${pdZone.zone} (${pdZone.percentInRange.toFixed(0)}% range).`
          : "Premium/Discount: khong xac dinh dealing range.";
        const priorLevels = calculatePriorPeriodLevels(scopedCandles, index);
        const equalLevels = findEqualLevels(swings, index);
        const rvol = calculateRvol(scopedCandles, index);
        const rejection = detectRejectionWick(scopedCandles[index], structure.direction);
        const atrProxy = calculateLocalAtr(scopedCandles, index);
        const stopBuffer = Math.max(atrProxy * 0.2, Math.abs(entry) * 0.00002, 0.0001);
        const stopLoss = structure.direction === "LONG" ? ob.low - stopBuffer : ob.high + stopBuffer;
        const risk = Math.abs(entry - stopLoss) || 0.0001;
        const takeProfit1 = structure.direction === "LONG" ? entry + risk * 2 : entry - risk * 2;
        const defaultTakeProfit2 = structure.direction === "LONG" ? entry + risk * 3 : entry - risk * 3;
        const wantedEqualKind = structure.direction === "SHORT" ? "EQL" : "EQH";
        const matchingEqualLevel = equalLevels.find((lvl) => lvl.kind === wantedEqualKind);
        const liquidityTargets: SmcSignal["liquidityTargets"] = [];
        if (matchingEqualLevel) {
          liquidityTargets.push({
            label: matchingEqualLevel.kind,
            price: matchingEqualLevel.price,
            target: "TP2",
          });
        }
        const priorWeekLevel =
          structure.direction === "SHORT" ? priorLevels.priorWeekLow : priorLevels.priorWeekHigh;
        if (priorWeekLevel !== null) {
          liquidityTargets.push({
            label: structure.direction === "SHORT" ? "PWL" : "PWH",
            price: priorWeekLevel,
            target: "TP3",
          });
        }
        const tp2LiquidityTarget = liquidityTargets.find((target) => target.target === "TP2");
        const takeProfit2 = tp2LiquidityTarget && isValidLiquidityTarget(structure.direction, entry, risk, tp2LiquidityTarget.price)
          ? tp2LiquidityTarget.price
          : defaultTakeProfit2;
        const tp3LiquidityTarget = liquidityTargets.find((target) => target.target === "TP3");
        const takeProfit3 = tp3LiquidityTarget && isValidLiquidityTarget(structure.direction, entry, risk, tp3LiquidityTarget.price)
          ? tp3LiquidityTarget.price
          : undefined;
        const liquidityTargetTrace: string[] = [];
        if (tp2LiquidityTarget && takeProfit2 === tp2LiquidityTarget.price) {
          liquidityTargetTrace.push(
            `TP2 dieu chinh theo equal high/low tai ${tp2LiquidityTarget.price.toFixed(2)} (thay vi 3R mac dinh).`,
          );
        }
        if (tp3LiquidityTarget && takeProfit3 === tp3LiquidityTarget.price) {
          liquidityTargetTrace.push(
            `TP3 dieu chinh theo prior week level tai ${tp3LiquidityTarget.price.toFixed(2)}.`,
          );
        }
        const sessionAdjusted = applySessionPenalty(
          detectSession(scopedCandles[index].time),
          confidence,
          score,
          [
            `${structure.kind} ${structure.direction} tại ${structure.level.toFixed(2)}`,
            "Order block trùng vùng cấu trúc.",
            premiumDiscountTrace,
            ...liquidityTargetTrace,
          ],
        );
        const signal = buildSignal(
          pair,
          timeframe,
          structure.kind === "BOS" ? "SMC_BOS_OB" : "SMC_CHOCH_OB",
          structure.direction,
          index,
          entry,
          stopLoss,
          takeProfit1,
          takeProfit2,
          {
            confidence: sessionAdjusted.confidence,
            grade: sessionAdjusted.grade,
            score: sessionAdjusted.score,
            ruleTrace: sessionAdjusted.ruleTrace,
            takeProfit3,
            structureEvent: structure,
            orderBlock: ob,
            premiumDiscountZone: pdZone ?? undefined,
            priorPeriodLevels: priorLevels,
            rvol: rvol ?? undefined,
            hasRejectionWick: rejection.hasRejectionWick,
            liquidityTargets: liquidityTargets.length > 0 ? liquidityTargets : undefined,
            entryZone: { low: Math.min(entry, ob.low), high: Math.max(entry, ob.high) },
            session: sessionAdjusted.session,
            sessionLabel: sessionAdjusted.sessionLabel,
          },
        );
        candidates.push({ signal, confidence: signal.confidence, triggerIndex: index });
      }
    }
  }

  const fvg = detectFairValueGap(scopedCandles, index);
  if (fvg) {
    const dir = fvg.direction;
    if (!isAgainstHtfBias(htfContext, dir)) {
      const structure = detectStructureBreak(scopedCandles, swings, index, dir);
      const hasConfirmingStructure = structure !== null && structure.direction === dir;
      const baseConfidence = hasConfirmingStructure ? 74 : 60;
      const sessionAdjusted = applySessionPenalty(
        detectSession(scopedCandles[index].time),
        baseConfidence,
        baseConfidence,
        hasConfirmingStructure
          ? ["FVG cùng hướng cấu trúc đang mở rộng."]
          : ["FVG xuất hiện nhưng chưa có xác nhận cấu trúc cùng hướng."],
      );
      const entry = fvg.midpoint;
      const atrProxy = calculateLocalAtr(scopedCandles, index);
      const gapSize = Math.max(fvg.high - fvg.low, 0);
      const stopBuffer = Math.max(atrProxy * 0.2, gapSize * 0.25, Math.abs(entry) * 0.00002, 0.0001);
      const stopLoss = dir === "LONG" ? fvg.low - stopBuffer : fvg.high + stopBuffer;
      const risk = Math.abs(entry - stopLoss) || 0.0001;
      const takeProfit1 = dir === "LONG" ? entry + risk * 2 : entry - risk * 2;
      const takeProfit2 = dir === "LONG" ? entry + risk * 3 : entry - risk * 3;
      const signal = buildSignal(
        pair,
        timeframe,
        "SMC_FVG_CONTINUATION",
        dir,
        index,
        entry,
        stopLoss,
        takeProfit1,
        takeProfit2,
        {
          confidence: sessionAdjusted.confidence,
          grade: sessionAdjusted.grade,
          score: sessionAdjusted.score,
          ruleTrace: sessionAdjusted.ruleTrace,
          structureEvent: structure ?? undefined,
          fairValueGap: fvg,
          entryZone: { low: fvg.low, high: fvg.high },
          session: sessionAdjusted.session,
          sessionLabel: sessionAdjusted.sessionLabel,
        },
      );
      candidates.push({ signal, confidence: signal.confidence, triggerIndex: index });
    }
  }

  return candidates;
}

function collectSmcCandidatesInRange(
  candles: Awaited<ReturnType<typeof fetchOhlcHistory>> extends infer T ? T extends Error ? never : T : never,
  pair: string,
  timeframe: ChartTimeframe,
  startIndex: number,
  endIndex: number,
  htfContext?: HtfContext | null,
): CandidateSource[] {
  const candidates: CandidateSource[] = [];
  const safeStart = Math.max(4, startIndex);
  const safeEnd = Math.min(endIndex, candles.length - 1);

  for (let index = safeStart; index <= safeEnd; index += 1) {
    candidates.push(...buildSmcCandidatesAtIndex(candles, pair, timeframe, index, htfContext));
  }

  return candidates;
}

export function analyzeSmcSignalsAtIndex(
  candles: Awaited<ReturnType<typeof fetchOhlcHistory>> extends infer T ? T extends Error ? never : T : never,
  pair: string,
  timeframe: ChartTimeframe,
  index: number,
  htfContext?: HtfContext | null,
): SmcSignal[] {
  const candidates = buildSmcCandidatesAtIndex(candles, pair, timeframe, index, htfContext);
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.confidence - a.confidence || b.triggerIndex - a.triggerIndex);
  return candidates.map((candidate) => candidate.signal);
}

export function analyzeSmcWindow(
  candles: Awaited<ReturnType<typeof fetchOhlcHistory>> extends infer T ? T extends Error ? never : T : never,
  pair: string,
  timeframe: ChartTimeframe,
  htfContext?: HtfContext | null,
): SmcSignal[] {
  const startIndex = Math.max(4, candles.length - 20);
  const candidates = collectSmcCandidatesInRange(candles, pair, timeframe, startIndex, candles.length - 1, htfContext);

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.confidence - a.confidence || b.triggerIndex - a.triggerIndex);
  return [candidates[0].signal];
}

export async function analyzeAllChartsSmc(
  pairs: PairInput[],
  options: {
    timeframeMode?: "multi" | "single";
    primaryTimeframe?: ChartTimeframe;
  } = {},
): Promise<AnalysisResult> {
  const timeframe = analysisTimeframe(options);
  const summaries: PairSummary[] = [];
  const setups: TradeSetup[] = [];
  const noSetupReasons: string[] = [];
  let okPairs = 0;
  let noSetupPairs = 0;
  let skippedPairs = 0;

  const results = await Promise.all(pairs.map(async ({ pair, symbol }) => {
    const fetched = await fetchOhlcHistory(symbol, timeframe, 200);
    if (fetched instanceof Error) {
      return { kind: "skip" as const, pair, error: fetched.message };
    }
    if (fetched.length === 0) {
      return { kind: "skip" as const, pair, error: "Khong co closed candle hop le" };
    }
    const htfContext = await buildHtfContext(symbol, timeframe);
    const signals = analyzeSmcWindow(fetched, pair, timeframe, htfContext);
    if (signals.length === 0) {
      return {
        kind: "no_setup" as const,
        pair,
        summaries: [buildSmcPairSummary(pair, gradeToTrend("LONG"), 0, false)],
      };
    }
    const confluence = await checkMultiTimeframeConfluence(symbol, signals[0].direction);
    signals[0].confluence = {
      agreementCount: confluence.agreementCount,
      agreeingTimeframes: confluence.agreeingTimeframes,
    };
    if (confluence.agreementCount === 2) {
      signals[0].score = Math.min(100, signals[0].score + 10);
    } else if (confluence.agreementCount === 0) {
      signals[0].score = Math.max(0, signals[0].score - 5);
    }
    signals[0].grade = gradeFromScore(signals[0].score);

    const lastPrice = fetched[fetched.length - 1]?.close ?? null;
    const setup = buildTradeSetupFromSmcSignal(signals[0], { lastPrice });
    if (!setup) {
      return {
        kind: "no_setup" as const,
        pair,
        summaries: [buildSmcPairSummary(pair, gradeToTrend(signals[0].direction), 0, false)],
      };
    }
    return {
      kind: "ok" as const,
      pair,
      summaries: [buildSmcPairSummary(pair, gradeToTrend(signals[0].direction), setup.confidence, true, setup.ruleTrace ?? [])],
      setups: [setup],
    };
  }));

  for (const result of results) {
    if (result.kind === "ok") {
      okPairs += 1;
      summaries.push(...result.summaries);
      setups.push(...result.setups);
    } else if (result.kind === "no_setup") {
      noSetupPairs += 1;
      summaries.push(...result.summaries);
      noSetupReasons.push(`[${result.pair}] Khong phat hien setup SMC nao`);
    } else {
      skippedPairs += 1;
      noSetupReasons.push(`[${result.pair}] ${result.error}`);
    }
  }

  logger.info("SMC engine complete", { attemptedPairs: pairs.length, okPairs, noSetupPairs, skippedPairs, setupCount: setups.length });

  return {
    summaries,
    setups,
    noSetupReason: noSetupReasons.join("\n").trim(),
    screenshots: [],
    analysisStats: {
      attemptedPairs: pairs.length,
      okPairs,
      noSetupPairs,
      skippedPairs,
      setupCount: setups.length,
    },
  };
}
