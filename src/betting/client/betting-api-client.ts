import { withConfiguredRateLimit } from "../../shared/infra/rate-limit.js";

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
  return fixtures.filter((fixture) => leagueIds.includes(fixture.league.id));
}

export async function fetchFixtures(dateStr: string = todayDateString()): Promise<unknown> {
  const json = await fetchJson(`/fixtures?date=${dateStr}`);
  const all = (json.response ?? []) as Array<{ league: { id: number } }>;
  return { response: filterByConfiguredLeagues(all) };
}

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

export async function fetchFixtureOdds(fixtureId: string): Promise<FixtureOdds | null> {
  const { bookmaker } = getConfig();
  const json = await fetchJson(`/odds?fixture=${fixtureId}`);
  const entry = json.response?.[0] as
    | { update?: string; bookmakers?: Array<{ name: string; bets: ApiFootballBet[] }> }
    | undefined;
  const allBookmakers = entry?.bookmakers ?? [];
  if (allBookmakers.length === 0) return null;

  const preferred = allBookmakers.find((bookmakerEntry) => bookmakerEntry.name?.toLowerCase() === bookmaker.toLowerCase());
  const chosen = preferred ?? allBookmakers[0];
  return { bookmakerName: chosen.name, bets: chosen.bets, updateIso: entry?.update };
}

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

export interface BettingApiClient {
  getConfiguredBookmaker(): string;
  fetchFixtures(dateStr?: string): Promise<unknown>;
  fetchLiveFixtures(): Promise<unknown>;
  fetchFixtureOdds(fixtureId: string): Promise<FixtureOdds | null>;
  fetchFixtureResult(fixtureId: string): Promise<FixtureResult | null>;
}

export function createBettingApiClient(): BettingApiClient {
  return {
    getConfiguredBookmaker,
    fetchFixtures,
    fetchLiveFixtures,
    fetchFixtureOdds,
    fetchFixtureResult,
  };
}
