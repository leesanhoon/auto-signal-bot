function getBettingConfig() {
  const xHd = process.env.BETTING_X_HD;
  const baseUrl = process.env.BETTING_BASE_URL ?? "https://1xlite-859253.top";
  const champId = process.env.BETTING_CHAMP_ID ?? "2708736";
  if (!xHd) {
    throw new Error("BETTING_X_HD environment variable is required");
  }
  return { xHd, baseUrl, champId };
}

function buildHeaders(xHd: string, referer: string): Record<string, string> {
  return {
    "x-hd": xHd,
    "x-svc-source": "__BETTING_APP__",
    "is-srv": "false",
    Referer: referer,
    "x-mobile-project-id": "0",
    "x-app-n": "__BETTING_APP__",
    "x-requested-with": "XMLHttpRequest",
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  };
}

async function fetchJson(url: string, referer: string): Promise<unknown> {
  const { xHd } = getBettingConfig();
  const response = await fetch(url, { headers: buildHeaders(xHd, referer) });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Betting API request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Betting API returned non-JSON response — x-hd token có thể đã hết hạn, vui lòng cập nhật .env. Body: ${text.slice(0, 300)}`,
    );
  }
}

export async function fetchGamesByChamp(champId?: string): Promise<unknown> {
  const { baseUrl, champId: defaultChampId } = getBettingConfig();
  const id = champId ?? defaultChampId;
  const url = `${baseUrl}/service-api/LineFeed/GamesByGlobalChamp?id=144&champ=${id}&gr=819&country=43&lng=vi`;
  return fetchJson(url, `${baseUrl}/vi/line/football`);
}

export async function fetchGameZip(gameId: string): Promise<unknown> {
  const { baseUrl } = getBettingConfig();
  const url = `${baseUrl}/service-api/LineFeed/GetGameZip?id=${gameId}&lng=vi&isSubGames=true&GroupEvents=true&countevents=250&grMode=4&topGroups=&country=43&marketType=3&isNewBuilder=true`;
  return fetchJson(url, `${baseUrl}/vi/line/football`);
}
