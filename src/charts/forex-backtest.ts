import type { ClosedPositionRecord, PerformanceSummary } from "./performance-tracking-volman.js";

export type ForexBacktestRow = {
  id: number;
  pair: string;
  direction: "LONG" | "SHORT";
  realizedRiskRewardRatio: number;
  directionCorrect: boolean;
  entryHit: boolean;
  closeReason: "stop_loss" | "take_profit_2" | "manual_close" | null;
};

export type ForexBacktestReport = {
  trades: number;
  directionAccuracy: number;
  entryHitRate: number;
  averageRealizedRiskReward: number;
  byPair: PerformanceSummary[];
  rows: ForexBacktestRow[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildSummary(label: string, rows: ForexBacktestRow[]): PerformanceSummary {
  const total = rows.reduce((sum, row) => sum + row.realizedRiskRewardRatio, 0);
  return {
    label,
    trades: rows.length,
    wins: rows.filter((row) => row.realizedRiskRewardRatio > 0).length,
    losses: rows.filter((row) => row.realizedRiskRewardRatio < 0).length,
    breakevens: rows.filter((row) => row.realizedRiskRewardRatio === 0).length,
    winRate: rows.length === 0 ? 0 : round2((rows.filter((row) => row.realizedRiskRewardRatio > 0).length / rows.length) * 100),
    totalRealizedRiskReward: round2(total),
    averageRealizedRiskReward: rows.length === 0 ? 0 : round2(total / rows.length),
    maxDrawdown: 0,
  };
}

export function runForexBacktest(positions: ClosedPositionRecord[]): ForexBacktestReport {
  const rows: ForexBacktestRow[] = positions.map((position) => {
    const realizedRiskRewardRatio = position.realizedRiskRewardRatio ?? 0;
    const directionCorrect = realizedRiskRewardRatio > 0;
    const entryHit = (position.tp1ClosedPercent ?? 0) > 0 || position.closeReason === "take_profit_2";
    return {
      id: position.id,
      pair: position.pair,
      direction: position.direction,
      realizedRiskRewardRatio,
      directionCorrect,
      entryHit,
      closeReason: position.closeReason ?? null,
    };
  });

  const trades = rows.length;
  const directionAccuracy = trades === 0 ? 0 : round2((rows.filter((row) => row.directionCorrect).length / trades) * 100);
  const entryHitRate = trades === 0 ? 0 : round2((rows.filter((row) => row.entryHit).length / trades) * 100);
  const averageRealizedRiskReward =
    trades === 0 ? 0 : round2(rows.reduce((sum, row) => sum + row.realizedRiskRewardRatio, 0) / trades);

  const byPairMap = new Map<string, ForexBacktestRow[]>();
  for (const row of rows) {
    const list = byPairMap.get(row.pair) ?? [];
    list.push(row);
    byPairMap.set(row.pair, list);
  }

  const byPair = [...byPairMap.entries()]
    .map(([pair, pairRows]) => buildSummary(pair, pairRows))
    .sort((a, b) => b.winRate - a.winRate || a.label.localeCompare(b.label));

  return {
    trades,
    directionAccuracy,
    entryHitRate,
    averageRealizedRiskReward,
    byPair,
    rows,
  };
}
