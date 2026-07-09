import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBettingService,
  extractMatches,
  pickNearestUpcomingDateMatches,
  pickNearestUpcomingMatch,
  pickNearestUpcomingMatches,
} from "../../../src/betting/service/betting-service.js";

describe("betting/service/betting-service", () => {
  const bettingApiClient = {
    fetchFixtureOdds: vi.fn(),
  };

  const service = createBettingService({ bettingApiClient });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractMatches", () => {
    it("should extract matches with team names", () => {
      const matches = extractMatches({
        response: [
          {
            fixture: { id: 1, date: "2026-07-05T12:00:00Z" },
            teams: { home: { name: "Team A" }, away: { name: "Team B" } },
          },
        ],
      });

      expect(matches).toHaveLength(1);
      expect(matches[0].gameId).toBe("1");
      expect(matches[0].home).toBe("Team A");
      expect(matches[0].away).toBe("Team B");
      expect(matches[0].kickoffUnix).toBeDefined();
      expect(matches[0].date).toBeDefined();
      expect(matches[0].kickoffTime).toBeDefined();
    });

    it("should filter out matches with missing team names", () => {
      const matches = extractMatches({
        response: [
          {
            fixture: { id: 1, date: "2026-07-05T12:00:00Z" },
            teams: { home: { name: "Team A" }, away: { name: null } },
          },
          {
            fixture: { id: 2, date: "2026-07-05T14:00:00Z" },
            teams: { home: { name: "" }, away: { name: "Team B" } },
          },
          {
            fixture: { id: 3, date: "2026-07-05T16:00:00Z" },
            teams: { home: { name: "Team C" }, away: { name: "Team D" } },
          },
        ],
      });

      expect(matches).toHaveLength(1);
      expect(matches[0].home).toBe("Team C");
      expect(matches[0].away).toBe("Team D");
    });

    it("should handle empty response", () => {
      expect(extractMatches({ response: [] })).toEqual([]);
    });

    it("should handle undefined response", () => {
      expect(extractMatches({})).toEqual([]);
    });

    it("should calculate correct kickoff time (UTC to VN timezone)", () => {
      const matches = extractMatches({
        response: [
          {
            fixture: { id: 1, date: "2026-07-04T17:00:00Z" },
            teams: { home: { name: "Team A" }, away: { name: "Team B" } },
          },
        ],
      });

      expect(matches[0].date).toBe("2026-07-05");
      expect(matches[0].kickoffTime).toBe("00:00");
    });
  });

  describe("pickNearestUpcomingDateMatches", () => {
    it("should return empty array for empty input", () => {
      expect(pickNearestUpcomingDateMatches([])).toEqual([]);
    });

    it("should return all matches for nearest date when >= 3 matches", () => {
      const matches = [
        { gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "2", home: "C", away: "D", kickoffUnix: 110, date: "2026-07-05", kickoffTime: "14:00" },
        { gameId: "3", home: "E", away: "F", kickoffUnix: 120, date: "2026-07-05", kickoffTime: "16:00" },
        { gameId: "4", home: "G", away: "H", kickoffUnix: 1000, date: "2026-07-06", kickoffTime: "12:00" },
      ];

      const result = pickNearestUpcomingDateMatches(matches);
      expect(result).toHaveLength(3);
      expect(result.every((match) => match.date === "2026-07-05")).toBe(true);
    });

    it("should fallback to first 3 matches when nearest date has < 3 matches", () => {
      const matches = [
        { gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "2", home: "C", away: "D", kickoffUnix: 110, date: "2026-07-05", kickoffTime: "14:00" },
        { gameId: "3", home: "E", away: "F", kickoffUnix: 1000, date: "2026-07-06", kickoffTime: "12:00" },
        { gameId: "4", home: "G", away: "H", kickoffUnix: 1010, date: "2026-07-06", kickoffTime: "14:00" },
      ];

      const result = pickNearestUpcomingDateMatches(matches);
      expect(result).toHaveLength(3);
      expect(result[0].gameId).toBe("1");
      expect(result[1].gameId).toBe("2");
      expect(result[2].gameId).toBe("3");
    });

    it("should return all matches for nearest date even if > 3", () => {
      const matches = [
        { gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "2", home: "C", away: "D", kickoffUnix: 110, date: "2026-07-05", kickoffTime: "14:00" },
        { gameId: "3", home: "E", away: "F", kickoffUnix: 120, date: "2026-07-05", kickoffTime: "16:00" },
        { gameId: "4", home: "G", away: "H", kickoffUnix: 130, date: "2026-07-05", kickoffTime: "18:00" },
      ];

      const result = pickNearestUpcomingDateMatches(matches);
      expect(result).toHaveLength(4);
      expect(result.every((match) => match.date === "2026-07-05")).toBe(true);
    });

    it("should return first 3 when only 1-2 matches on nearest date", () => {
      const matches = [
        { gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "2", home: "C", away: "D", kickoffUnix: 200, date: "2026-07-06", kickoffTime: "12:00" },
        { gameId: "3", home: "E", away: "F", kickoffUnix: 300, date: "2026-07-07", kickoffTime: "12:00" },
        { gameId: "4", home: "G", away: "H", kickoffUnix: 400, date: "2026-07-08", kickoffTime: "12:00" },
      ];

      const result = pickNearestUpcomingDateMatches(matches);
      expect(result).toHaveLength(3);
      expect(result[0].gameId).toBe("1");
      expect(result[1].gameId).toBe("2");
      expect(result[2].gameId).toBe("3");
    });
  });

  describe("pickNearestUpcomingMatch", () => {
    it("should return null for empty input", () => {
      expect(pickNearestUpcomingMatch([])).toBeNull();
    });

    it("should return the only match", () => {
      const matches = [{ gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" }];
      expect(pickNearestUpcomingMatch(matches)).toEqual(matches[0]);
    });

    it("should return match with smallest kickoffUnix", () => {
      const matches = [
        { gameId: "2", home: "C", away: "D", kickoffUnix: 200, date: "2026-07-05", kickoffTime: "14:00" },
        { gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "3", home: "E", away: "F", kickoffUnix: 300, date: "2026-07-06", kickoffTime: "16:00" },
      ];

      const result = pickNearestUpcomingMatch(matches);
      expect(result?.gameId).toBe("1");
      expect(result?.kickoffUnix).toBe(100);
    });

    it("should handle matches from different dates", () => {
      const matches = [
        { gameId: "3", home: "E", away: "F", kickoffUnix: 300, date: "2026-07-06", kickoffTime: "16:00" },
        { gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "2", home: "C", away: "D", kickoffUnix: 200, date: "2026-07-05", kickoffTime: "14:00" },
      ];

      expect(pickNearestUpcomingMatch(matches)?.gameId).toBe("1");
    });
  });

  describe("pickNearestUpcomingMatches", () => {
    it("should return empty array for empty input", () => {
      expect(pickNearestUpcomingMatches([])).toEqual([]);
    });

    it("should return the only match", () => {
      const matches = [{ gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" }];
      const result = pickNearestUpcomingMatches(matches);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(matches[0]);
    });

    it("should return all matches with same earliest date and kickoff time", () => {
      const matches = [
        { gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "2", home: "C", away: "D", kickoffUnix: 101, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "3", home: "E", away: "F", kickoffUnix: 200, date: "2026-07-05", kickoffTime: "14:00" },
        { gameId: "4", home: "G", away: "H", kickoffUnix: 300, date: "2026-07-06", kickoffTime: "12:00" },
      ];

      const result = pickNearestUpcomingMatches(matches);
      expect(result).toHaveLength(2);
      expect(result.map((match) => match.gameId)).toEqual(expect.arrayContaining(["1", "2"]));
      expect(result.every((match) => match.date === "2026-07-05" && match.kickoffTime === "12:00")).toBe(true);
    });

    it("should prioritize earliest kickoffUnix when multiple dates/times exist", () => {
      const matches = [
        { gameId: "3", home: "E", away: "F", kickoffUnix: 300, date: "2026-07-06", kickoffTime: "12:00" },
        { gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "2", home: "C", away: "D", kickoffUnix: 200, date: "2026-07-05", kickoffTime: "14:00" },
      ];

      const result = pickNearestUpcomingMatches(matches);
      expect(result).toHaveLength(1);
      expect(result[0].gameId).toBe("1");
      expect(result[0].date).toBe("2026-07-05");
      expect(result[0].kickoffTime).toBe("12:00");
    });

    it("should handle matches when earliest is from later date (out-of-order input)", () => {
      const matches = [
        { gameId: "1", home: "A", away: "B", kickoffUnix: 100, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "2", home: "C", away: "D", kickoffUnix: 101, date: "2026-07-05", kickoffTime: "12:00" },
        { gameId: "3", home: "E", away: "F", kickoffUnix: 50, date: "2026-07-04", kickoffTime: "12:00" },
      ];

      const result = pickNearestUpcomingMatches(matches);
      expect(result).toHaveLength(1);
      expect(result[0].gameId).toBe("3");
    });
  });

  describe("buildOddsPayload", () => {
    const match1 = {
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 100,
      date: "2026-07-05",
      kickoffTime: "12:00",
    };

    it("should return payload for successful odds fetches", async () => {
      bettingApiClient.fetchFixtureOdds.mockResolvedValue({
        bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.5" }, { value: "Away", odd: "2.0" }] }],
        updateIso: "2026-07-05T12:00:00Z",
        bookmakerName: "Bet365",
      });

      const { payload, failures } = await service.buildOddsPayload([match1]);
      expect(payload).toHaveLength(1);
      expect(failures).toHaveLength(0);
      expect(payload[0].gameId).toBe("1");
      expect(payload[0].odds).toBeDefined();
    });

    it("should add correctScore to payload if available", async () => {
      bettingApiClient.fetchFixtureOdds.mockResolvedValue({
        bets: [
          { id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.5" }, { value: "Away", odd: "2.0" }] },
          { id: 2, name: "Exact Score", values: [{ value: "1-0", odd: "5" }, { value: "1-1", odd: "4" }] },
        ],
        updateIso: "2026-07-05T12:00:00Z",
        bookmakerName: "Bet365",
      });

      const { payload, failures } = await service.buildOddsPayload([match1]);
      expect(payload).toHaveLength(1);
      expect(failures).toHaveLength(0);
      expect(payload[0].correctScore).toEqual([
        { score: "1-0", price: 5 },
        { score: "1-1", price: 4 },
      ]);
    });

    it("should handle fetchFixtureOdds returning null", async () => {
      bettingApiClient.fetchFixtureOdds.mockResolvedValue(null);

      const { payload, failures } = await service.buildOddsPayload([match1]);
      expect(payload).toHaveLength(0);
      expect(failures).toHaveLength(1);
      expect(failures[0].match).toEqual(match1);
      expect(failures[0].message).toContain("bookmaker");
    });

    it("should handle fetchFixtureOdds returning empty bets array", async () => {
      bettingApiClient.fetchFixtureOdds.mockResolvedValue({
        bets: [],
        updateIso: "2026-07-05T12:00:00Z",
        bookmakerName: "Bet365",
      });

      const { payload, failures } = await service.buildOddsPayload([match1]);
      expect(payload).toHaveLength(0);
      expect(failures).toHaveLength(1);
    });

    it("should handle fetchFixtureOdds throwing error", async () => {
      bettingApiClient.fetchFixtureOdds.mockRejectedValue(new Error("API failed"));

      const { payload, failures } = await service.buildOddsPayload([match1]);
      expect(payload).toHaveLength(0);
      expect(failures).toHaveLength(1);
      expect(failures[0].message).toBe("API failed");
    });

    it("should handle mixed success and failure", async () => {
      const match2 = {
        gameId: "2",
        home: "Team C",
        away: "Team D",
        kickoffUnix: 110,
        date: "2026-07-05",
        kickoffTime: "14:00",
      };

      bettingApiClient.fetchFixtureOdds.mockImplementation((gameId: string) => {
        if (gameId === "1") {
          return Promise.resolve({
            bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.5" }, { value: "Away", odd: "2.0" }] }],
            updateIso: "2026-07-05T12:00:00Z",
            bookmakerName: "Bet365",
          });
        }
        return Promise.reject(new Error("Not found"));
      });

      const { payload, failures } = await service.buildOddsPayload([match1, match2]);
      expect(payload).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(payload[0].gameId).toBe("1");
      expect(failures[0].match.gameId).toBe("2");
    });

    it("should handle empty matches array", async () => {
      const { payload, failures } = await service.buildOddsPayload([]);
      expect(payload).toHaveLength(0);
      expect(failures).toHaveLength(0);
    });
  });
});
