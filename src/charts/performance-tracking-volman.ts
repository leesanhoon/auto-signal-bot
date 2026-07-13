import type { PositionDecisionAction } from "./position-engine-volman.js";

export type PositionCloseReason =
  | "stop_loss"
  | "take_profit"
  | "take_profit_2"
  | "manual_close";

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
  riskRewardRatio: number | null;
  lastManagementAction: string | null;
  realizedRiskRewardRatio?: number | null;
  realizedExitPrice?: string | null;
  closeReason?: PositionCloseReason | null;
};

export type ClosedPositionSnapshot = {
  closeReason: Exclude<PositionCloseReason, "take_profit_2">;
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

function inferCloseReason(action: string | null): PositionCloseReason {
  if (action === "TAKE_PROFIT_CLOSE") return "take_profit";
  if (action === "MANUAL_CLOSE") return "manual_close";
  return "stop_loss";
}

function calculateExitRiskReward(
  position: ClosedPositionRecord,
  exitPriceText: string | null,
): number {
  const entry = parsePrice(position.entry);
  const stopLoss = parsePrice(position.stopLoss);
  const exitPrice = parsePrice(exitPriceText);
  if (entry === null || stopLoss === null || exitPrice === null) return 0;

  const initialRisk = Math.abs(entry - stopLoss);
  if (initialRisk <= 0) return 0;
  const reward =
    position.direction === "LONG" ? exitPrice - entry : entry - exitPrice;
  return round2(reward / initialRisk);
}

function resolveExitPrice(
  position: ClosedPositionRecord,
  closeReason: PositionCloseReason,
): string | null {
  if (position.realizedExitPrice) return position.realizedExitPrice;
  if (closeReason === "take_profit") return position.takeProfit1;
  if (closeReason === "take_profit_2") {
    return position.takeProfit2 ?? position.takeProfit1;
  }
  return position.stopLoss;
}

export function buildClosedPositionSnapshot(
  position: ClosedPositionRecord,
  closeAction: PositionDecisionAction | "STOP" | "MANUAL_CLOSE",
  options: { stopLoss?: string | null } = {},
): ClosedPositionSnapshot {
  const closeReason =
    closeAction === "TAKE_PROFIT_CLOSE"
      ? "take_profit"
      : closeAction === "MANUAL_CLOSE"
        ? "manual_close"
        : "stop_loss";
  const realizedExitPrice =
    closeReason === "take_profit"
      ? position.takeProfit1
      : options.stopLoss ?? position.stopLoss;
  const realizedRiskRewardRatio = calculateExitRiskReward(
    position,
    realizedExitPrice,
  );

  return {
    closeReason,
    realizedExitPrice,
    realizedRiskRewardRatio,
    outcome:
      realizedRiskRewardRatio > 0
        ? "win"
        : realizedRiskRewardRatio < 0
          ? "loss"
          : "breakeven",
  };
}

export function summarizeClosedPositionsPerformance(
  positions: ClosedPositionRecord[],
  options: { periodLabel: string; startAt: string; endAt: string },
): PerformanceReport {
  const sorted = [...positions].sort((a, b) =>
    a.closedAt.localeCompare(b.closedAt),
  );
  const withRealized = sorted.map((position) => {
    const closeReason =
      position.closeReason ?? inferCloseReason(position.lastManagementAction);
    const totalRealizedRiskReward =
      position.realizedRiskRewardRatio !== null &&
      position.realizedRiskRewardRatio !== undefined &&
      Number.isFinite(position.realizedRiskRewardRatio)
        ? round2(position.realizedRiskRewardRatio)
        : calculateExitRiskReward(
            position,
            resolveExitPrice(position, closeReason),
          );
    return { ...position, closeReason, totalRealizedRiskReward };
  });

  const buildSummary = (
    label: string,
    rows: typeof withRealized,
  ): PerformanceSummary => {
    const total = rows.reduce(
      (sum, row) => sum + row.totalRealizedRiskReward,
      0,
    );
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
      averageRealizedRiskReward:
        rows.length === 0 ? 0 : round2(total / rows.length),
      maxDrawdown: round2(maxDrawdown),
    };
  };

  const byPairMap = new Map<string, typeof withRealized>();
  const byPatternMap = new Map<string, typeof withRealized>();
  for (const row of withRealized) {
    const pairRows = byPairMap.get(row.pair) ?? [];
    pairRows.push(row);
    byPairMap.set(row.pair, pairRows);

    const pattern = row.setup?.trim() || "Unknown";
    const patternRows = byPatternMap.get(pattern) ?? [];
    patternRows.push(row);
    byPatternMap.set(pattern, patternRows);
  }

  const sortSummaries = (items: PerformanceSummary[]) =>
    items.sort(
      (a, b) =>
        b.totalRealizedRiskReward - a.totalRealizedRiskReward ||
        a.label.localeCompare(b.label),
    );

  return {
    periodLabel: options.periodLabel,
    startAt: options.startAt,
    endAt: options.endAt,
    portfolio: buildSummary("Portfolio", withRealized),
    byPair: sortSummaries(
      [...byPairMap.entries()].map(([pair, rows]) =>
        buildSummary(pair, rows),
      ),
    ),
    byPattern: sortSummaries(
      [...byPatternMap.entries()].map(([pattern, rows]) =>
        buildSummary(pattern, rows),
      ),
    ),
  };
}
