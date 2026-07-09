import type { AnalysisResult, ChartTimeframe, PairSummary, TradeSetup } from "../chart-types.js";
import { fetchOhlcHistory } from "../ohlc-provider.js";
import { createLogger } from "../../shared/logger.js";
import { buildSmcPairSummary, buildTradeSetupFromSmcSignal, gradeFromScore } from "./smc-signal-assembly.js";
import { checkMultiTimeframeConfluence } from "./smc-confluence.js";
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
  detectLiquiditySweep,
  detectStructureBreak,
  findRecentOrderBlock,
  findSwingPoints,
} from "./smc-structure.js";
import type { SmcSignal, SmcSetupName, SmcDirection } from "./smc-types.js";
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

function createEntryZone(entry: number, atr: number): { low: number; high: number } {
  const padding = Math.max(atr * 0.12, Math.abs(entry) * 0.00002, 0.0001);
  return { low: entry - padding, high: entry + padding };
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

function buildSmcCandidatesAtIndex(
  candles: Awaited<ReturnType<typeof fetchOhlcHistory>> extends infer T ? T extends Error ? never : T : never,
  pair: string,
  timeframe: ChartTimeframe,
  index: number,
): CandidateSource[] {
  if (index < 4 || index >= candles.length) return [];

  const scopedCandles = candles.slice(0, index + 1);
  const swings = findSwingPoints(scopedCandles, { left: 2, right: 2 });
  const candidates: CandidateSource[] = [];

  const structure = detectStructureBreak(scopedCandles, swings, index);
  if (structure) {
    const ob = findRecentOrderBlock(scopedCandles, index, structure.direction, 12);
    if (ob) {
      const entry = ob.midpoint;
      const pdZone = calculatePremiumDiscountZone(entry, swings, index);
      const priorLevels = calculatePriorPeriodLevels(scopedCandles, index);
      const equalLevels = findEqualLevels(swings, index);
      const rvol = calculateRvol(scopedCandles, index);
      const rejection = detectRejectionWick(scopedCandles[index], structure.direction);
      const stopLoss = structure.direction === "LONG" ? ob.low : ob.high;
      const risk = Math.abs(entry - stopLoss) || 0.0001;
      const takeProfit1 = structure.direction === "LONG" ? entry + risk * 2 : entry - risk * 2;
      const takeProfit2 = structure.direction === "LONG" ? entry + risk * 3 : entry - risk * 3;
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
          confidence: structure.kind === "CHOCH" ? 72 : 80,
          grade: structure.kind === "CHOCH" ? "B" : "A",
          score: structure.kind === "CHOCH" ? 72 : 84,
          ruleTrace: [
            `${structure.kind} ${structure.direction} tại ${structure.level.toFixed(2)}`,
            "Order block trùng vùng cấu trúc.",
          ],
          structureEvent: structure,
          orderBlock: ob,
          premiumDiscountZone: pdZone ?? undefined,
          priorPeriodLevels: priorLevels,
          rvol: rvol ?? undefined,
          hasRejectionWick: rejection.hasRejectionWick,
          liquidityTargets: liquidityTargets.length > 0 ? liquidityTargets : undefined,
          entryZone: { low: Math.min(entry, ob.low), high: Math.max(entry, ob.high) },
          ...detectSession(scopedCandles[index].time),
        },
      );
      candidates.push({ signal, confidence: signal.confidence, triggerIndex: index });
    }
  }

  const sweep = detectLiquiditySweep(scopedCandles, swings, index);
  if (sweep) {
    const direction = sweep.direction;
    const entry = scopedCandles[index].close;
    const atrProxy = calculateLocalAtr(scopedCandles, index);
    const stopBuffer = Math.max(atrProxy * 0.25, Math.abs(entry) * 0.00002, 0.0001);
    const entryZone = createEntryZone(entry, atrProxy);
    const stopLoss = direction === "LONG"
      ? Math.min(sweep.sweptLevel - stopBuffer, entryZone.low - stopBuffer * 0.5)
      : Math.max(sweep.sweptLevel + stopBuffer, entryZone.high + stopBuffer * 0.5);
    const risk = Math.abs(entry - stopLoss) || 0.0001;
    const takeProfit1 = direction === "LONG" ? entry + risk * 2 : entry - risk * 2;
    const takeProfit2 = direction === "LONG" ? entry + risk * 3 : entry - risk * 3;
    const signal = buildSignal(
      pair,
      timeframe,
      "SMC_LIQUIDITY_SWEEP",
      direction,
      index,
      entry,
      stopLoss,
      takeProfit1,
      takeProfit2,
      {
        confidence: 68,
        grade: "B",
        score: 68,
        ruleTrace: ["Liquidity sweep và reclaim xác nhận hướng giao dịch."],
        liquiditySweep: sweep,
        entryZone,
        ...detectSession(scopedCandles[index].time),
      },
    );
    candidates.push({ signal, confidence: signal.confidence, triggerIndex: index });
  }

  const fvg = detectFairValueGap(scopedCandles, index);
  if (fvg) {
    const dir = fvg.direction;
    const structure = detectStructureBreak(scopedCandles, swings, index, dir);
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
        confidence: structure ? 74 : 60,
        grade: structure ? "B" : "C",
        score: structure ? 74 : 60,
        ruleTrace: ["FVG cùng hướng cấu trúc đang mở rộng."],
        structureEvent: structure ?? undefined,
        fairValueGap: fvg,
        entryZone: { low: fvg.low, high: fvg.high },
        ...detectSession(scopedCandles[index].time),
      },
    );
    candidates.push({ signal, confidence: signal.confidence, triggerIndex: index });
  }

  return candidates;
}

function collectSmcCandidatesInRange(
  candles: Awaited<ReturnType<typeof fetchOhlcHistory>> extends infer T ? T extends Error ? never : T : never,
  pair: string,
  timeframe: ChartTimeframe,
  startIndex: number,
  endIndex: number,
): CandidateSource[] {
  const candidates: CandidateSource[] = [];
  const safeStart = Math.max(4, startIndex);
  const safeEnd = Math.min(endIndex, candles.length - 1);

  for (let index = safeStart; index <= safeEnd; index += 1) {
    candidates.push(...buildSmcCandidatesAtIndex(candles, pair, timeframe, index));
  }

  return candidates;
}

export function analyzeSmcSignalsAtIndex(
  candles: Awaited<ReturnType<typeof fetchOhlcHistory>> extends infer T ? T extends Error ? never : T : never,
  pair: string,
  timeframe: ChartTimeframe,
  index: number,
): SmcSignal[] {
  const candidates = buildSmcCandidatesAtIndex(candles, pair, timeframe, index);
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.confidence - a.confidence || b.triggerIndex - a.triggerIndex);
  return candidates.map((candidate) => candidate.signal);
}

export function analyzeSmcWindow(
  candles: Awaited<ReturnType<typeof fetchOhlcHistory>> extends infer T ? T extends Error ? never : T : never,
  pair: string,
  timeframe: ChartTimeframe,
): SmcSignal[] {
  const startIndex = Math.max(4, candles.length - 20);
  const candidates = collectSmcCandidatesInRange(candles, pair, timeframe, startIndex, candles.length - 1);

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
    const signals = analyzeSmcWindow(fetched, pair, timeframe);
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
