import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchFixtureOdds,
  fetchFixtureResult,
  fetchLiveFixtures,
  getConfiguredBookmaker,
} from "../../../src/betting/client/betting-api-client.js";
import * as rateLimit from "../../../src/shared/rate-limit.js";

vi.mock("../../../src/shared/rate-limit.js");

describe("betting-api-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getConfiguredBookmaker", () => {
    it("should return configured bookmaker from env or default to 1xBet", () => {
      vi.stubEnv("API_FOOTBALL_KEY", "test-key");
      vi.stubEnv("API_FOOTBALL_BOOKMAKER", "Bet365");
      expect(getConfiguredBookmaker()).toBe("Bet365");
    });

    it("should default to 1xBet when API_FOOTBALL_BOOKMAKER not set", () => {
      vi.stubEnv("API_FOOTBALL_KEY", "test-key");
      delete process.env.API_FOOTBALL_BOOKMAKER;
      expect(getConfiguredBookmaker()).toBe("1xBet");
    });

    it("should throw when API_FOOTBALL_KEY is missing", () => {
      vi.stubEnv("API_FOOTBALL_KEY", "");
      expect(() => getConfiguredBookmaker()).toThrow("API_FOOTBALL_KEY environment variable is required");
    });
  });

  describe("fetchLiveFixtures", () => {
    beforeEach(() => {
      vi.stubEnv("API_FOOTBALL_KEY", "test-key");
      vi.stubEnv("API_FOOTBALL_LEAGUE", "1,39,2");
    });

    it("should fetch live fixtures and filter by configured leagues", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            response: [
              { fixture: { id: 100, date: "2026-07-05T12:00:00Z" }, league: { id: 39 }, teams: { home: { name: "Team A" }, away: { name: "Team B" } } },
              { fixture: { id: 101, date: "2026-07-05T13:00:00Z" }, league: { id: 100 }, teams: { home: { name: "Team C" }, away: { name: "Team D" } } },
              { fixture: { id: 102, date: "2026-07-05T14:00:00Z" }, league: { id: 1 }, teams: { home: { name: "Team E" }, away: { name: "Team F" } } },
            ],
          }),
      } as any);

      const result = await fetchLiveFixtures();
      const response = (result as any).response;
      expect(response).toHaveLength(2);
      expect(response.map((fixture: any) => fixture.fixture.id)).toEqual(expect.arrayContaining([100, 102]));
      expect(response.every((fixture: any) => [1, 39, 2].includes(fixture.league.id))).toBe(true);
    });

    it("should return empty response when no live fixtures", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: [] }),
      } as any);

      const result = await fetchLiveFixtures();
      expect((result as any).response).toHaveLength(0);
    });

    it("should handle API error gracefully", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ errors: ["This endpoint is not available with your plan"] }),
      } as any);

      await expect(fetchLiveFixtures()).rejects.toThrow("API-Football lỗi");
    });

    it("should filter correctly when API_FOOTBALL_LEAGUE has custom values", async () => {
      vi.stubEnv("API_FOOTBALL_LEAGUE", "39");
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            response: [
              { fixture: { id: 100, date: "2026-07-05T12:00:00Z" }, league: { id: 39 }, teams: { home: { name: "Team A" }, away: { name: "Team B" } } },
              { fixture: { id: 101, date: "2026-07-05T13:00:00Z" }, league: { id: 1 }, teams: { home: { name: "Team C" }, away: { name: "Team D" } } },
            ],
          }),
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
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            response: [{ update: "2026-07-05T12:00:00Z", bookmakers: [{ name: "1xBet", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.5" }, { value: "Away", odd: "2.0" }] }] }] }],
          }),
      } as any);

      const result = await fetchFixtureOdds("123");
      expect(result?.bookmakerName).toBe("1xBet");
      expect(result?.bets).toHaveLength(1);
      expect(result?.updateIso).toBe("2026-07-05T12:00:00Z");
    });

    it("should fallback to first bookmaker when preferred not found", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            response: [{ update: "2026-07-05T12:00:00Z", bookmakers: [{ name: "Bet365", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.5" }] }] }, { name: "Pinnacle", bets: [] }] }],
          }),
      } as any);

      expect((await fetchFixtureOdds("123"))?.bookmakerName).toBe("Bet365");
    });

    it("should return null when no bookmakers available", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: [{ update: "2026-07-05T12:00:00Z", bookmakers: [] }] }),
      } as any);

      await expect(fetchFixtureOdds("123")).resolves.toBeNull();
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
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ errors: ["Authentication failed"] }),
      } as any);

      await expect(fetchFixtureOdds("123")).rejects.toThrow("API-Football lỗi");
    });
  });

  describe("fetchFixtureResult", () => {
    beforeEach(() => {
      vi.stubEnv("API_FOOTBALL_KEY", "test-key");
    });

    it("should fetch fixture result with all required fields", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            response: [{ fixture: { id: 123, date: "2026-07-05T12:00:00Z", status: { short: "FT" } }, teams: { home: { name: "Team A" }, away: { name: "Team B" } }, goals: { home: 2, away: 1 } }],
          }),
      } as any);

      const result = await fetchFixtureResult("123");
      expect(result?.fixtureId).toBe("123");
      expect(result?.home).toBe("Team A");
      expect(result?.away).toBe("Team B");
      expect(result?.goalsHome).toBe(2);
      expect(result?.goalsAway).toBe(1);
      expect(result?.statusShort).toBe("FT");
    });

    it("should return null when fixture.id is missing", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: [{ fixture: { date: "2026-07-05T12:00:00Z", status: { short: "FT" } }, teams: { home: { name: "Team A" }, away: { name: "Team B" } }, goals: { home: 2, away: 1 } }] }),
      } as any);

      await expect(fetchFixtureResult("123")).resolves.toBeNull();
    });

    it("should return null when home team name is missing", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: [{ fixture: { id: 123, date: "2026-07-05T12:00:00Z", status: { short: "FT" } }, teams: { home: { name: null }, away: { name: "Team B" } }, goals: { home: 2, away: 1 } }] }),
      } as any);

      await expect(fetchFixtureResult("123")).resolves.toBeNull();
    });

    it("should return null when away team name is missing", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: [{ fixture: { id: 123, date: "2026-07-05T12:00:00Z", status: { short: "FT" } }, teams: { home: { name: "Team A" }, away: { name: null } }, goals: { home: 2, away: 1 } }] }),
      } as any);

      await expect(fetchFixtureResult("123")).resolves.toBeNull();
    });

    it("should return null when fixture.date is missing", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: [{ fixture: { id: 123, status: { short: "FT" } }, teams: { home: { name: "Team A" }, away: { name: "Team B" } }, goals: { home: 2, away: 1 } }] }),
      } as any);

      await expect(fetchFixtureResult("123")).resolves.toBeNull();
    });

    it("should handle goals being null (fixture not played)", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: [{ fixture: { id: 123, date: "2026-07-05T12:00:00Z", status: { short: "NS" } }, teams: { home: { name: "Team A" }, away: { name: "Team B" } }, goals: { home: null, away: null } }] }),
      } as any);

      const result = await fetchFixtureResult("123");
      expect(result?.goalsHome).toBeNull();
      expect(result?.goalsAway).toBeNull();
    });

    it("should handle status.short being undefined", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: [{ fixture: { id: 123, date: "2026-07-05T12:00:00Z", status: {} }, teams: { home: { name: "Team A" }, away: { name: "Team B" } }, goals: { home: 2, away: 1 } }] }),
      } as any);

      expect((await fetchFixtureResult("123"))?.statusShort).toBe("");
    });

    it("should parse date correctly (extract YYYY-MM-DD)", async () => {
      vi.mocked(rateLimit.withConfiguredRateLimit).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: [{ fixture: { id: 123, date: "2026-07-05T12:00:00Z", status: { short: "FT" } }, teams: { home: { name: "Team A" }, away: { name: "Team B" } }, goals: { home: 1, away: 0 } }] }),
      } as any);

      expect((await fetchFixtureResult("123"))?.date).toBe("2026-07-05");
    });
  });
});
