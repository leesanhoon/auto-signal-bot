import type { ApiFootballBet } from "./betting-api.js";
import type { CorrectScoreOutcome } from "./betting-types.js";

/**
 * Market "Exact Score" (hiển thị trên UI nhà cái là "Correct Score") đã có sẵn trong response /odds.
 * Chỉ giữ tỷ số có xác suất đáng kể (giá < 30), bỏ các tỷ số viễn vông.
 */
export function extractCorrectScore(bets: ApiFootballBet[]): CorrectScoreOutcome[] {
  const bet = bets.find((b) => b.name.toLowerCase() === "exact score");
  if (!bet) return [];
  return bet.values
    .map((v) => ({ score: v.value, price: Number(v.odd) }))
    .filter((o) => o.price < 30);
}
