import { getDb } from "../../shared/infra/db.js";
import type { LotteryRegion } from "../model/lottery-types.js";

export type HitRateStat = {
  region: LotteryRegion;
  methodVersion: string;
  periodsVerified: number;
  totalPredictions: number;
  totalHits: number;
  hitRate: number;
  totalHits2: number;
  hitRate2: number;
};

type VerifiedPredictionRow = {
  date: string;
  region: LotteryRegion;
  method_version: string | null;
  hit: boolean | null;
  hit2: boolean | null;
};

const REGION_LABELS: Record<LotteryRegion, string> = {
  "mien-bac": "🟦 Miền Bắc",
  "mien-trung": "🟨 Miền Trung",
  "mien-nam": "🟩 Miền Nam",
};

function vnTodayDateStr(): string {
  const vnNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }),
  );
  return vnNow.toISOString().slice(0, 10);
}

function subtractDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function normalizeTrailingDays(trailingDays: number): number {
  if (!Number.isFinite(trailingDays)) return 30;
  return Math.max(1, Math.floor(trailingDays));
}

function toHitRate(totalHits: number, totalPredictions: number): number {
  return totalPredictions > 0 ? totalHits / totalPredictions : 0;
}

/** Tổng hợp hit-rate từ `lottery_predictions` đã verify, theo miền + method_version, giới hạn N ngày gần nhất. */
export async function computeHitRateStats(
  trailingDays: number,
): Promise<HitRateStat[]> {
  const safeTrailingDays = normalizeTrailingDays(trailingDays);
  const cutoffDate = subtractDays(vnTodayDateStr(), safeTrailingDays);

  const { data, error } = await (getDb().from("lottery_predictions") as any)
    .select("date, region, method_version, hit, hit2")
    .not("verified_at", "is", null)
    .gte("date", cutoffDate);

  if (error) {
    throw new Error(`computeHitRateStats query failed: ${error.message}`);
  }

  const rows = (data ?? []) as VerifiedPredictionRow[];
  const grouped = new Map<
    string,
    {
      region: LotteryRegion;
      methodVersion: string;
      dates: Set<string>;
      totalPredictions: number;
      totalHits: number;
      totalHits2: number;
    }
  >();

  for (const row of rows) {
    const methodVersion = row.method_version?.trim() || "unknown";
    const key = `${row.region}::${methodVersion}`;
    const current = grouped.get(key) ?? {
      region: row.region,
      methodVersion,
      dates: new Set<string>(),
      totalPredictions: 0,
      totalHits: 0,
      totalHits2: 0,
    };

    current.totalPredictions += 1;
    if (row.hit === true) current.totalHits += 1;
    if (row.hit2 === true) current.totalHits2 += 1;
    current.dates.add(row.date);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((item) => ({
      region: item.region,
      methodVersion: item.methodVersion,
      periodsVerified: item.dates.size,
      totalPredictions: item.totalPredictions,
      totalHits: item.totalHits,
      hitRate: toHitRate(item.totalHits, item.totalPredictions),
      totalHits2: item.totalHits2,
      hitRate2: toHitRate(item.totalHits2, item.totalPredictions),
    }))
    .sort((a, b) => {
      if (a.region !== b.region) return a.region.localeCompare(b.region);
      if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
      return a.methodVersion.localeCompare(b.methodVersion);
    });
}

export function formatHitRateReport(
  stats: HitRateStat[],
  trailingDays: number,
): string {
  const safeTrailingDays = normalizeTrailingDays(trailingDays);
  if (stats.length === 0) {
    return `📊 *LOTTERY HIT-RATE REPORT*\n\nChưa đủ dữ liệu verify trong ${safeTrailingDays} ngày gần nhất.`;
  }

  const lines: string[] = [
    "📊 *LOTTERY HIT-RATE REPORT*",
    `_${safeTrailingDays} ngày gần nhất, chỉ tính prediction đã verify_`,
    "",
  ];

  const byRegion = new Map<LotteryRegion, HitRateStat[]>();
  for (const stat of stats) {
    const current = byRegion.get(stat.region) ?? [];
    current.push(stat);
    byRegion.set(stat.region, current);
  }

  const orderedRegions: LotteryRegion[] = ["mien-bac", "mien-trung", "mien-nam"];
  let firstRegion = true;
  for (const region of orderedRegions) {
    const regionStats = byRegion.get(region);
    if (!regionStats || regionStats.length === 0) continue;

    if (!firstRegion) lines.push("");
    firstRegion = false;

    lines.push(REGION_LABELS[region]);
    for (const stat of regionStats) {
      const hitPercent = toHitRate(stat.totalHits, stat.totalPredictions) * 100;
      const hitPercent2 = toHitRate(stat.totalHits2, stat.totalPredictions) * 100;
      lines.push(
        `• \`${stat.methodVersion}\`: ${hitPercent.toFixed(1)}% (${stat.totalHits}/${stat.totalPredictions}) — 2 số cuối: ${hitPercent2.toFixed(1)}% (${stat.totalHits2}/${stat.totalPredictions})`,
      );
      lines.push(`  ${stat.periodsVerified} kỳ verify`);
    }
  }

  return lines.join("\n");
}
