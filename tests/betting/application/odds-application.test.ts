import { beforeEach, describe, expect, test, vi } from "vitest";

import { createOddsApplication } from "../../../src/betting/application/odds-application.js";

describe("betting/application/odds-application", () => {
  const state = {
    sendMessage: vi.fn(),
    buildOddsPayload: vi.fn(),
    loadUpcomingMatches: vi.fn(),
    generateCombinedAnalysis: vi.fn(),
    saveBettingAnalysisSnapshot: vi.fn(),
    loadRecentSnapshotsByGameIds: vi.fn(),
    getConfiguredBookmaker: vi.fn(),
    pickNearestUpcomingMatches: vi.fn(),
    fetchLiveFixtures: vi.fn(),
    extractMatches: vi.fn(),
  };

  function createApp() {
    return createOddsApplication({
      bettingApiClient: {
        getConfiguredBookmaker: state.getConfiguredBookmaker,
        fetchLiveFixtures: state.fetchLiveFixtures,
      },
      bettingService: {
        buildOddsPayload: state.buildOddsPayload,
        pickNearestUpcomingMatches: state.pickNearestUpcomingMatches,
        extractMatches: state.extractMatches,
      },
      aiClient: {
        generateCombinedAnalysis: state.generateCombinedAnalysis,
      },
      bettingAnalysisRepository: {
        loadRecentSnapshotsByGameIds: state.loadRecentSnapshotsByGameIds,
        saveBettingAnalysisSnapshot: state.saveBettingAnalysisSnapshot,
      },
      matchRepository: {
        loadUpcomingMatches: state.loadUpcomingMatches,
      },
      notifier: {
        sendMessage: state.sendMessage,
        sendPhoto: vi.fn(),
        sendDocument: vi.fn(),
      },
    });
  }

  beforeEach(() => {
    for (const mock of Object.values(state)) mock.mockReset();
    state.sendMessage.mockResolvedValue(undefined);
    state.getConfiguredBookmaker.mockReturnValue("bookmaker");
    state.fetchLiveFixtures.mockResolvedValue({ response: [] });
    state.extractMatches.mockReturnValue([]);
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]);
    state.loadUpcomingMatches.mockResolvedValue([
      { gameId: "1", home: "Team A", away: "Team B", kickoffUnix: 1000, date: "2026-07-02", kickoffTime: "12:00" },
      { gameId: "2", home: "Team C", away: "Team D", kickoffUnix: 2000, date: "2026-07-02", kickoffTime: "14:00" },
    ]);
    state.pickNearestUpcomingMatches.mockImplementation((matches: any[]) => (matches.length > 0 ? [matches[0]] : []));
    state.buildOddsPayload.mockResolvedValue({
      payload: [{ gameId: "1", home: "Team A", away: "Team B", kickoffUnix: 1000, odds: { updatedUnix: 0, legend: "", markets: [] } }],
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
      ],
    });
  });

  test("basic flow: sends odds + calls AI + saves snapshots", async () => {
    await createApp().run();
    expect(state.sendMessage).toHaveBeenCalled();
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(1);
  });

  test("falls back to raw odds when combined analysis fails", async () => {
    state.generateCombinedAnalysis.mockResolvedValue(null);
    await createApp().run();
    expect(state.sendMessage).toHaveBeenCalledWith("⚠️ AI không phân tích được. Đã gửi dữ liệu odds thô phía trên.");
    expect(state.saveBettingAnalysisSnapshot).not.toHaveBeenCalled();
  });

  test("cache hit: displays cached message without calling AI", async () => {
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([
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
    ]);

    await createApp().run();
    expect(state.generateCombinedAnalysis).not.toHaveBeenCalled();
    expect(state.sendMessage.mock.calls.some((call) => String(call[0]).includes("CACHE"))).toBe(true);
  });

  test("cache miss: calls AI and saves snapshots", async () => {
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]);
    await createApp().run();
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(1);
  });

  test("live mode skips cache and still calls AI", async () => {
    state.fetchLiveFixtures.mockResolvedValue({
      response: [{ fixture: { id: 100, date: "2026-07-02T18:00:00Z" }, teams: { home: { name: "Live Team A" }, away: { name: "Live Team B" } } }],
    });
    state.extractMatches.mockReturnValue([
      { gameId: "100", home: "Live Team A", away: "Live Team B", kickoffUnix: 5000, date: "2026-07-02", kickoffTime: "18:00" },
    ]);
    state.buildOddsPayload.mockResolvedValue({
      payload: [{ gameId: "100", home: "Live Team A", away: "Live Team B", kickoffUnix: 5000, odds: { updatedUnix: 0, legend: "", markets: [] } }],
      failures: [],
    });
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([
      { gameId: "100", date: "2026-07-02", home: "Live Team A", away: "Live Team B", kickoffUnix: 5000, odds: { updatedUnix: 0, legend: "", markets: [] }, analysis: { match: "Live Team A vs Live Team B", picks: [], predictedScore: { score: "1-1", confidence: 45 } } },
    ]);

    await createApp().run();
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
  });

  test("fallback to upcoming matches when no live fixtures", async () => {
    state.fetchLiveFixtures.mockResolvedValue({ response: [] });
    state.extractMatches.mockReturnValue([]);
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]);

    await createApp().run();
    expect(state.loadUpcomingMatches).toHaveBeenCalled();
    expect(state.pickNearestUpcomingMatches).toHaveBeenCalled();
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
  });

  test("fallback respects cache when in non-live mode", async () => {
    state.fetchLiveFixtures.mockResolvedValue({ response: [] });
    state.extractMatches.mockReturnValue([]);
    state.pickNearestUpcomingMatches.mockReturnValue([
      { gameId: "1", home: "Team A", away: "Team B", kickoffUnix: 1000, date: "2026-07-02", kickoffTime: "12:00" },
    ]);
    state.buildOddsPayload.mockResolvedValue({
      payload: [{ gameId: "1", home: "Team A", away: "Team B", kickoffUnix: 1000, odds: { updatedUnix: 0, legend: "", markets: [] } }],
      failures: [],
    });
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([
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
    ]);

    await createApp().run();
    expect(state.generateCombinedAnalysis).not.toHaveBeenCalled();
    expect(state.sendMessage).toHaveBeenCalled();
  });

  test("live mode error fallback: no live fixtures exception -> fallback to upcoming", async () => {
    state.fetchLiveFixtures.mockRejectedValue(new Error("Free plan restriction"));
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]);

    await createApp().run();
    expect(state.loadUpcomingMatches).toHaveBeenCalled();
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
  });
});
