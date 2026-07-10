import type { PositionDecisionAction } from "./position-engine-volman.js";

export type ClosedPositionRecord = {
  id: number;
  pair: string;
  direction: "LONG" | "SHORT";
  setup: string | null;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string | null;
  status: "closed";
  closedAt: string;
  tp1ClosedPercent: number | null;
  trailingStopLoss: string | null;
  riskRewardRatio: number | null;
  tp1RiskRewardRatio: number | null;
  tp2RiskRewardRatio: number | null;
  lastManagementAction: string | null;
  realizedRiskRewardRatio?: number | null;
  realizedExitPrice?: string | null;
  closeReason?: "stop_loss" | "take_profit_2" | "manual_close" | null;
};

export type ClosedPositionSnapshot = {
  closeReason: "stop_loss" | "take_profit_2" | "manual_close";
  realizedExitPrice: string | null;
  realizedRiskRewardRatio: number;
  outcome: "win" | "loss" | "breakeven";
};

export type PerformanceSummary = {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  totalRealizedRiskReward: number;
  averageRealizedRiskReward: number;
  maxDrawdown: number;
};

export type PerformanceReport = {
  periodLabel: string;
  startAt: string;
  endAt: string;
  portfolio: PerformanceSummary;
  byPair: PerformanceSummary[];
  byPattern: PerformanceSummary[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function clampPercent(value: number | null | undefined): number {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

function inferCloseReason(action: string | null): "stop_loss" | "take_profit_2" | "manual_close" {
  if (action === "TP2_CLOSE") return "take_profit_2";
  if (action === "MANUAL_CLOSE") return "manual_close";
  return "stop_loss";
}

function calculateInitialRisk(position: ClosedPositionRecord): number | null {
  const entry = parsePrice(position.entry);
  const takeProfit1 = parsePrice(position.takeProfit1);
  const tp1RiskReward = position.tp1RiskRewardRatio;
  if (entry === null || takeProfit1 === null || !tp1RiskReward || tp1RiskReward <= 0) {
    return null;
  }

  const rewardToTp1 = Math.abs(takeProfit1 - entry);
  if (rewardToTp1 <= 0) {
    return null;
  }

  return rewardToTp1 / tp1RiskReward;
}

function calculateExitRiskRewardFromStop(position: ClosedPositionRecord, exitPrice: string | null): number {
  const entry = parsePrice(position.entry);
  const stop = parsePrice(exitPrice ?? position.trailingStopLoss ?? position.stopLoss);
  const initialRisk = calculateInitialRisk(position);
  if (entry === null || stop === null || initialRisk === null || initialRisk <= 0) {
    return 0;
  }

  const reward = position.direction === "LONG" ? stop - entry : entry - stop;
  return round2(reward / initialRisk);
}

function calculateRemainingRiskReward(position: ClosedPositionRecord, closeReason: "stop_loss" | "take_profit_2" | "manual_close"): number {
  if (closeReason === "take_profit_2") {
    return round2(position.tp2RiskRewardRatio ?? position.riskRewardRatio ?? position.tp1RiskRewardRatio ?? 0);
  }

  return calculateExitRiskRewardFromStop(position, position.realizedExitPrice ?? position.trailingStopLoss ?? position.stopLoss);
}

function calculateTotalRealizedRiskReward(
  position: ClosedPositionRecord,
  closeReason: "stop_loss" | "take_profit_2" | "manual_close",
  explicitTotal?: number | null,
): number {
  if (explicitTotal !== null && explicitTotal !== undefined && Number.isFinite(explicitTotal)) {
    return round2(explicitTotal);
  }

  const tp1ClosedPercent = clampPercent(position.tp1ClosedPercent);
  const remainingPercent = 100 - tp1ClosedPercent;
  const remainingRiskReward = calculateRemainingRiskReward(position, closeReason);
  return round2((tp1ClosedPercent / 100) * (position.tp1RiskRewardRatio ?? 0) + (remainingPercent / 100) * remainingRiskReward);
}

export function buildClosedPositionSnapshot(
  position: ClosedPositionRecord,
  closeAction: PositionDecisionAction | "STOP" | "MANUAL_CLOSE",
  options: { stopLoss?: string | null } = {},
): ClosedPositionSnapshot {
  const closeReason =
    closeAction === "TP2_CLOSE"
      ? "take_profit_2"
      : closeAction === "MANUAL_CLOSE"
        ? "manual_close"
        : "stop_loss";
  const tp1ClosedPercent = clampPercent(position.tp1ClosedPercent);
  const remainingPercent = 100 - tp1ClosedPercent;
  const realizedExitPrice =
    closeReason === "take_profit_2"
      ? position.takeProfit2 ?? position.takeProfit1
      : options.stopLoss ?? position.trailingStopLoss ?? position.stopLoss;
  const remainingRiskReward =
    closeReason === "take_profit_2"
      ? round2(position.tp2RiskRewardRatio ?? position.riskRewardRatio ?? position.tp1RiskRewardRatio ?? 0)
      : calculateExitRiskRewardFromStop(position, realizedExitPrice);
  const realizedRiskRewardRatio = round2(
    (tp1ClosedPercent / 100) * (position.tp1RiskRewardRatio ?? 0) + (remainingPercent / 100) * remainingRiskReward,
  );

  return {
    closeReason,
    realizedExitPrice,
    realizedRiskRewardRatio,
    outcome:
      realizedRiskRewardRatio > 0 ? "win" : realizedRiskRewardRatio < 0 ? "loss" : "breakeven",
  };
}

export function summarizeClosedPositionsPerformance(
  positions: ClosedPositionRecord[],
  options: { periodLabel: string; startAt: string; endAt: string },
): PerformanceReport {
  const sorted = [...positions].sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const withRealized = sorted.map((position) => {
    const closeReason = position.closeReason ?? inferCloseReason(position.lastManagementAction);
    const totalRealizedRiskReward = calculateTotalRealizedRiskReward(position, closeReason, position.realizedRiskRewardRatio);
    return {
      ...position,
      closeReason,
      totalRealizedRiskReward,
    };
  });

  const buildSummary = (label: string, rows: typeof withRealized): PerformanceSummary => {
    const total = rows.reduce((sum, row) => sum + row.totalRealizedRiskReward, 0);
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const row of rows) {
      equity += row.totalRealizedRiskReward;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }

    const wins = rows.filter((row) => row.totalRealizedRiskReward > 0).length;
    const losses = rows.filter((row) => row.totalRealizedRiskReward < 0).length;
    const breakevens = rows.length - wins - losses;

    return {
      label,
      trades: rows.length,
      wins,
      losses,
      breakevens,
      winRate: rows.length === 0 ? 0 : round2((wins / rows.length) * 100),
      totalRealizedRiskReward: round2(total),
      averageRealizedRiskReward: rows.length === 0 ? 0 : round2(total / rows.length),
      maxDrawdown: round2(maxDrawdown),
    };
  };

  const byPairMap = new Map<string, typeof withRealized>();
  for (const row of withRealized) {
    const existing = byPairMap.get(row.pair) ?? [];
    existing.push(row);
    byPairMap.set(row.pair, existing);
  }

  const byPair = [...byPairMap.entries()]
    .map(([pair, rows]) => buildSummary(pair, rows))
    .sort((a, b) => b.totalRealizedRiskReward - a.totalRealizedRiskReward || a.label.localeCompare(b.label));

  const byPatternMap = new Map<string, typeof withRealized>();
  for (const row of withRealized) {
    const pattern = row.setup && row.setup.trim() ? row.setup.trim() : "Unknown";
    const existing = byPatternMap.get(pattern) ?? [];
    existing.push(row);
    byPatternMap.set(pattern, existing);
  }

  const byPattern = [...byPatternMap.entries()]
    .map(([pattern, rows]) => buildSummary(pattern, rows))
    .sort((a, b) => b.totalRealizedRiskReward - a.totalRealizedRiskReward || a.label.localeCompare(b.label));

  return {
    periodLabel: options.periodLabel,
    startAt: options.startAt,
    endAt: options.endAt,
    portfolio: buildSummary("Portfolio", withRealized),
    byPair,
    byPattern,
  };
}
