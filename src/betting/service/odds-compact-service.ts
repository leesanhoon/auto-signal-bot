import type { ApiFootballBet } from "../client/betting-api-client.js";
import type { CompactMarket, CompactOdds, CompactOutcome, MatchInfo } from "../model/betting-types.js";

export const NAME_LEGEND =
  "name codes: H=home,A=away,D=draw,O=over,U=under,GG=both teams score,NG=not both teams score. " +
  "KQ+TOT dùng code 2 ký tự (HO/HU/DO/DU/AO/AU = kết quả+tổng). " +
  "Point trong asia_handicap/asia_totals/eu_totals/result_total_goals/corners_handicap/corners_totals/corners_totals_eu/team_goals_home/team_goals_away giữ nguyên dấu từ nguồn. " +
  "asia_totals/corners_totals là Tài Xỉu Asian (mốc .25/.75, cược chia 2 nửa); eu_totals/corners_totals_eu là Tài Xỉu European (mốc .5, cược nguyên) - 2 cách tính khác nhau, không gộp chung. " +
  "corners_1x2/corners_handicap/corners_totals/corners_totals_eu là kèo phạt góc (Corners 1x2 / Corners Asian Handicap / Corners Over Under Asian / Corners Over Under European). " +
  "btts (Both Teams Score) là kèo GG/NG. team_goals_home/team_goals_away là Tài Xỉu số bàn thắng riêng của từng đội (Total - Home / Total - Away). " +
  "Market không có trong danh sách trên sẽ giữ nguyên tên gốc từ bookmaker (dưới dạng slug).";

function findBet(bets: ApiFootballBet[], name: string): ApiFootballBet | undefined {
  return bets.find((bet) => bet.name.toLowerCase() === name.toLowerCase());
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function compact3Way(bet: ApiFootballBet | undefined): CompactOutcome[] {
  if (!bet) return [];
  const map: Record<string, string> = { Home: "H", Draw: "D", Away: "A" };
  return bet.values
    .filter((value) => map[value.value] !== undefined)
    .map((value) => ({ name: map[value.value], price: Number(value.odd) }));
}

function parseSidePoint(value: string): { side: "H" | "A"; point: number } | null {
  const match = value.match(/^(Home|Away)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return { side: match[1] === "Home" ? "H" : "A", point: Number(match[2]) };
}

function compactHandicap(
  bet: ApiFootballBet | undefined,
  _isCorners = false,
): CompactOutcome[] {
  if (!bet) return [];
  const parsed = bet.values
    .map((value) => {
      const sidePoint = parseSidePoint(value.value);
      return sidePoint ? { ...sidePoint, price: Number(value.odd) } : null;
    })
    .filter((value): value is { side: "H" | "A"; point: number; price: number } => value !== null);

  return parsed.map((value) => ({ name: value.side, price: value.price, point: value.point }));
}

function parseTotalPoint(value: string): { side: "Over" | "Under"; point: number } | null {
  const match = value.match(/^(Over|Under)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return { side: match[1] as "Over" | "Under", point: Number(match[2]) };
}

function compactTotals(
  bet: ApiFootballBet | undefined,
  _alwaysKeepPoints: number[] = [],
): CompactOutcome[] {
  if (!bet) return [];
  const parsed = bet.values
    .map((value) => {
      const totalPoint = parseTotalPoint(value.value);
      return totalPoint ? { ...totalPoint, price: Number(value.odd) } : null;
    })
    .filter((value): value is { side: "Over" | "Under"; point: number; price: number } => value !== null);

  return parsed.map((value) => ({ name: value.side, price: value.price, point: value.point }));
}

function isAsianTotalLine(point: number): boolean {
  const frac = Math.abs(point % 1);
  return Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9;
}

function splitTotalsByLineType(outcomes: CompactOutcome[]): { asia: CompactOutcome[]; eu: CompactOutcome[] } {
  const asia: CompactOutcome[] = [];
  const eu: CompactOutcome[] = [];
  for (const outcome of outcomes) {
    (outcome.point !== undefined && isAsianTotalLine(outcome.point) ? asia : eu).push(outcome);
  }
  return { asia, eu };
}

const RESULT_CODE: Record<string, string> = { Home: "H", Draw: "D", Away: "A" };
const TOTAL_CODE: Record<string, string> = { Over: "O", Under: "U" };

function parseResultTotal(value: string): { name: string; point: number } | null {
  const match = value.match(/^(Home|Draw|Away)\/(Over|Under)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return { name: `${RESULT_CODE[match[1]]}${TOTAL_CODE[match[2]]}`, point: Number(match[3]) };
}

function compactResultTotal(bet: ApiFootballBet | undefined): CompactOutcome[] {
  if (!bet) return [];
  const outcomes: CompactOutcome[] = [];
  for (const value of bet.values) {
    const resultTotal = parseResultTotal(value.value);
    if (resultTotal) outcomes.push({ name: resultTotal.name, price: Number(value.odd), point: resultTotal.point });
  }
  return outcomes;
}

function pushIfNotEmpty(markets: CompactMarket[], key: string, outcomes: CompactOutcome[]): void {
  if (outcomes.length > 0) markets.push({ key, outcomes });
}

function compactBtts(bet: ApiFootballBet | undefined): CompactOutcome[] {
  if (!bet) return [];
  const map: Record<string, string> = { Yes: "GG", No: "NG" };
  return bet.values
    .filter((value) => map[value.value] !== undefined)
    .map((value) => ({ name: map[value.value], price: Number(value.odd) }));
}

export function compactOdds(
  bets: ApiFootballBet[],
  updateIso: string | undefined,
  _match: MatchInfo,
): CompactOdds {
  const markets: CompactMarket[] = [];
  const processedBetNames = new Set<string>();
  const knownMarkets = [
    { betName: "Match Winner", key: "h2h", processor: compact3Way },
    { betName: "Asian Handicap", key: "asia_handicap", processor: (bet: ApiFootballBet | undefined) => compactHandicap(bet) },
    { betName: "Goals Over/Under", key: null, processor: null },
    { betName: "Result/Total Goals", key: "result_total_goals", processor: compactResultTotal },
    { betName: "Both Teams Score", key: "btts", processor: compactBtts },
    { betName: "Total - Home", key: "team_goals_home", processor: (bet: ApiFootballBet | undefined) => compactTotals(bet) },
    { betName: "Total - Away", key: "team_goals_away", processor: (bet: ApiFootballBet | undefined) => compactTotals(bet) },
    { betName: "Corners 1x2", key: "corners_1x2", processor: compact3Way },
    { betName: "Corners Asian Handicap", key: "corners_handicap", processor: (bet: ApiFootballBet | undefined) => compactHandicap(bet, true) },
    { betName: "Corners Over Under", key: null, processor: null },
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

  for (const bet of bets) {
    if (!processedBetNames.has(bet.name.toLowerCase())) {
      const key = slugify(bet.name);
      const outcomes: CompactOutcome[] = bet.values.map((value) => ({
        name: value.value,
        price: Number(value.odd),
      }));
      pushIfNotEmpty(markets, key, outcomes);
    }
  }

  const updatedUnix = updateIso ? Math.floor(new Date(updateIso).getTime() / 1000) : Math.floor(Date.now() / 1000);

  return { updatedUnix, legend: NAME_LEGEND, markets };
}
