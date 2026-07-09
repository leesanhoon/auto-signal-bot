import type { ApiFootballBet } from "../client/betting-api-client.js";
import type { CorrectScoreOutcome } from "../model/betting-types.js";

export function extractCorrectScore(bets: ApiFootballBet[]): CorrectScoreOutcome[] {
  const bet = bets.find((b) => b.name.toLowerCase() === "exact score");
  if (!bet) return [];
  return bet.values.map((v) => ({ score: v.value, price: Number(v.odd) }));
}
