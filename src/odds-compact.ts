import type { ApiFootballBet } from "./betting-api.js";
import type { CompactMarket, CompactOdds, CompactOutcome, MatchInfo } from "./betting-types.js";

export const NAME_LEGEND =
  "name codes: H=home,A=away,D=draw,O=over,U=under,GG=both teams score,NG=not both teams score. " +
  "KQ+TOT dùng code 2 ký tự (HO/HU/DO/DU/AO/AU = kết quả+tổng). " +
  "Point trong asia_handicap/asia_totals/eu_totals/result_total_goals/corners_handicap/corners_totals/corners_totals_eu/team_goals_home/team_goals_away giữ nguyên dấu từ nguồn. " +
  "asia_totals/corners_totals là Tài Xỉu Asian (mốc .25/.75, cược chia 2 nửa); eu_totals/corners_totals_eu là Tài Xỉu European (mốc .5, cược nguyên) — 2 cách tính khác nhau, không gộp chung. " +
  "corners_1x2/corners_handicap/corners_totals/corners_totals_eu là kèo phạt góc (Corners 1x2 / Corners Asian Handicap / Corners Over Under Asian / Corners Over Under European). " +
  "btts (Both Teams Score) là kèo GG/NG. team_goals_home/team_goals_away là Tài Xỉu số bàn thắng riêng của từng đội (Total - Home / Total - Away).";

const EQUILIBRIUM_PRICE_RANGE = { low: 1.8, high: 2.0 };
const MIN_TOTALS_PRICE = 1.7;
/** Mốc handicap "giữa" — luôn giữ (chọn đúng dấu gần equilibrium), không cần xét vùng giá trị. */
const GOAL_MIDDLE_HANDICAP_LEVELS = [0.75, 1];
/** Mốc handicap "biên" — chỉ giữ khi odds nằm trong vùng giá trị (equilibrium). */
const GOAL_EDGE_HANDICAP_LEVELS = [0, 0.25, 1.25];
/** Mốc Corners HCP — biên độ corner lớn hơn bàn thắng nên dùng mốc riêng, luôn giữ (chọn đúng dấu). */
const CORNERS_MIDDLE_HANDICAP_LEVELS = [1.5, 2, 2.5, 3.5];

function distanceToRange(price: number, low: number, high: number): number {
  if (price >= low && price <= high) return 0;
  return price < low ? low - price : price - high;
}

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

/** "Home -1" / "Away +0.5" -> { side: "H"|"A", point: number }. */
function parseSidePoint(value: string): { side: "H" | "A"; point: number } | null {
  const m = value.match(/^(Home|Away)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { side: m[1] === "Home" ? "H" : "A", point: Number(m[2]) };
}

/**
 * "Asian Handicap" — mỗi mốc tuyệt đối (level) thường có 2 dòng API mirror nhau (vd point -1 và
 * point +1, mỗi dòng có cả H/A). Chỉ 1 trong 2 dấu là kèo "main" gần equilibrium; dấu còn lại
 * lệch quá xa (gần như 1.0x hoặc rất cao) nên giữ cả 2 sẽ trông như bị đảo chiều. Vì vậy với mỗi
 * level chỉ chọn đúng 1 dấu (gần equilibrium nhất) để giữ.
 * Mốc giữa (level) luôn giữ (đã chọn đúng dấu); mốc biên (goal: 0, 0.25, 1.25) chỉ giữ khi giá
 * nằm trong vùng giá trị (equilibrium).
 */
function compactHandicap(bet: ApiFootballBet | undefined, isCorners = false): CompactOutcome[] {
  if (!bet) return [];
  const parsed = bet.values
    .map((v) => {
      const sp = parseSidePoint(v.value);
      return sp ? { ...sp, price: Number(v.odd) } : null;
    })
    .filter((v): v is { side: "H" | "A"; point: number; price: number } => v !== null);

  if (parsed.length === 0) return [];

  const middleLevels = isCorners ? CORNERS_MIDDLE_HANDICAP_LEVELS : GOAL_MIDDLE_HANDICAP_LEVELS;
  const edgeLevels = isCorners ? [] : GOAL_EDGE_HANDICAP_LEVELS;

  const avgPriceAtPoint = (point: number): number => {
    const entries = parsed.filter((p) => p.point === point);
    return entries.reduce((sum, p) => sum + p.price, 0) / entries.length;
  };

  const pointsByLevel = new Map<number, number[]>();
  for (const p of parsed) {
    const level = Math.abs(p.point);
    const points = pointsByLevel.get(level) ?? [];
    if (!points.includes(p.point)) points.push(p.point);
    pointsByLevel.set(level, points);
  }

  const keepPoints = new Set<number>();
  for (const [level, points] of pointsByLevel) {
    if (!middleLevels.includes(level) && !edgeLevels.includes(level)) continue;

    let bestPoint = points[0];
    let bestDist = distanceToRange(avgPriceAtPoint(bestPoint), EQUILIBRIUM_PRICE_RANGE.low, EQUILIBRIUM_PRICE_RANGE.high);
    for (const point of points.slice(1)) {
      const dist = distanceToRange(avgPriceAtPoint(point), EQUILIBRIUM_PRICE_RANGE.low, EQUILIBRIUM_PRICE_RANGE.high);
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = point;
      }
    }

    if (edgeLevels.includes(level) && bestDist > 0) continue;
    keepPoints.add(bestPoint);
  }

  return parsed.filter((p) => keepPoints.has(p.point)).map((p) => ({ name: p.side, price: p.price, point: p.point }));
}

/** "Over 1.5" / "Under 1.5" -> { side: "Over"|"Under", point: number }. */
function parseTotalPoint(value: string): { side: "Over" | "Under"; point: number } | null {
  const m = value.match(/^(Over|Under)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { side: m[1] as "Over" | "Under", point: Number(m[2]) };
}

/**
 * "Goals Over/Under" — chỉ giữ mốc có odds (Over và Under) đều ≥ 1.70, bỏ mốc lệch quá xa.
 * `alwaysKeepPoints` cho phép ép giữ thêm vài mốc cụ thể dù không đạt ngưỡng giá (vd 0.5 cho
 * team_goals_away, vì O0.5/U0.5 luôn cần hiển thị để biết khả năng đội đó trắng tay/ghi bàn).
 */
function compactTotals(bet: ApiFootballBet | undefined, alwaysKeepPoints: number[] = []): CompactOutcome[] {
  if (!bet) return [];
  const parsed = bet.values
    .map((v) => {
      const tp = parseTotalPoint(v.value);
      return tp ? { ...tp, price: Number(v.odd) } : null;
    })
    .filter((v): v is { side: "Over" | "Under"; point: number; price: number } => v !== null);

  if (parsed.length === 0) return [];

  const minPriceByPoint = new Map<number, number>();
  for (const p of parsed) {
    const existing = minPriceByPoint.get(p.point);
    if (existing === undefined || p.price < existing) minPriceByPoint.set(p.point, p.price);
  }

  return parsed
    .filter((p) => alwaysKeepPoints.includes(p.point) || (minPriceByPoint.get(p.point) ?? 0) >= MIN_TOTALS_PRICE)
    .map((p) => ({ name: p.side, price: p.price, point: p.point }));
}

/** Mốc .25/.75 là Asian Total (cược chia 2 nửa); mốc .5/.0 là European Total (cược nguyên). */
function isAsianTotalLine(point: number): boolean {
  const frac = Math.abs(point % 1);
  return Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9;
}

/** Tách 1 danh sách Over/Under chứa lẫn 2 cách tính Asian (.25/.75) và European (.5/.0). */
function splitTotalsByLineType(outcomes: CompactOutcome[]): { asia: CompactOutcome[]; eu: CompactOutcome[] } {
  const asia: CompactOutcome[] = [];
  const eu: CompactOutcome[] = [];
  for (const o of outcomes) {
    (o.point !== undefined && isAsianTotalLine(o.point) ? asia : eu).push(o);
  }
  return { asia, eu };
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

/** "Both Teams Score" — Yes/No -> GG (cả 2 đội ghi bàn) / NG (không cả 2 đội ghi bàn). */
function compactBtts(bet: ApiFootballBet | undefined): CompactOutcome[] {
  if (!bet) return [];
  const map: Record<string, string> = { Yes: "GG", No: "NG" };
  return bet.values
    .filter((v) => map[v.value] !== undefined)
    .map((v) => ({ name: map[v.value], price: Number(v.odd) }));
}

/**
 * Map các bet API-Football sang format compact — chỉ giữ market core cho phân tích S1
 * (H2H, Asian Handicap, Goals Over/Under, KQ+Tổng, Correct Score, Phạt góc, GG/NG). Bỏ H1/H2
 * (độ ưu tiên thấp, không dùng cho main bet S1).
 */
export function compactOdds(bets: ApiFootballBet[], updateIso: string | undefined, _match: MatchInfo): CompactOdds {
  const markets: CompactMarket[] = [];

  pushIfNotEmpty(markets, "h2h", compact3Way(findBet(bets, "Match Winner")));
  pushIfNotEmpty(markets, "asia_handicap", compactHandicap(findBet(bets, "Asian Handicap")));

  const goalsTotals = splitTotalsByLineType(compactTotals(findBet(bets, "Goals Over/Under")));
  pushIfNotEmpty(markets, "asia_totals", goalsTotals.asia);
  pushIfNotEmpty(markets, "eu_totals", goalsTotals.eu);

  pushIfNotEmpty(markets, "result_total_goals", compactResultTotal(findBet(bets, "Result/Total Goals")));
  pushIfNotEmpty(markets, "btts", compactBtts(findBet(bets, "Both Teams Score")));
  pushIfNotEmpty(markets, "team_goals_home", compactTotals(findBet(bets, "Total - Home")));
  pushIfNotEmpty(markets, "team_goals_away", compactTotals(findBet(bets, "Total - Away"), [0.5]));
  pushIfNotEmpty(markets, "corners_1x2", compact3Way(findBet(bets, "Corners 1x2")));
  pushIfNotEmpty(markets, "corners_handicap", compactHandicap(findBet(bets, "Corners Asian Handicap"), true));

  const cornersTotals = splitTotalsByLineType(compactTotals(findBet(bets, "Corners Over Under")));
  pushIfNotEmpty(markets, "corners_totals", cornersTotals.asia);
  pushIfNotEmpty(markets, "corners_totals_eu", cornersTotals.eu);

  const updatedUnix = updateIso ? Math.floor(new Date(updateIso).getTime() / 1000) : Math.floor(Date.now() / 1000);

  return { updatedUnix, legend: NAME_LEGEND, markets };
}
