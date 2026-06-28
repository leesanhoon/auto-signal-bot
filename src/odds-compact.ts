import type { ApiFootballBet } from "./betting-api.js";
import type { CompactMarket, CompactOdds, CompactOutcome, MatchInfo } from "./betting-types.js";

export const NAME_LEGEND =
  "name codes: H=home,A=away,D=draw,O=over,U=under. KQ+TOT dùng code 2 ký tự (HO/HU/DO/DU/AO/AU = kết quả+tổng). " +
  "Point trong asia_handicap/asia_totals/result_total_goals giữ nguyên dấu từ nguồn (Asian Handicap, Goals Over/Under). " +
  "asia_handicap/asia_totals chỉ giữ ±2 mốc (level) quanh equilibrium (kèo cân ~1.8-2.0), bỏ mốc cực đoan.";

const EQUILIBRIUM_PRICE_RANGE = { low: 1.8, high: 2.0 };
const KEEP_LEVELS_RADIUS = 2;

function findBet(bets: ApiFootballBet[], name: string): ApiFootballBet | undefined {
  return bets.find((b) => b.name.toLowerCase() === name.toLowerCase());
}

function compact3Way(bet: ApiFootballBet | undefined): CompactOutcome[] {
  if (!bet) return [];
  const map: Record<string, string> = { Home: "H", Draw: "D", Away: "A" };
  return bet.values
    .filter((v) => map[v.value] !== undefined)
    .map((v) => ({ name: map[v.value], price: Number(v.odd) }));
}

function distanceToRange(price: number, low: number, high: number): number {
  if (price >= low && price <= high) return 0;
  return price < low ? low - price : price - high;
}

/** Tìm point có giá gần equilibrium [low, high] nhất, dùng làm tâm để cắt bỏ mốc cực đoan. */
function findEquilibriumPoint<T extends { point: number; price: number }>(parsed: T[]): number {
  const minDistByPoint = new Map<number, number>();
  for (const p of parsed) {
    const dist = distanceToRange(p.price, EQUILIBRIUM_PRICE_RANGE.low, EQUILIBRIUM_PRICE_RANGE.high);
    const existing = minDistByPoint.get(p.point);
    if (existing === undefined || dist < existing) minDistByPoint.set(p.point, dist);
  }

  let bestPoint = parsed[0].point;
  let bestDist = Infinity;
  for (const [point, dist] of minDistByPoint) {
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = point;
    }
  }
  return bestPoint;
}

/** Chỉ giữ các point trong vòng `radius` mốc (level) liền kề equilibrium trong danh sách point đã sort. */
function keepLevelsAroundEquilibrium<T extends { point: number; price: number }>(
  parsed: T[],
  equilibrium: number,
  radius: number,
): Set<number> {
  const sortedPoints = [...new Set(parsed.map((p) => p.point))].sort((a, b) => a - b);
  const eqIndex = sortedPoints.indexOf(equilibrium);
  const from = Math.max(0, eqIndex - radius);
  const to = Math.min(sortedPoints.length - 1, eqIndex + radius);
  return new Set(sortedPoints.slice(from, to + 1));
}

/** "Home -1" / "Away +0.5" -> { side: "H"|"A", point: number }. */
function parseSidePoint(value: string): { side: "H" | "A"; point: number } | null {
  const m = value.match(/^(Home|Away)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { side: m[1] === "Home" ? "H" : "A", point: Number(m[2]) };
}

/** "Asian Handicap" — chỉ giữ ±2 mốc quanh equilibrium, bỏ mốc cực đoan (vd H+5, A-5.5). */
function compactHandicap(bet: ApiFootballBet | undefined): CompactOutcome[] {
  if (!bet) return [];
  const parsed = bet.values
    .map((v) => {
      const sp = parseSidePoint(v.value);
      return sp ? { ...sp, price: Number(v.odd) } : null;
    })
    .filter((v): v is { side: "H" | "A"; point: number; price: number } => v !== null);

  if (parsed.length === 0) return [];

  const equilibrium = findEquilibriumPoint(parsed);
  const keepPoints = keepLevelsAroundEquilibrium(parsed, equilibrium, KEEP_LEVELS_RADIUS);
  return parsed
    .filter((p) => keepPoints.has(p.point))
    .map((p) => ({ name: p.side, price: p.price, point: p.point }));
}

/** "Over 1.5" / "Under 1.5" -> { side: "Over"|"Under", point: number }. */
function parseTotalPoint(value: string): { side: "Over" | "Under"; point: number } | null {
  const m = value.match(/^(Over|Under)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { side: m[1] as "Over" | "Under", point: Number(m[2]) };
}

/** "Goals Over/Under" — chỉ giữ ±2 mốc quanh equilibrium, bỏ mốc cực đoan (vd O7.5, U0.5). */
function compactTotals(bet: ApiFootballBet | undefined): CompactOutcome[] {
  if (!bet) return [];
  const parsed = bet.values
    .map((v) => {
      const tp = parseTotalPoint(v.value);
      return tp ? { ...tp, price: Number(v.odd) } : null;
    })
    .filter((v): v is { side: "Over" | "Under"; point: number; price: number } => v !== null);

  if (parsed.length === 0) return [];

  const equilibrium = findEquilibriumPoint(parsed);
  const keepPoints = keepLevelsAroundEquilibrium(parsed, equilibrium, KEEP_LEVELS_RADIUS);
  return parsed
    .filter((p) => keepPoints.has(p.point))
    .map((p) => ({ name: p.side, price: p.price, point: p.point }));
}

const RESULT_CODE: Record<string, string> = { Home: "H", Draw: "D", Away: "A" };
const TOTAL_CODE: Record<string, string> = { Over: "O", Under: "U" };

/** "Home/Over 1.5" -> { name: "HO", point: 1.5 }. */
function parseResultTotal(value: string): { name: string; point: number } | null {
  const m = value.match(/^(Home|Draw|Away)\/(Over|Under)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { name: `${RESULT_CODE[m[1]]}${TOTAL_CODE[m[2]]}`, point: Number(m[3]) };
}

/** "Result/Total Goals" — combo kết quả + tổng điểm, liệt kê đầy đủ mọi mốc. */
function compactResultTotal(bet: ApiFootballBet | undefined): CompactOutcome[] {
  if (!bet) return [];
  const outcomes: CompactOutcome[] = [];
  for (const v of bet.values) {
    const rt = parseResultTotal(v.value);
    if (rt) outcomes.push({ name: rt.name, price: Number(v.odd), point: rt.point });
  }
  return outcomes;
}

function pushIfNotEmpty(markets: CompactMarket[], key: string, outcomes: CompactOutcome[]): void {
  if (outcomes.length > 0) markets.push({ key, outcomes });
}

/**
 * Map các bet API-Football sang format compact — chỉ giữ market core cho phân tích S1
 * (H2H, Asian Handicap, Goals Over/Under, KQ+Tổng, Correct Score). Bỏ BTTS/H1/H2
 * (độ ưu tiên thấp, không dùng cho main bet S1).
 */
export function compactOdds(bets: ApiFootballBet[], updateIso: string | undefined, _match: MatchInfo): CompactOdds {
  const markets: CompactMarket[] = [];

  pushIfNotEmpty(markets, "h2h", compact3Way(findBet(bets, "Match Winner")));
  pushIfNotEmpty(markets, "asia_handicap", compactHandicap(findBet(bets, "Asian Handicap")));
  pushIfNotEmpty(markets, "asia_totals", compactTotals(findBet(bets, "Goals Over/Under")));
  pushIfNotEmpty(markets, "result_total_goals", compactResultTotal(findBet(bets, "Result/Total Goals")));

  const updatedUnix = updateIso ? Math.floor(new Date(updateIso).getTime() / 1000) : Math.floor(Date.now() / 1000);

  return { updatedUnix, legend: NAME_LEGEND, markets };
}
