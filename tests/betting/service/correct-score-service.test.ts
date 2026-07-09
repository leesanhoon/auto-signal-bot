import { describe, expect, test } from "vitest";
import { extractCorrectScore } from "../../../src/betting/service/correct-score-service.js";
import type { ApiFootballBet } from "../../../src/betting/client/betting-api-client.js";

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

  test("returns all outcomes without price filtering", () => {
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

    expect(result).toHaveLength(4);
    expect(result.map((o) => o.score)).toEqual(["1-0", "2-2", "0-5", "5-5"]);
    expect(result.map((o) => o.price)).toEqual([5, 29.99, 30, 100]);
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

  test("includes all valid scores even with unparseable odds (NaN becomes NaN)", () => {
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

    // N/A parses to NaN, but now we include all values (NaN is included)
    expect(result).toHaveLength(3);
    expect(result.map((o) => o.score)).toEqual(["1-0", "2-1", "0-0"]);
    expect(result[1].price).toBeNaN();
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

  test("returns all outcomes regardless of price", () => {
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

    expect(result).toHaveLength(5);
    expect(result.map((o) => o.score)).toEqual(["0-0", "1-1", "2-2", "3-3", "4-4"]);
    expect(result.map((o) => o.price)).toEqual([10, 20, 29.5, 50, 100]);
  });
});
