function getOddsApiConfig() {
  const apiKey = process.env.ODDS_API_KEY;
  const sport = process.env.ODDS_API_SPORT ?? "soccer_fifa_world_cup";
  const region = process.env.ODDS_API_REGION ?? "eu";
  const bookmaker = process.env.ODDS_API_BOOKMAKER ?? "onexbet";
  if (!apiKey) {
    throw new Error("ODDS_API_KEY environment variable is required");
  }
  return { apiKey, sport, region, bookmaker };
}

export function getConfiguredBookmaker(): string {
  return getOddsApiConfig().bookmaker;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`The Odds API request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The Odds API returned non-JSON response: ${text.slice(0, 300)}`);
  }
}

/** Danh sách trận đấu (không cần markets/regions, không tốn quota odds). */
export async function fetchEvents(): Promise<unknown> {
  const { apiKey, sport } = getOddsApiConfig();
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/?apiKey=${apiKey}`;
  return fetchJson(url);
}

/** Dò toàn bộ market mà bookmaker đang cấu hình cung cấp cho 1 trận cụ thể. */
export async function fetchEventMarketKeys(eventId: string): Promise<string[]> {
  const { apiKey, sport, bookmaker } = getOddsApiConfig();
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/markets/?bookmakers=${bookmaker}&apiKey=${apiKey}`;
  const raw = (await fetchJson(url)) as {
    bookmakers?: Array<{ key: string; markets?: Array<{ key: string }> }>;
  };
  const bm = raw.bookmakers?.find((b) => b.key === bookmaker);
  return bm?.markets?.map((m) => m.key) ?? [];
}

/** Lấy nguyên response odds cho tất cả market đã dò được — không cắt/lọc field nào. */
export async function fetchEventFullOdds(eventId: string, marketKeys: string[]): Promise<unknown> {
  const { apiKey, sport, region, bookmaker } = getOddsApiConfig();
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds/?regions=${region}&markets=${marketKeys.join(",")}&oddsFormat=decimal&bookmakers=${bookmaker}&apiKey=${apiKey}`;
  return fetchJson(url);
}
