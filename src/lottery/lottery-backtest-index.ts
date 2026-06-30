import "../shared/env.js";
import { loadWeekdayHistory } from "./lottery-repository.js";
import { runBacktest } from "./lottery-backtest.js";
import { DECAY_BY_REGION, OVERDUE_BONUS_BY_REGION, type PredictionScoringOptions } from "./lottery-predict.js";
import type { LotteryRegion } from "./lottery-types.js";

const REGIONS: LotteryRegion[] = ["mien-bac", "mien-trung", "mien-nam"];
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => i);

type GridCandidate = {
  decay: number;
  overdueBonus: number;
  useWeightedExpectedGap: boolean;
  stationSpreadWeight: number;
};

type AggregatedReport = {
  periodsTested: number;
  hitRate: number;
  baselineHitRate: number;
  edge: number;
  hits: number;
  baselineHits: number;
};

type GridResult = GridCandidate & AggregatedReport;

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sumReports(reports: ReturnType<typeof runBacktest>[]): AggregatedReport {
  const totals = reports.reduce(
    (acc, report) => {
      acc.periodsTested += report.periodsTested;
      acc.hits += report.hits;
      acc.baselineHits += report.baselineHits;
      return acc;
    },
    { periodsTested: 0, hits: 0, baselineHits: 0 },
  );

  const hitRate = totals.periodsTested > 0 ? totals.hits / totals.periodsTested : 0;
  const baselineHitRate = totals.periodsTested > 0 ? totals.baselineHits / totals.periodsTested : 0;

  return {
    periodsTested: totals.periodsTested,
    hitRate,
    baselineHitRate,
    edge: hitRate - baselineHitRate,
    hits: totals.hits,
    baselineHits: totals.baselineHits,
  };
}

async function loadRegionHistory(region: LotteryRegion): Promise<Record<number, Awaited<ReturnType<typeof loadWeekdayHistory>>>> {
  const entries = await Promise.all(
    WEEKDAYS.map(async (weekday) => [weekday, (await loadWeekdayHistory(weekday)).filter((r) => r.region === region)] as const),
  );
  return Object.fromEntries(entries) as Record<number, Awaited<ReturnType<typeof loadWeekdayHistory>>>;
}

function makeGridCandidates(region: LotteryRegion): GridCandidate[] {
  const baseDecay = DECAY_BY_REGION[region];
  const baseBonus = OVERDUE_BONUS_BY_REGION[region];
  const decays = [baseDecay - 0.08, baseDecay - 0.05, baseDecay - 0.03, baseDecay, baseDecay + 0.03, baseDecay + 0.05]
    .filter((v) => v > 0 && v < 1)
    .map((v) => Number(v.toFixed(2)));
  const bonuses = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5].map((v) => Number(v.toFixed(2)));
  const weightedModes = [false, true];
  const spreadWeights = [0, 0.05, 0.1, 0.15, 0.2];

  const candidates: GridCandidate[] = [];
  for (const decay of decays) {
    for (const overdueBonus of bonuses) {
      for (const useWeightedExpectedGap of weightedModes) {
        for (const stationSpreadWeight of spreadWeights) {
          candidates.push({ decay, overdueBonus, useWeightedExpectedGap, stationSpreadWeight });
        }
      }
    }
  }

  return candidates;
}

function toScoring(candidate: GridCandidate): PredictionScoringOptions {
  return {
    decay: candidate.decay,
    overdueBonus: candidate.overdueBonus,
    useWeightedExpectedGap: candidate.useWeightedExpectedGap,
    stationSpreadWeight: candidate.stationSpreadWeight,
  };
}

async function evaluateCandidate(
  historyByWeekday: Record<number, Awaited<ReturnType<typeof loadWeekdayHistory>>>,
  region: LotteryRegion,
  candidate: GridCandidate,
): Promise<GridResult> {
  const reports = WEEKDAYS.map((weekday) => {
    const records = historyByWeekday[weekday] ?? [];
    if (records.length === 0) {
      return runBacktest([], region, 3, 20, { scoring: toScoring(candidate) });
    }
    return runBacktest(records, region, 3, 20, { scoring: toScoring(candidate) });
  });
  const resolved = await Promise.all(reports);
  const combined = sumReports(resolved);
  return { ...candidate, ...combined };
}

async function main(): Promise<void> {
  console.log("🧪 Lottery Backtest — walk-forward validation top-3 mỗi miền/thứ");
  console.log("Miền        Thứ        Kỳ test   Hit-rate   Baseline   Edge");
  console.log("-".repeat(70));

  for (const region of REGIONS) {
    const historyByWeekday = await loadRegionHistory(region);
    const baselineReports = WEEKDAYS.map((weekday) => {
      const records = historyByWeekday[weekday] ?? [];
      return runBacktest(records, region, 3, 20);
    }).filter((report) => report.periodsTested > 0);

    if (baselineReports.length === 0) {
      console.log(`${region.padEnd(11)} ${"khong co du lieu".padEnd(10)} ${"".padEnd(9)} ${"".padEnd(10)} ${"".padEnd(10)} ${""}`);
      continue;
    }

    const baseline = sumReports(baselineReports);
    console.log(
      `${region.padEnd(11)} ${"baseline".padEnd(10)} ${String(baseline.periodsTested).padEnd(9)} ${fmtPct(baseline.hitRate).padEnd(10)} ${fmtPct(baseline.baselineHitRate).padEnd(10)} ${baseline.edge >= 0 ? "+" : ""}${(baseline.edge * 100).toFixed(1)}%`,
    );

    const candidates = await Promise.all(makeGridCandidates(region).map((candidate) => evaluateCandidate(historyByWeekday, region, candidate)));
    const best = candidates.sort((a, b) => b.edge - a.edge)[0];

    console.log(
      `${region.padEnd(11)} ${"best-grid".padEnd(10)} ${String(best.periodsTested).padEnd(9)} ${fmtPct(best.hitRate).padEnd(10)} ${fmtPct(best.baselineHitRate).padEnd(10)} ${best.edge >= 0 ? "+" : ""}${(best.edge * 100).toFixed(1)}%`,
    );
    console.log(
      `  decay=${best.decay.toFixed(2)} overdueBonus=${best.overdueBonus.toFixed(2)} weightedGap=${best.useWeightedExpectedGap ? "on" : "off"} spread=${best.stationSpreadWeight.toFixed(2)}`,
    );
  }

  console.log("\n✅ Hoàn tất. Edge dương nghĩa là model hit nhiều hơn baseline ngẫu nhiên.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
