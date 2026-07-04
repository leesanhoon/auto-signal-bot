import { withConfiguredRateLimit } from "../shared/rate-limit.js";
import { createLogger } from "../shared/logger.js";
import type { MatchPrediction } from "./betting-types.js";

const BASE_URL = "https://v3.football.api-sports.io";
const API_FOOTBALL_RATE_LIMIT = {
  key: "api-football",
  envVar: "API_FOOTBALL_RATE_LIMIT_RPM",
  defaultRpm: 100,
};

export type ApiFootballBetValue = { value: string; odd: string };
export type ApiFootballBet = { id: number; name: string; values: ApiFootballBetValue[] };

function getConfig() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  const bookmaker = process.env.API_FOOTBALL_BOOKMAKER ?? "1xBet";
  // Lọc ở client (không gửi season= qua query) vì free plan chặn truy vấn
  // /fixtures có kèm season hiện tại (chỉ cho phép season 2022-2024).
  // 1 = World Cup, 39 = Premier League, 2 = UEFA Champions League.
  const leagueIds = (process.env.API_FOOTBALL_LEAGUE ?? "1,39,2")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => !Number.isNaN(id));
  if (!apiKey) {
    throw new Error("API_FOOTBALL_KEY environment variable is required");
  }
  return { apiKey, bookmaker, leagueIds };
}

export function getConfiguredBookmaker(): string {
  return getConfig().bookmaker;
}

async function fetchJson(path: string): Promise<any> {
  const { apiKey } = getConfig();
  const response = await withConfiguredRateLimit(API_FOOTBALL_RATE_LIMIT, async () =>
    fetch(`${BASE_URL}${path}`, {
      headers: { "x-apisports-key": apiKey },
    }),
  );
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

function filterByConfiguredLeagues(fixtures: Array<{ league: { id: number } }>): Array<{ league: { id: number } }> {
  const { leagueIds } = getConfig();
  return fixtures.filter((f) => leagueIds.includes(f.league.id));
}

/**
 * Danh sách fixtures trong ngày hôm nay, lọc theo league cấu hình (mặc định World Cup).
 * Không gửi `league=`/`season=` qua query — free plan chặn filter theo season hiện tại,
 * nên phải lấy full /fixtures?date= rồi lọc `league.id` ở client.
 */
export async function fetchFixtures(dateStr: string = todayDateString()): Promise<unknown> {
  const json = await fetchJson(`/fixtures?date=${dateStr}`);
  const all = (json.response ?? []) as Array<{ league: { id: number } }>;
  return { response: filterByConfiguredLeagues(all) };
}

/**
 * Danh sách fixtures đang diễn ra (live), lọc theo league cấu hình.
 * Tương tự fetchFixtures nhưng gọi /fixtures?live=all.
 * Nếu free plan chặn, lỗi sẽ được xử lý ở caller.
 */
export async function fetchLiveFixtures(): Promise<unknown> {
  const json = await fetchJson("/fixtures?live=all");
  const all = (json.response ?? []) as Array<{ league: { id: number } }>;
  return { response: filterByConfiguredLeagues(all) };
}

export type FixtureOdds = { bookmakerName: string; bets: ApiFootballBet[]; updateIso?: string };

export type FixtureResult = {
  fixtureId: string;
  home: string;
  away: string;
  kickoffUnix: number;
  date: string;
  statusShort: string;
  goalsHome: number | null;
  goalsAway: number | null;
};

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

/**
 * Chi tiết fixture theo id, dùng cho backtest betting để lấy tỷ số thực tế sau trận.
 */
export async function fetchFixtureResult(fixtureId: string): Promise<FixtureResult | null> {
  const json = await fetchJson(`/fixtures?id=${fixtureId}`);
  const entry = json.response?.[0] as
    | {
        fixture?: { id?: number; date?: string; status?: { short?: string } };
        teams?: { home?: { name?: string | null }; away?: { name?: string | null } };
        goals?: { home?: number | null; away?: number | null };
      }
    | undefined;

  if (!entry?.fixture?.id || !entry.fixture.date || !entry.teams?.home?.name || !entry.teams?.away?.name) {
    return null;
  }

  const kickoffUnix = Math.floor(new Date(entry.fixture.date).getTime() / 1000);
  return {
    fixtureId: String(entry.fixture.id),
    home: entry.teams.home.name,
    away: entry.teams.away.name,
    kickoffUnix,
    date: entry.fixture.date.slice(0, 10),
    statusShort: String(entry.fixture.status?.short ?? ""),
    goalsHome: entry.goals?.home ?? null,
    goalsAway: entry.goals?.away ?? null,
  };
}

const logger = createLogger("betting:betting-api");
let lastPredictionErrorMessage = "";

type ApiPredictionResponse = {
  predictions?: {
    winner?: { name: string; comment: string } | null;
    percent?: { home: string; draw: string; away: string };
  };
  teams?: {
    home?: {
      last_5?: {
        form?: string;
        goals?: {
          for?: { total?: number; average?: string };
          against?: { total?: number; average?: string };
        };
      };
    };
    away?: {
      last_5?: {
        form?: string;
        goals?: {
          for?: { total?: number; average?: string };
          against?: { total?: number; average?: string };
        };
      };
    };
  };
  comparison?: Record<string, { home: string; away: string }>;
};

/**
 * Lấy prediction data (phong độ, so sánh, dự đoán kết quả) cho fixture.
 * Trả về null nếu free plan chặn hoặc lỗi. Logs new/different errors.
 */
export async function fetchPredictions(fixtureId: string): Promise<MatchPrediction | null> {
  try {
    const json = await fetchJson(`/predictions?fixture=${fixtureId}`);
    const entry = json.response?.[0] as ApiPredictionResponse | undefined;
    if (!entry) return null;

    const homeForm = entry.teams?.home?.last_5?.form ?? "";
    const awayForm = entry.teams?.away?.last_5?.form ?? "";
    // Extract average values from nested goals object
    const homeGoalsFor = entry.teams?.home?.last_5?.goals?.for?.average ?? "";
    const homeGoalsAgainst = entry.teams?.home?.last_5?.goals?.against?.average ?? "";
    const awayGoalsFor = entry.teams?.away?.last_5?.goals?.for?.average ?? "";
    const awayGoalsAgainst = entry.teams?.away?.last_5?.goals?.against?.average ?? "";
    const comparison = entry.comparison ?? {};

    return {
      winner: entry.predictions?.winner ?? null,
      percent: entry.predictions?.percent ?? { home: "", draw: "", away: "" },
      homeForm,
      awayForm,
      homeGoalsFor,
      homeGoalsAgainst,
      awayGoalsFor,
      awayGoalsAgainst,
      comparison,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // Log only if this is a new/different error (not just repeat of same error)
    if (errorMsg !== lastPredictionErrorMessage) {
      lastPredictionErrorMessage = errorMsg;
      logger.warn(`  ⚠ Không lấy được predictions (free plan hoặc lỗi): ${errorMsg}`);
    }
    return null;
  }
}
