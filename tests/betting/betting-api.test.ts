import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getConfiguredBookmaker,
  fetchFixtureOdds,
  fetchFixtureResult,
} from "../../src/betting/betting-api.js";
import * as rateLimit from "../../src/shared/rate-limit.js";

vi.mock("../../src/shared/rate-limit.js");

describe("betting-api.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getConfiguredBookmaker", () => {
    it("should return configured bookmaker from env or default to 1xBet", () => {
      vi.stubEnv("API_FOOTBALL_KEY", "test-key");
      vi.stubEnv("API_FOOTBALL_BOOKMAKER", "Bet365");

      const bookmaker = getConfiguredBookmaker();

      expect(bookmaker).toBe("Bet365");
    });

    it("should default to 1xBet when API_FOOTBALL_BOOKMAKER not set", () => {
      vi.stubEnv("API_FOOTBALL_KEY", "test-key");
      // Don't set API_FOOTBALL_BOOKMAKER env var at all
      delete process.env.API_FOOTBALL_BOOKMAKER;

      const bookmaker = getConfiguredBookmaker();

      expect(bookmaker).toBe("1xBet");
    });

    it("should throw when API_FOOTBALL_KEY is missing", () => {
      vi.stubEnv("API_FOOTBALL_KEY", "");

      expect(() => getConfiguredBookmaker()).toThrow(
        "API_FOOTBALL_KEY environment variable is required",
      );
    });
  });

  describe("fetchFixtureOdds", () => {
    beforeEach(() => {
      vi.stubEnv("API_FOOTBALL_KEY", "test-key");
      vi.stubEnv("API_FOOTBALL_BOOKMAKER", "1xBet");
    });

    it("should fetch odds from preferred bookmaker", async () => {
      const mockJson = {
        response: [
          {
            update: "2026-07-05T12:00:00Z",
            bookmakers: [
              {
                name: "1xBet",
                bets: [
                  {
                    id: 1,
                    name: "Match Winner",
                    values: [
                      { value: "Home", odd: "1.5" },
                      { value: "Away", odd: "2.0" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureOdds("123");

      expect(result).toBeDefined();
      expect(result?.bookmakerName).toBe("1xBet");
      expect(result?.bets).toHaveLength(1);
      expect(result?.updateIso).toBe("2026-07-05T12:00:00Z");
    });

    it("should fallback to first bookmaker when preferred not found", async () => {
      const mockJson = {
        response: [
          {
            update: "2026-07-05T12:00:00Z",
            bookmakers: [
              {
                name: "Bet365",
                bets: [
                  {
                    id: 1,
                    name: "Match Winner",
                    values: [{ value: "Home", odd: "1.5" }],
                  },
                ],
              },
              {
                name: "Pinnacle",
                bets: [],
              },
            ],
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureOdds("123");

      expect(result).toBeDefined();
      expect(result?.bookmakerName).toBe("Bet365");
    });

    it("should return null when no bookmakers available", async () => {
      const mockJson = {
        response: [
          {
            update: "2026-07-05T12:00:00Z",
            bookmakers: [],
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureOdds("123");

      expect(result).toBeNull();
    });

    it("should handle response with non-JSON", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "<!DOCTYPE html>...",
      } as any);

      await expect(fetchFixtureOdds("123")).rejects.toThrow("non-JSON");
    });

    it("should handle API error response", async () => {
      const mockJson = {
        errors: ["Authentication failed"],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify(mockJson),
      } as any);

      await expect(fetchFixtureOdds("123")).rejects.toThrow("API-Football lỗi");
    });
  });

  describe("fetchFixtureResult", () => {
    beforeEach(() => {
      vi.stubEnv("API_FOOTBALL_KEY", "test-key");
    });

    it("should fetch fixture result with all required fields", async () => {
      const mockJson = {
        response: [
          {
            fixture: {
              id: 123,
              date: "2026-07-05T12:00:00Z",
              status: { short: "FT" },
            },
            teams: {
              home: { name: "Team A" },
              away: { name: "Team B" },
            },
            goals: {
              home: 2,
              away: 1,
            },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureResult("123");

      expect(result).toBeDefined();
      expect(result?.fixtureId).toBe("123");
      expect(result?.home).toBe("Team A");
      expect(result?.away).toBe("Team B");
      expect(result?.goalsHome).toBe(2);
      expect(result?.goalsAway).toBe(1);
      expect(result?.statusShort).toBe("FT");
    });

    it("should return null when fixture.id is missing", async () => {
      const mockJson = {
        response: [
          {
            fixture: {
              date: "2026-07-05T12:00:00Z",
              status: { short: "FT" },
            },
            teams: {
              home: { name: "Team A" },
              away: { name: "Team B" },
            },
            goals: { home: 2, away: 1 },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureResult("123");

      expect(result).toBeNull();
    });

    it("should return null when home team name is missing", async () => {
      const mockJson = {
        response: [
          {
            fixture: {
              id: 123,
              date: "2026-07-05T12:00:00Z",
              status: { short: "FT" },
            },
            teams: {
              home: { name: null },
              away: { name: "Team B" },
            },
            goals: { home: 2, away: 1 },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureResult("123");

      expect(result).toBeNull();
    });

    it("should return null when away team name is missing", async () => {
      const mockJson = {
        response: [
          {
            fixture: {
              id: 123,
              date: "2026-07-05T12:00:00Z",
              status: { short: "FT" },
            },
            teams: {
              home: { name: "Team A" },
              away: { name: null },
            },
            goals: { home: 2, away: 1 },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureResult("123");

      expect(result).toBeNull();
    });

    it("should return null when fixture.date is missing", async () => {
      const mockJson = {
        response: [
          {
            fixture: {
              id: 123,
              status: { short: "FT" },
            },
            teams: {
              home: { name: "Team A" },
              away: { name: "Team B" },
            },
            goals: { home: 2, away: 1 },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureResult("123");

      expect(result).toBeNull();
    });

    it("should handle goals being null (fixture not played)", async () => {
      const mockJson = {
        response: [
          {
            fixture: {
              id: 123,
              date: "2026-07-05T12:00:00Z",
              status: { short: "NS" },
            },
            teams: {
              home: { name: "Team A" },
              away: { name: "Team B" },
            },
            goals: { home: null, away: null },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureResult("123");

      expect(result).toBeDefined();
      expect(result?.goalsHome).toBeNull();
      expect(result?.goalsAway).toBeNull();
    });

    it("should handle status.short being undefined", async () => {
      const mockJson = {
        response: [
          {
            fixture: {
              id: 123,
              date: "2026-07-05T12:00:00Z",
              status: {},
            },
            teams: {
              home: { name: "Team A" },
              away: { name: "Team B" },
            },
            goals: { home: 2, away: 1 },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureResult("123");

      expect(result?.statusShort).toBe("");
    });

    it("should parse date correctly (extract YYYY-MM-DD)", async () => {
      const mockJson = {
        response: [
          {
            fixture: {
              id: 123,
              date: "2026-07-05T12:00:00Z",
              status: { short: "FT" },
            },
            teams: {
              home: { name: "Team A" },
              away: { name: "Team B" },
            },
            goals: { home: 1, away: 0 },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchFixtureResult("123");

      expect(result?.date).toBe("2026-07-05");
    });
  });
});
