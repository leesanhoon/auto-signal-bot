import { describe, expect, test } from "vitest";
import { extractCorrectScore } from "../../src/betting/correct-score-api.js";
import type { ApiFootballBet } from "../../src/betting/betting-api.js";

describe("extractCorrectScore", () => {
  test("returns empty array when no 'exact score' market found", () => {
    const bets: ApiFootballBet[] = [
      {
        id: 1,
        name: "1X2",
        values: [
          { value: "Home", odd: "1.5" },
          { value: "Away", odd: "2.5" },
        ],
      },
    ];

    const result = extractCorrectScore(bets);

    expect(result).toEqual([]);
  });

  test("returns empty array when input is empty", () => {
    const result = extractCorrectScore([]);
    expect(result).toEqual([]);
  });

  test("finds exact score market case-insensitively", () => {
    const bets: ApiFootballBet[] = [
      {
        id: 1,
        name: "Exact Score",
        values: [{ value: "1-0", odd: "5" }],
      },
    ];

    const result = extractCorrectScore(bets);

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe("1-0");
  });

  test("finds exact score with lowercase variant", () => {
    const bets: ApiFootballBet[] = [
      {
        id: 1,
        name: "exact score",
        values: [{ value: "2-1", odd: "8.5" }],
      },
    ];

    const result = extractCorrectScore(bets);

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe("2-1");
  });

  test("filters outcomes with price >= 30", () => {
    const bets: ApiFootballBet[] = [
      {
        id: 1,
        name: "Exact Score",
        values: [
          { value: "1-0", odd: "5" },
          { value: "2-2", odd: "29.99" },
          { value: "0-5", odd: "30" },
          { value: "5-5", odd: "100" },
        ],
      },
    ];

    const result = extractCorrectScore(bets);

    expect(result).toHaveLength(2);
    expect(result.map((o) => o.score)).toEqual(["1-0", "2-2"]);
    expect(result.map((o) => o.price)).toEqual([5, 29.99]);
  });

  test("maps fields correctly: value.value -> score, value.odd -> price (number)", () => {
    const bets: ApiFootballBet[] = [
      {
        id: 1,
        name: "Exact Score",
        values: [
          { value: "3-1", odd: "12.5" },
          { value: "1-1", odd: "15" },
        ],
      },
    ];

    const result = extractCorrectScore(bets);

    expect(result).toEqual([
      { score: "3-1", price: 12.5 },
      { score: "1-1", price: 15 },
    ]);
  });

  test("handles unparseable odd string (NaN) - filtered out since NaN < 30 is false", () => {
    const bets: ApiFootballBet[] = [
      {
        id: 1,
        name: "Exact Score",
        values: [
          { value: "1-0", odd: "5" },
          { value: "2-1", odd: "N/A" },
          { value: "0-0", odd: "20" },
        ],
      },
    ];

    const result = extractCorrectScore(bets);

    // N/A parses to NaN, and NaN < 30 is false, so it gets filtered out
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.score)).toEqual(["1-0", "0-0"]);
  });

  test("handles mixed case variations of exact score", () => {
    const bets: ApiFootballBet[] = [
      {
        id: 1,
        name: "EXACT SCORE",
        values: [{ value: "2-0", odd: "10" }],
      },
    ];

    const result = extractCorrectScore(bets);

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe("2-0");
  });

  test("returns only outcomes below price threshold when multiple exist", () => {
    const bets: ApiFootballBet[] = [
      {
        id: 1,
        name: "Exact Score",
        values: [
          { value: "0-0", odd: "10" },
          { value: "1-1", odd: "20" },
          { value: "2-2", odd: "29.5" },
          { value: "3-3", odd: "50" },
          { value: "4-4", odd: "100" },
        ],
      },
    ];

    const result = extractCorrectScore(bets);

    expect(result).toHaveLength(3);
    expect(result.map((o) => o.score)).toEqual(["0-0", "1-1", "2-2"]);
  });
});
