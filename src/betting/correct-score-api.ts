import type { ApiFootballBet } from "./betting-api.js";
import type { CorrectScoreOutcome } from "./betting-types.js";

/**
 * Market "Exact Score" (hiển thị trên UI nhà cái là "Correct Score") đã có sẵn trong response /odds.
 * Giữ tất cả tỷ số (không lọc theo giá).
 */
export function extractCorrectScore(bets: ApiFootballBet[]): CorrectScoreOutcome[] {
  const bet = bets.find((b) => b.name.toLowerCase() === "exact score");
  if (!bet) return [];
  return bet.values.map((v) => ({ score: v.value, price: Number(v.odd) }));
}
