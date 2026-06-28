const BASE_URL = "https://v3.football.api-sports.io";

export type ApiFootballBetValue = { value: string; odd: string };
export type ApiFootballBet = { id: number; name: string; values: ApiFootballBetValue[] };

function getConfig() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  const bookmaker = process.env.API_FOOTBALL_BOOKMAKER ?? "1xBet";
  // 1 = FIFA World Cup. Lọc ở client (không gửi season= qua query) vì free plan
  // chặn truy vấn /fixtures có kèm season hiện tại (chỉ cho phép season 2022-2024).
  const leagueId = Number(process.env.API_FOOTBALL_LEAGUE ?? "1");
  if (!apiKey) {
    throw new Error("API_FOOTBALL_KEY environment variable is required");
  }
  return { apiKey, bookmaker, leagueId };
}

export function getConfiguredBookmaker(): string {
  return getConfig().bookmaker;
}

async function fetchJson(path: string): Promise<any> {
  const { apiKey } = getConfig();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "x-apisports-key": apiKey },
  });
  const text = await response.text();

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`API-Football trả về non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }

  const hasErrors = Array.isArray(json.errors) ? json.errors.length > 0 : Object.keys(json.errors ?? {}).length > 0;
  if (!response.ok || hasErrors) {
    throw new Error(`API-Football lỗi (${response.status}): ${JSON.stringify(json.errors ?? json)}`);
  }
  return json;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Danh sách fixtures trong ngày hôm nay, lọc theo league cấu hình (mặc định World Cup).
 * Không gửi `league=`/`season=` qua query — free plan chặn filter theo season hiện tại,
 * nên phải lấy full /fixtures?date= rồi lọc `league.id` ở client.
 */
export async function fetchFixtures(dateStr: string = todayDateString()): Promise<unknown> {
  const { leagueId } = getConfig();
  const json = await fetchJson(`/fixtures?date=${dateStr}`);
  const all = (json.response ?? []) as Array<{ league: { id: number } }>;
  return { response: all.filter((f) => f.league.id === leagueId) };
}

export type FixtureOdds = { bookmakerName: string; bets: ApiFootballBet[]; updateIso?: string };

/**
 * Toàn bộ market (kể cả "Exact Score") cho 1 fixture, từ bookmaker đã cấu hình
 * (ưu tiên API_FOOTBALL_BOOKMAKER, mặc định "1xBet"); fallback bookmaker đầu
 * tiên có data nếu bookmaker ưu tiên không cung cấp trận này.
 */
export async function fetchFixtureOdds(fixtureId: string): Promise<FixtureOdds | null> {
  const { bookmaker } = getConfig();
  const json = await fetchJson(`/odds?fixture=${fixtureId}`);
  const entry = json.response?.[0] as { update?: string; bookmakers?: Array<{ name: string; bets: ApiFootballBet[] }> } | undefined;
  const allBookmakers = entry?.bookmakers ?? [];
  if (allBookmakers.length === 0) return null;

  const preferred = allBookmakers.find((b) => b.name?.toLowerCase() === bookmaker.toLowerCase());
  const chosen = preferred ?? allBookmakers[0];
  return { bookmakerName: chosen.name, bets: chosen.bets, updateIso: entry?.update };
}
