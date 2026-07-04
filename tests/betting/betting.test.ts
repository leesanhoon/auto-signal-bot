import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractMatches,
  pickNearestUpcomingDateMatches,
  buildOddsPayload,
} from "../../src/betting/betting.js";
import * as bettingApi from "../../src/betting/betting-api.js";
import * as correctScoreApi from "../../src/betting/correct-score-api.js";

vi.mock("../../src/betting/betting-api.js");
vi.mock("../../src/betting/correct-score-api.js");

describe("betting.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractMatches", () => {
    it("should extract matches with team names", () => {
      const raw = {
        response: [
          {
            fixture: { id: 1, date: "2026-07-05T12:00:00Z" },
            teams: { home: { name: "Team A" }, away: { name: "Team B" } },
            goals: { home: null, away: null },
            score: { fulltime: { home: null, away: null } },
          },
        ],
      };

      const matches = extractMatches(raw);

      expect(matches).toHaveLength(1);
      expect(matches[0].gameId).toBe("1");
      expect(matches[0].home).toBe("Team A");
      expect(matches[0].away).toBe("Team B");
      expect(matches[0].kickoffUnix).toBeDefined();
      expect(matches[0].date).toBeDefined();
      expect(matches[0].kickoffTime).toBeDefined();
    });

    it("should filter out matches with missing team names", () => {
      const raw = {
        response: [
          {
            fixture: { id: 1, date: "2026-07-05T12:00:00Z" },
            teams: { home: { name: "Team A" }, away: { name: null } },
            goals: { home: null, away: null },
            score: { fulltime: { home: null, away: null } },
          },
          {
            fixture: { id: 2, date: "2026-07-05T14:00:00Z" },
            teams: { home: { name: "" }, away: { name: "Team B" } },
            goals: { home: null, away: null },
            score: { fulltime: { home: null, away: null } },
          },
          {
            fixture: { id: 3, date: "2026-07-05T16:00:00Z" },
            teams: { home: { name: "Team C" }, away: { name: "Team D" } },
            goals: { home: null, away: null },
            score: { fulltime: { home: null, away: null } },
          },
        ],
      };

      const matches = extractMatches(raw);

      expect(matches).toHaveLength(1);
      expect(matches[0].home).toBe("Team C");
      expect(matches[0].away).toBe("Team D");
    });

    it("should handle empty response", () => {
      const raw = { response: [] };

      const matches = extractMatches(raw);

      expect(matches).toEqual([]);
    });

    it("should handle undefined response", () => {
      const raw = {};

      const matches = extractMatches(raw);

      expect(matches).toEqual([]);
    });

    it("should calculate correct kickoff time (UTC to VN timezone)", () => {
      // 2026-07-04T17:00:00Z = 2026-07-05T00:00:00 VN (UTC+7)
      const raw = {
        response: [
          {
            fixture: { id: 1, date: "2026-07-04T17:00:00Z" },
            teams: { home: { name: "Team A" }, away: { name: "Team B" } },
            goals: { home: null, away: null },
            score: { fulltime: { home: null, away: null } },
          },
        ],
      };

      const matches = extractMatches(raw);

      expect(matches[0].date).toBe("2026-07-05");
      expect(matches[0].kickoffTime).toBe("00:00");
    });
  });

  describe("pickNearestUpcomingDateMatches", () => {
    it("should return empty array for empty input", () => {
      const result = pickNearestUpcomingDateMatches([]);

      expect(result).toEqual([]);
    });

    it("should return all matches for nearest date when >= 3 matches", () => {
      const matches = [
        {
          gameId: "1",
          home: "A",
          away: "B",
          kickoffUnix: 100,
          date: "2026-07-05",
          kickoffTime: "12:00",
        },
        {
          gameId: "2",
          home: "C",
          away: "D",
          kickoffUnix: 110,
          date: "2026-07-05",
          kickoffTime: "14:00",
        },
        {
          gameId: "3",
          home: "E",
          away: "F",
          kickoffUnix: 120,
          date: "2026-07-05",
          kickoffTime: "16:00",
        },
        {
          gameId: "4",
          home: "G",
          away: "H",
          kickoffUnix: 1000,
          date: "2026-07-06",
          kickoffTime: "12:00",
        },
      ];

      const result = pickNearestUpcomingDateMatches(matches);

      expect(result).toHaveLength(3);
      expect(result.every((m) => m.date === "2026-07-05")).toBe(true);
    });

    it("should fallback to first 3 matches when nearest date has < 3 matches", () => {
      const matches = [
        {
          gameId: "1",
          home: "A",
          away: "B",
          kickoffUnix: 100,
          date: "2026-07-05",
          kickoffTime: "12:00",
        },
        {
          gameId: "2",
          home: "C",
          away: "D",
          kickoffUnix: 110,
          date: "2026-07-05",
          kickoffTime: "14:00",
        },
        {
          gameId: "3",
          home: "E",
          away: "F",
          kickoffUnix: 1000,
          date: "2026-07-06",
          kickoffTime: "12:00",
        },
        {
          gameId: "4",
          home: "G",
          away: "H",
          kickoffUnix: 1010,
          date: "2026-07-06",
          kickoffTime: "14:00",
        },
      ];

      const result = pickNearestUpcomingDateMatches(matches);

      // Nearest date is 2026-07-05 with 2 matches (< 3), fallback to first 3 overall
      expect(result).toHaveLength(3);
      expect(result[0].gameId).toBe("1");
      expect(result[1].gameId).toBe("2");
      expect(result[2].gameId).toBe("3");
    });

    it("should return all matches for nearest date even if > 3", () => {
      const matches = [
        {
          gameId: "1",
          home: "A",
          away: "B",
          kickoffUnix: 100,
          date: "2026-07-05",
          kickoffTime: "12:00",
        },
        {
          gameId: "2",
          home: "C",
          away: "D",
          kickoffUnix: 110,
          date: "2026-07-05",
          kickoffTime: "14:00",
        },
        {
          gameId: "3",
          home: "E",
          away: "F",
          kickoffUnix: 120,
          date: "2026-07-05",
          kickoffTime: "16:00",
        },
        {
          gameId: "4",
          home: "G",
          away: "H",
          kickoffUnix: 130,
          date: "2026-07-05",
          kickoffTime: "18:00",
        },
      ];

      const result = pickNearestUpcomingDateMatches(matches);

      expect(result).toHaveLength(4);
      expect(result.every((m) => m.date === "2026-07-05")).toBe(true);
    });

    it("should return first 3 when only 1-2 matches on nearest date", () => {
      const matches = [
        {
          gameId: "1",
          home: "A",
          away: "B",
          kickoffUnix: 100,
          date: "2026-07-05",
          kickoffTime: "12:00",
        },
        {
          gameId: "2",
          home: "C",
          away: "D",
          kickoffUnix: 200,
          date: "2026-07-06",
          kickoffTime: "12:00",
        },
        {
          gameId: "3",
          home: "E",
          away: "F",
          kickoffUnix: 300,
          date: "2026-07-07",
          kickoffTime: "12:00",
        },
        {
          gameId: "4",
          home: "G",
          away: "H",
          kickoffUnix: 400,
          date: "2026-07-08",
          kickoffTime: "12:00",
        },
      ];

      const result = pickNearestUpcomingDateMatches(matches);

      // NOTE: current behavior — fallback takes first 3 in original order without sorting
      expect(result).toHaveLength(3);
      expect(result[0].gameId).toBe("1");
      expect(result[1].gameId).toBe("2");
      expect(result[2].gameId).toBe("3");
    });
  });

  describe("buildOddsPayload", () => {
    it("should return payload for successful odds fetches", async () => {
      const match1 = {
        gameId: "1",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 100,
        date: "2026-07-05",
        kickoffTime: "12:00",
      };

      const mockOdds = {
        bets: [
          {
            id: 1,
            name: "Match Winner",
            bookmakers: [],
            values: [
              { value: "Home", odd: "1.5" },
              { value: "Away", odd: "2.0" },
            ],
          },
        ],
        updateIso: "2026-07-05T12:00:00Z",
        bookmakerName: "Bet365",
      };

      vi.mocked(bettingApi.fetchFixtureOdds).mockResolvedValue(mockOdds);
      vi.mocked(correctScoreApi.extractCorrectScore).mockReturnValue([]);

      const { payload, failures } = await buildOddsPayload([match1]);

      expect(payload).toHaveLength(1);
      expect(failures).toHaveLength(0);
      expect(payload[0].gameId).toBe("1");
      expect(payload[0].odds).toBeDefined();
    });

    it("should add correctScore to payload if available", async () => {
      const match1 = {
        gameId: "1",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 100,
        date: "2026-07-05",
        kickoffTime: "12:00",
      };

      const mockOdds = {
        bets: [
          {
            id: 1,
            name: "Match Winner",
            bookmakers: [],
            values: [
              { value: "Home", odd: "1.5" },
              { value: "Away", odd: "2.0" },
            ],
          },
        ],
        updateIso: "2026-07-05T12:00:00Z",
        bookmakerName: "Bet365",
      };

      const mockCorrectScore = [
        { name: "1-0", price: 5.0 },
        { name: "1-1", price: 4.0 },
      ];

      vi.mocked(bettingApi.fetchFixtureOdds).mockResolvedValue(mockOdds);
      vi.mocked(correctScoreApi.extractCorrectScore).mockReturnValue(mockCorrectScore);

      const { payload, failures } = await buildOddsPayload([match1]);

      expect(payload).toHaveLength(1);
      expect(failures).toHaveLength(0);
      expect(payload[0].correctScore).toEqual(mockCorrectScore);
    });

    it("should handle fetchFixtureOdds returning null", async () => {
      const match1 = {
        gameId: "1",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 100,
        date: "2026-07-05",
        kickoffTime: "12:00",
      };

      vi.mocked(bettingApi.fetchFixtureOdds).mockResolvedValue(null);

      const { payload, failures } = await buildOddsPayload([match1]);

      expect(payload).toHaveLength(0);
      expect(failures).toHaveLength(1);
      expect(failures[0].match).toEqual(match1);
      expect(failures[0].message).toContain("Không có bookmaker");
    });

    it("should handle fetchFixtureOdds returning empty bets array", async () => {
      const match1 = {
        gameId: "1",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 100,
        date: "2026-07-05",
        kickoffTime: "12:00",
      };

      vi.mocked(bettingApi.fetchFixtureOdds).mockResolvedValue({
        bets: [],
        updateIso: "2026-07-05T12:00:00Z",
        bookmakerName: "Bet365",
      });

      const { payload, failures } = await buildOddsPayload([match1]);

      expect(payload).toHaveLength(0);
      expect(failures).toHaveLength(1);
    });

    it("should handle fetchFixtureOdds throwing error", async () => {
      const match1 = {
        gameId: "1",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 100,
        date: "2026-07-05",
        kickoffTime: "12:00",
      };

      vi.mocked(bettingApi.fetchFixtureOdds).mockRejectedValue(new Error("API failed"));

      const { payload, failures } = await buildOddsPayload([match1]);

      expect(payload).toHaveLength(0);
      expect(failures).toHaveLength(1);
      expect(failures[0].message).toBe("API failed");
    });

    it("should handle mixed success and failure", async () => {
      const match1 = {
        gameId: "1",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 100,
        date: "2026-07-05",
        kickoffTime: "12:00",
      };

      const match2 = {
        gameId: "2",
        home: "Team C",
        away: "Team D",
        kickoffUnix: 110,
        date: "2026-07-05",
        kickoffTime: "14:00",
      };

      const mockOdds = {
        bets: [
          {
            id: 1,
            name: "Match Winner",
            bookmakers: [],
            values: [
              { value: "Home", odd: "1.5" },
              { value: "Away", odd: "2.0" },
            ],
          },
        ],
        updateIso: "2026-07-05T12:00:00Z",
        bookmakerName: "Bet365",
      };

      vi.mocked(bettingApi.fetchFixtureOdds).mockImplementation((gameId) => {
        if (gameId === "1") return Promise.resolve(mockOdds);
        return Promise.reject(new Error("Not found"));
      });

      vi.mocked(correctScoreApi.extractCorrectScore).mockReturnValue([]);

      const { payload, failures } = await buildOddsPayload([match1, match2]);

      expect(payload).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(payload[0].gameId).toBe("1");
      expect(failures[0].match.gameId).toBe("2");
    });

    it("should handle empty matches array", async () => {
      const { payload, failures } = await buildOddsPayload([]);

      expect(payload).toHaveLength(0);
      expect(failures).toHaveLength(0);
    });
  });
});
