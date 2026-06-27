import type { CompactOdds, MatchInfo, OddsApiEvent } from "./betting-types.js";

export const NAME_LEGEND =
  "name codes: H=home,A=away,D=draw,HD=home-or-draw,AD=away-or-draw,HA=home-or-away";

/**
 * Mã hóa tên đội trong outcome thành code ngắn (H/A/D...) để tránh lặp lại
 * tên đội đầy đủ ~50+ lần trong file — tiết kiệm token cho AI đọc. Market
 * không gắn tên đội (totals/btts...) giữ nguyên "Over"/"Under"/"Yes"/"No".
 */
export function compactName(rawName: string, home: string, away: string): string {
  if (rawName === home) return "H";
  if (rawName === away) return "A";
  if (rawName === "Draw") return "D";
  if (rawName === `${home} or Draw`) return "HD";
  if (rawName === `${away} or Draw`) return "AD";
  if (rawName === `${home} or ${away}`) return "HA";
  return rawName;
}

export function compactOdds(rawEvent: OddsApiEvent, match: MatchInfo): CompactOdds {
  const bookmaker = rawEvent.bookmakers[0];
  const updatedUnix = bookmaker?.markets[0]
    ? Math.floor(new Date(bookmaker.markets[0].last_update).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const markets = (bookmaker?.markets ?? []).map((m) => ({
    key: m.key,
    outcomes: m.outcomes.map((o) => ({
      name: compactName(o.name, match.home, match.away),
      price: o.price,
      ...(o.point !== undefined ? { point: o.point } : {}),
    })),
  }));

  return { updatedUnix, legend: NAME_LEGEND, markets };
}
