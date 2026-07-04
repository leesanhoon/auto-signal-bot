import { beforeEach, describe, expect, test, vi } from "vitest";
import * as oddsRunner from "../../src/betting/odds-runner.js";
import { formatOddsText } from "../../src/betting/odds-text-format.js";

const state = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  buildOddsPayload: vi.fn(),
  loadUpcomingMatches: vi.fn(),
  generateCombinedAnalysis: vi.fn(),
  saveBettingAnalysisSnapshot: vi.fn(),
  loadRecentSnapshotsByGameIds: vi.fn(),
  getConfiguredBookmaker: vi.fn(),
  pickNearestUpcomingDateMatches: vi.fn(),
  pickNearestUpcomingMatch: vi.fn(),
  pickNearestUpcomingMatches: vi.fn(),
  fetchLiveFixtures: vi.fn(),
  extractMatches: vi.fn(),
}));

vi.mock("../../src/shared/telegram.js", () => ({ sendMessage: state.sendMessage }));
vi.mock("../../src/betting/betting-api.js", () => ({
  getConfiguredBookmaker: state.getConfiguredBookmaker,
  fetchLiveFixtures: state.fetchLiveFixtures,
}));
vi.mock("../../src/betting/betting.js", () => ({
  buildOddsPayload: state.buildOddsPayload,
  pickNearestUpcomingDateMatches: state.pickNearestUpcomingDateMatches,
  pickNearestUpcomingMatch: state.pickNearestUpcomingMatch,
  pickNearestUpcomingMatches: state.pickNearestUpcomingMatches,
  extractMatches: state.extractMatches,
}));
vi.mock("../../src/betting/betting-gemini.js", () => ({
  generateCombinedAnalysis: state.generateCombinedAnalysis,
}));
vi.mock("../../src/betting/betting-analysis-repository.js", () => ({
  loadRecentSnapshotsByGameIds: state.loadRecentSnapshotsByGameIds,
  saveBettingAnalysisSnapshot: state.saveBettingAnalysisSnapshot,
}));
vi.mock("../../src/betting/match-repository.js", () => ({
  loadUpcomingMatches: state.loadUpcomingMatches,
}));
vi.mock("../../src/shared/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => undefined,
    }),
  }),
}));
vi.mock("../../src/shared/vn-time.js", () => ({
  vnDateStr: () => "2026-07-02",
}));
vi.mock("../../src/betting/odds-text-format.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/betting/odds-text-format.js")>(
    "../../src/betting/odds-text-format.js",
  );
  return {
    ...actual,
    formatOddsText: vi.fn((payload) => `ODDS:${payload.gameId}`),
    formatCombinedAnalysisMessage: vi.fn(() => "ANALYSIS"),
    formatCachedAnalysisMessage: vi.fn(() => "CACHED"),
  };
});

describe("betting/odds-runner combined flow", () => {
  beforeEach(() => {
    state.sendMessage.mockReset();
    state.buildOddsPayload.mockReset();
    state.loadUpcomingMatches.mockReset();
    state.generateCombinedAnalysis.mockReset();
    state.saveBettingAnalysisSnapshot.mockReset();
    state.loadRecentSnapshotsByGameIds.mockReset();
    state.getConfiguredBookmaker.mockReset();
    state.pickNearestUpcomingDateMatches.mockReset();
    state.pickNearestUpcomingMatch.mockReset();
    state.pickNearestUpcomingMatches.mockReset();
    state.fetchLiveFixtures.mockReset();
    state.extractMatches.mockReset();
    state.sendMessage.mockResolvedValue(undefined);
    state.getConfiguredBookmaker.mockReturnValue("bookmaker");
    state.pickNearestUpcomingDateMatches.mockImplementation((matches: unknown[]) => matches);
    state.pickNearestUpcomingMatch.mockImplementation((matches: any[]) => matches?.[0] ?? null);
    state.pickNearestUpcomingMatches.mockImplementation((matches: any[]) =>
      matches.length > 0 ? [matches[0]] : []
    );
    state.fetchLiveFixtures.mockResolvedValue({ response: [] }); // Default: no live fixtures
    state.extractMatches.mockReturnValue([]); // Default: no live matches
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]);
    state.loadUpcomingMatches.mockResolvedValue([
      {
        gameId: "1",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 1000,
        date: "2026-07-02",
        kickoffTime: "12:00",
      },
      {
        gameId: "2",
        home: "Team C",
        away: "Team D",
        kickoffUnix: 2000,
        date: "2026-07-02",
        kickoffTime: "14:00",
      },
    ]);
    state.buildOddsPayload.mockResolvedValue({
      payload: [
        { gameId: "1", home: "Team A", away: "Team B", kickoffUnix: 1000, odds: { updatedUnix: 0, legend: "", markets: [] } },
        { gameId: "2", home: "Team C", away: "Team D", kickoffUnix: 2000, odds: { updatedUnix: 0, legend: "", markets: [] } },
      ],
      failures: [],
    });
    state.generateCombinedAnalysis.mockResolvedValue({
      summary: "Phân tích ngắn",
      matches: [
        {
          matchIndex: 0,
          matchLabel: "Team A vs Team B",
          kickoff: "2026-07-02 12:00",
          handicapPick: null,
          totalGoalsPick: null,
          picks: [{ market: "eu_totals", selection: "Over 2.5", odds: 1.85, confidence: 75, reason: "Dàn áp" }],
          predictedScore: { score: "2-1", confidence: 65 },
        },
        {
          matchIndex: 1,
          matchLabel: "Team C vs Team D",
          kickoff: "2026-07-02 14:00",
          handicapPick: null,
          totalGoalsPick: null,
          picks: [],
          predictedScore: { score: "1-1", confidence: 45 },
        },
      ],
    });
  });

  test("basic flow: sends odds + calls AI + saves snapshots", async () => {
    await oddsRunner.runOddsCheck();

    // Should send odds messages
    expect(state.sendMessage).toHaveBeenNthCalledWith(1, "ODDS:1");
    expect(state.sendMessage).toHaveBeenNthCalledWith(2, "ODDS:2");
    // Should call combined analysis
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    // Should save snapshots
    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(2);
  });

  test("falls back to raw odds when combined analysis fails", async () => {
    state.generateCombinedAnalysis.mockResolvedValue(null);

    await oddsRunner.runOddsCheck();

    expect(state.sendMessage).toHaveBeenNthCalledWith(1, "ODDS:1");
    expect(state.sendMessage).toHaveBeenNthCalledWith(2, "ODDS:2");
    expect(state.sendMessage).toHaveBeenCalledWith(
      "⚠️ AI không phân tích được. Đã gửi dữ liệu odds thô phía trên.",
    );
    expect(state.saveBettingAnalysisSnapshot).not.toHaveBeenCalled();
  });

  test("cache hit: displays cached message without calling AI", async () => {
    const cachedSnapshots = [
      {
        gameId: "2",
        date: "2026-07-02",
        home: "Team C",
        away: "Team D",
        kickoffUnix: 2000,
        odds: { updatedUnix: 0, legend: "", markets: [] },
        correctScore: null,
        analysis: {
          match: "Team C vs Team D",
          totalGoalsPick: { market: "Tài/Xỉu", selection: "Tài 2.5", odds: 1.85, reason: "Dàn áp" },
          predictedScore: { score: "2-1", confidence: 65 },
          preferredScoreline: "2-1",
          scoreConfidence: 65,
          recommendation: "Phân tích C",
          confidence: 65,
          picks: [],
          keyPoints: [],
          risks: [],
          summary: "Summary",
        },
        verifiedConfirmed: null,
        verifiedConfidence: null,
        verifiedComment: null,
        revisedAfterReject: false,
      },
      {
        gameId: "1",
        date: "2026-07-02",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 1000,
        odds: { updatedUnix: 0, legend: "", markets: [] },
        correctScore: null,
        analysis: {
          match: "Team A vs Team B",
          totalGoalsPick: null,
          predictedScore: { score: "1-1", confidence: 45 },
          preferredScoreline: "1-1",
          scoreConfidence: 45,
          recommendation: "Đứng ngoài",
          confidence: 45,
          picks: [],
          keyPoints: [],
          risks: [],
          summary: "Summary",
        },
        verifiedConfirmed: null,
        verifiedConfidence: null,
        verifiedComment: null,
        revisedAfterReject: false,
      },
    ];

    state.loadRecentSnapshotsByGameIds.mockResolvedValue(cachedSnapshots);
    state.generateCombinedAnalysis.mockReset();

    await oddsRunner.runOddsCheck();

    // Cache hit → không gọi AI
    expect(state.generateCombinedAnalysis).not.toHaveBeenCalled();
    // Phải gửi message với cached data
    expect(state.sendMessage).toHaveBeenCalled();
    const messages = state.sendMessage.mock.calls.map((call) => call[0]);
    const cachedMessage = messages.find((msg) => String(msg).includes("CACHE"));
    expect(cachedMessage).toBeTruthy();
  });

  test("cache miss: calls AI and saves snapshots", async () => {
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]);

    await oddsRunner.runOddsCheck();

    // Cache miss → gọi AI
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(2);
  });

  test("live mode: skips cache and always calls AI", async () => {
    const liveMatches = [
      {
        gameId: "100",
        home: "Live Team A",
        away: "Live Team B",
        kickoffUnix: 5000,
        date: "2026-07-02",
        kickoffTime: "18:00",
      },
    ];

    state.fetchLiveFixtures.mockResolvedValue({
      response: [
        {
          fixture: { id: 100, date: "2026-07-02T18:00:00Z" },
          league: { id: 39 },
          teams: { home: { name: "Live Team A" }, away: { name: "Live Team B" } },
        },
      ],
    });
    state.extractMatches.mockReturnValue(liveMatches);
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([
      // Even if there's a recent cached snapshot
      {
        gameId: "100",
        date: "2026-07-02",
        home: "Live Team A",
        away: "Live Team B",
        kickoffUnix: 5000,
        odds: { updatedUnix: 0, legend: "", markets: [] },
        analysis: {
          match: "Live Team A vs Live Team B",
          picks: [],
          predictedScore: { score: "1-1", confidence: 45 },
        },
      },
    ]);
    state.buildOddsPayload.mockResolvedValue({
      payload: [
        {
          gameId: "100",
          home: "Live Team A",
          away: "Live Team B",
          kickoffUnix: 5000,
          odds: { updatedUnix: 0, legend: "", markets: [] },
        },
      ],
      failures: [],
    });
    state.generateCombinedAnalysis.mockResolvedValue({
      summary: "Live Analysis",
      matches: [
        {
          matchIndex: 0,
          matchLabel: "Live Team A vs Live Team B",
          kickoff: "2026-07-02 18:00",
          handicapPick: null,
          totalGoalsPick: null,
          picks: [],
          predictedScore: { score: "2-0", confidence: 80 },
        },
      ],
    });

    await oddsRunner.runOddsCheck();

    // Live mode: should call generateCombinedAnalysis even with cached snapshots
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(1);
  });

  test("fallback to upcoming matches when no live fixtures", async () => {
    state.fetchLiveFixtures.mockResolvedValue({ response: [] });
    state.extractMatches.mockReturnValue([]);
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]);

    await oddsRunner.runOddsCheck();

    // Should fall back to loadUpcomingMatches
    expect(state.loadUpcomingMatches).toHaveBeenCalled();
    expect(state.pickNearestUpcomingMatches).toHaveBeenCalled();
    // Should call AI (cache miss in fallback mode)
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
  });

  test("fallback respects cache when in non-live mode", async () => {
    const cachedSnapshots = [
      {
        gameId: "1",
        date: "2026-07-02",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 1000,
        odds: { updatedUnix: 0, legend: "", markets: [] },
        correctScore: null,
        analysis: {
          match: "Team A vs Team B",
          picks: [],
          predictedScore: { score: "2-1", confidence: 65 },
          preferredScoreline: "2-1",
          scoreConfidence: 65,
          recommendation: "Có nhận định",
          confidence: 65,
          keyPoints: [],
          risks: [],
          summary: "Summary",
        },
        verifiedConfirmed: null,
        verifiedConfidence: null,
        verifiedComment: null,
        revisedAfterReject: false,
      },
    ];

    state.fetchLiveFixtures.mockResolvedValue({ response: [] });
    state.extractMatches.mockReturnValue([]);
    state.pickNearestUpcomingMatches.mockReturnValue([
      {
        gameId: "1",
        home: "Team A",
        away: "Team B",
        kickoffUnix: 1000,
        date: "2026-07-02",
        kickoffTime: "12:00",
      },
    ]);
    state.buildOddsPayload.mockResolvedValue({
      payload: [
        {
          gameId: "1",
          home: "Team A",
          away: "Team B",
          kickoffUnix: 1000,
          odds: { updatedUnix: 0, legend: "", markets: [] },
        },
      ],
      failures: [],
    });
    state.loadRecentSnapshotsByGameIds.mockResolvedValue(cachedSnapshots);

    await oddsRunner.runOddsCheck();

    // In fallback mode with cache hit, should NOT call AI
    expect(state.generateCombinedAnalysis).not.toHaveBeenCalled();
    // But should send cached message
    expect(state.sendMessage).toHaveBeenCalled();
  });

  test("live mode error fallback: no live fixtures exception → fallback to upcoming", async () => {
    state.fetchLiveFixtures.mockRejectedValue(new Error("Free plan restriction"));
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]);

    await oddsRunner.runOddsCheck();

    // Should fall back to loadUpcomingMatches
    expect(state.loadUpcomingMatches).toHaveBeenCalled();
    // Should eventually call AI
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
  });
});
