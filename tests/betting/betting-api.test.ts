import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getConfiguredBookmaker,
  fetchFixtureOdds,
  fetchFixtureResult,
  fetchLiveFixtures,
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

  describe("fetchLiveFixtures", () => {
    beforeEach(() => {
      vi.stubEnv("API_FOOTBALL_KEY", "test-key");
      vi.stubEnv("API_FOOTBALL_LEAGUE", "1,39,2");
    });

    it("should fetch live fixtures and filter by configured leagues", async () => {
      const mockJson = {
        response: [
          {
            fixture: { id: 100, date: "2026-07-05T12:00:00Z" },
            league: { id: 39 }, // Premier League (in config)
            teams: { home: { name: "Team A" }, away: { name: "Team B" } },
            goals: { home: 1, away: 0 },
            score: { fulltime: { home: 1, away: 0 } },
          },
          {
            fixture: { id: 101, date: "2026-07-05T13:00:00Z" },
            league: { id: 100 }, // Not in config
            teams: { home: { name: "Team C" }, away: { name: "Team D" } },
            goals: { home: 0, away: 0 },
            score: { fulltime: { home: 0, away: 0 } },
          },
          {
            fixture: { id: 102, date: "2026-07-05T14:00:00Z" },
            league: { id: 1 }, // World Cup (in config)
            teams: { home: { name: "Team E" }, away: { name: "Team F" } },
            goals: { home: 2, away: 1 },
            score: { fulltime: { home: 2, away: 1 } },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchLiveFixtures();

      expect(result).toBeDefined();
      const response = (result as any).response;
      expect(response).toHaveLength(2);
      expect(response.map((f: any) => f.fixture.id)).toEqual(
        expect.arrayContaining([100, 102])
      );
      expect(response.every((f: any) => [1, 39, 2].includes(f.league.id))).toBe(
        true
      );
    });

    it("should return empty response when no live fixtures", async () => {
      const mockJson = { response: [] };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchLiveFixtures();

      expect(result).toBeDefined();
      expect((result as any).response).toHaveLength(0);
    });

    it("should handle API error gracefully (e.g., free plan restriction)", async () => {
      const mockJson = {
        errors: ["This endpoint is not available with your plan"],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify(mockJson),
      } as any);

      await expect(fetchLiveFixtures()).rejects.toThrow("API-Football lỗi");
    });

    it("should filter correctly when API_FOOTBALL_LEAGUE has custom values", async () => {
      vi.stubEnv("API_FOOTBALL_LEAGUE", "39");

      const mockJson = {
        response: [
          {
            fixture: { id: 100, date: "2026-07-05T12:00:00Z" },
            league: { id: 39 },
            teams: { home: { name: "Team A" }, away: { name: "Team B" } },
            goals: { home: 1, away: 0 },
            score: { fulltime: { home: 1, away: 0 } },
          },
          {
            fixture: { id: 101, date: "2026-07-05T13:00:00Z" },
            league: { id: 1 },
            teams: { home: { name: "Team C" }, away: { name: "Team D" } },
            goals: { home: 0, away: 0 },
            score: { fulltime: { home: 0, away: 0 } },
          },
        ],
      };

      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockJson),
      } as any);

      const result = await fetchLiveFixtures();

      const response = (result as any).response;
      expect(response).toHaveLength(1);
      expect(response[0].fixture.id).toBe(100);
      expect(response[0].league.id).toBe(39);
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
