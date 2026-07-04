import type { ApiFootballBet } from "./betting-api.js";
import type { CompactMarket, CompactOdds, CompactOutcome, MatchInfo } from "./betting-types.js";

export const NAME_LEGEND =
  "name codes: H=home,A=away,D=draw,O=over,U=under,GG=both teams score,NG=not both teams score. " +
  "KQ+TOT dùng code 2 ký tự (HO/HU/DO/DU/AO/AU = kết quả+tổng). " +
  "Point trong asia_handicap/asia_totals/eu_totals/result_total_goals/corners_handicap/corners_totals/corners_totals_eu/team_goals_home/team_goals_away giữ nguyên dấu từ nguồn. " +
  "asia_totals/corners_totals là Tài Xỉu Asian (mốc .25/.75, cược chia 2 nửa); eu_totals/corners_totals_eu là Tài Xỉu European (mốc .5, cược nguyên) — 2 cách tính khác nhau, không gộp chung. " +
  "corners_1x2/corners_handicap/corners_totals/corners_totals_eu là kèo phạt góc (Corners 1x2 / Corners Asian Handicap / Corners Over Under Asian / Corners Over Under European). " +
  "btts (Both Teams Score) là kèo GG/NG. team_goals_home/team_goals_away là Tài Xỉu số bàn thắng riêng của từng đội (Total - Home / Total - Away). " +
  "Market không có trong danh sách trên sẽ giữ nguyên tên gốc từ bookmaker (dưới dạng slug).";

/** Mốc handicap "giữa" — luôn giữ (chọn đúng dấu), không cần xét vùng giá trị. */
const GOAL_MIDDLE_HANDICAP_LEVELS = [0.75, 1];
/** Mốc Corners HCP — luôn giữ (chọn đúng dấu). */
const CORNERS_MIDDLE_HANDICAP_LEVELS = [1.5, 2, 2.5, 3.5];

function findBet(bets: ApiFootballBet[], name: string): ApiFootballBet | undefined {
  return bets.find((b) => b.name.toLowerCase() === name.toLowerCase());
}

/** Convert market name to slug (e.g., "First Half Winner" → "first_half_winner") */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
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
 * "Asian Handicap" — giữ tất cả mốc (không lọc theo giá). Mỗi mốc có thể có 2 dòng API mirror (H/A)
 * nhưng cả 2 đều giữ để cho AI chọn lựa.
 */
function compactHandicap(bet: ApiFootballBet | undefined, isCorners = false): CompactOutcome[] {
  if (!bet) return [];
  const parsed = bet.values
    .map((v) => {
      const sp = parseSidePoint(v.value);
      return sp ? { ...sp, price: Number(v.odd) } : null;
    })
    .filter((v): v is { side: "H" | "A"; point: number; price: number } => v !== null);

  return parsed.map((p) => ({ name: p.side, price: p.price, point: p.point }));
}

/** "Over 1.5" / "Under 1.5" -> { side: "Over"|"Under", point: number }. */
function parseTotalPoint(value: string): { side: "Over" | "Under"; point: number } | null {
  const m = value.match(/^(Over|Under)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { side: m[1] as "Over" | "Under", point: Number(m[2]) };
}

/**
 * "Goals Over/Under" — giữ tất cả mốc (không lọc theo giá).
 */
function compactTotals(bet: ApiFootballBet | undefined, _alwaysKeepPoints: number[] = []): CompactOutcome[] {
  if (!bet) return [];
  const parsed = bet.values
    .map((v) => {
      const tp = parseTotalPoint(v.value);
      return tp ? { ...tp, price: Number(v.odd) } : null;
    })
    .filter((v): v is { side: "Over" | "Under"; point: number; price: number } => v !== null);

  return parsed.map((p) => ({ name: p.side, price: p.price, point: p.point }));
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
 * Map các bet API-Football sang format compact — xử lý core market (H2H, Asian Handicap, etc.)
 * và passthrough các market khác chưa xử lý (H1/H2, v.v.) giữ nguyên tên.
 */
export function compactOdds(bets: ApiFootballBet[], updateIso: string | undefined, _match: MatchInfo): CompactOdds {
  const markets: CompactMarket[] = [];
  const processedBetNames = new Set<string>();

  // Process known markets
  const knownMarkets = [
    { betName: "Match Winner", key: "h2h", processor: compact3Way },
    { betName: "Asian Handicap", key: "asia_handicap", processor: (b: ApiFootballBet | undefined) => compactHandicap(b) },
    { betName: "Goals Over/Under", key: null, processor: null }, // Special: split by line type
    { betName: "Result/Total Goals", key: "result_total_goals", processor: compactResultTotal },
    { betName: "Both Teams Score", key: "btts", processor: compactBtts },
    { betName: "Total - Home", key: "team_goals_home", processor: (b: ApiFootballBet | undefined) => compactTotals(b) },
    { betName: "Total - Away", key: "team_goals_away", processor: (b: ApiFootballBet | undefined) => compactTotals(b) },
    { betName: "Corners 1x2", key: "corners_1x2", processor: compact3Way },
    { betName: "Corners Asian Handicap", key: "corners_handicap", processor: (b: ApiFootballBet | undefined) => compactHandicap(b, true) },
    { betName: "Corners Over Under", key: null, processor: null }, // Special: split by line type
  ];

  for (const { betName, key, processor } of knownMarkets) {
    const bet = findBet(bets, betName);
    if (bet) processedBetNames.add(bet.name.toLowerCase());

    if (betName === "Goals Over/Under") {
      const goalsTotals = splitTotalsByLineType(compactTotals(bet));
      pushIfNotEmpty(markets, "asia_totals", goalsTotals.asia);
      pushIfNotEmpty(markets, "eu_totals", goalsTotals.eu);
    } else if (betName === "Corners Over Under") {
      const cornersTotals = splitTotalsByLineType(compactTotals(bet));
      pushIfNotEmpty(markets, "corners_totals", cornersTotals.asia);
      pushIfNotEmpty(markets, "corners_totals_eu", cornersTotals.eu);
    } else if (key && processor) {
      pushIfNotEmpty(markets, key, processor(bet));
    }
  }

  // Passthrough for unknown markets
  for (const bet of bets) {
    if (!processedBetNames.has(bet.name.toLowerCase())) {
      const key = slugify(bet.name);
      const outcomes: CompactOutcome[] = bet.values.map((v) => ({
        name: v.value,
        price: Number(v.odd),
      }));
      pushIfNotEmpty(markets, key, outcomes);
    }
  }

  const updatedUnix = updateIso ? Math.floor(new Date(updateIso).getTime() / 1000) : Math.floor(Date.now() / 1000);

  return { updatedUnix, legend: NAME_LEGEND, markets };
}
