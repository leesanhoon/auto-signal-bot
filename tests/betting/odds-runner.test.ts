import { beforeEach, describe, expect, test, vi } from "vitest";
import * as oddsRunner from "../../src/betting/odds-runner.js";
import {
  formatBettingPlanMessage,
  formatOddsText,
  formatPicksSummaryBlock,
} from "../../src/betting/odds-text-format.js";

const state = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  buildOddsPayload: vi.fn(),
  loadUpcomingMatches: vi.fn(),
  generateCombinedAnalysis: vi.fn(),
  saveBettingAnalysisSnapshot: vi.fn(),
  loadRecentSnapshotsByGameIds: vi.fn(),
  savePlanCache: vi.fn(),
  loadRecentPlanCache: vi.fn(),
  getConfiguredBookmaker: vi.fn(),
  pickNearestUpcomingDateMatches: vi.fn(),
}));

vi.mock("../../src/shared/telegram.js", () => ({ sendMessage: state.sendMessage }));
vi.mock("../../src/betting/betting-api.js", () => ({ getConfiguredBookmaker: state.getConfiguredBookmaker }));
vi.mock("../../src/betting/betting.js", () => ({
  buildOddsPayload: state.buildOddsPayload,
  pickNearestUpcomingDateMatches: state.pickNearestUpcomingDateMatches,
}));
vi.mock("../../src/betting/betting-gemini.js", () => ({
  generateCombinedAnalysis: state.generateCombinedAnalysis,
}));
vi.mock("../../src/betting/betting-analysis-repository.js", () => ({
  loadRecentSnapshotsByGameIds: state.loadRecentSnapshotsByGameIds,
  saveBettingAnalysisSnapshot: state.saveBettingAnalysisSnapshot,
  savePlanCache: state.savePlanCache,
  loadRecentPlanCache: state.loadRecentPlanCache,
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
    formatPicksSummaryBlock: vi.fn(() => "PICKS"),
    formatBettingPlanMessage: vi.fn(() => "PLAN"),
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
    state.savePlanCache.mockReset();
    state.loadRecentPlanCache.mockReset();
    state.getConfiguredBookmaker.mockReset();
    state.pickNearestUpcomingDateMatches.mockReset();
    state.sendMessage.mockResolvedValue(undefined);
    state.getConfiguredBookmaker.mockReturnValue("bookmaker");
    state.pickNearestUpcomingDateMatches.mockImplementation((matches: unknown[]) => matches);
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]);
    state.savePlanCache.mockResolvedValue(undefined);
    state.loadRecentPlanCache.mockResolvedValue(null);
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
        kickoffTime: "13:00",
      },
    ]);
    state.buildOddsPayload.mockResolvedValue({
      payload: [
        {
          gameId: "2",
          home: "Team C",
          away: "Team D",
          kickoffUnix: 2000,
          odds: { updatedUnix: 0, legend: "", markets: [] },
        },
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
    state.generateCombinedAnalysis.mockResolvedValue({
      summary: "Tổng quan",
      matches: [
        {
          matchIndex: 0,
          matchLabel: "Team A vs Team B",
          kickoff: "12:00",
          analysis: "Phân tích A",
          preferredScoreline: "1-0",
          scoreConfidence: 61,
          topPicks: [
            { market: "1X2", selection: "Team A thắng", odds: 2.1, suitability: "single", reason: "Mạnh" },
          ],
        },
        {
          matchIndex: 1,
          matchLabel: "Team C vs Team D",
          kickoff: "13:00",
          analysis: "Phân tích B",
          preferredScoreline: "2-1",
          scoreConfidence: 58,
          topPicks: [
            { market: "GG/NG", selection: "GG", odds: 1.9, suitability: "parlay", reason: "Ghép xiên" },
          ],
        },
      ],
      parlays: [],
      remainingSingles: [],
    });
    state.saveBettingAnalysisSnapshot.mockResolvedValue(undefined);
  });

  test("sends raw odds then combined analysis+plan as single message", async () => {
    await oddsRunner.runOddsCheck();

    expect(state.sendMessage).toHaveBeenCalledTimes(3);
    expect(state.sendMessage).toHaveBeenNthCalledWith(1, "ODDS:1");
    expect(state.sendMessage).toHaveBeenNthCalledWith(2, "ODDS:2");
    expect(state.sendMessage).toHaveBeenNthCalledWith(3, expect.stringContaining("📋 *PHÂN TÍCH + KẾ HOẠCH ĐẶT CƯỢC*"));
    expect(state.sendMessage).toHaveBeenNthCalledWith(3, expect.stringContaining("💡 *Tổng quan:*"));
    expect(state.sendMessage).toHaveBeenNthCalledWith(3, expect.stringContaining("═══════════════════════"));
    expect(state.sendMessage).toHaveBeenNthCalledWith(3, expect.stringContaining("PICKS"));
    expect(state.sendMessage).toHaveBeenNthCalledWith(3, expect.stringContaining("PLAN"));
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(2);
    expect(formatOddsText).toHaveBeenCalledTimes(2);
    expect(formatPicksSummaryBlock).toHaveBeenCalledTimes(1);
    expect(formatBettingPlanMessage).toHaveBeenCalledTimes(1);
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

  test("cache hit: loadRecentSnapshotsByGameIds trả đủ snapshot → không gọi AI, sendMessage có nội dung cache", async () => {
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([
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
          preferredScoreline: "1-0",
          scoreConfidence: 65,
          recommendation: "Phân tích C",
          confidence: 65,
          picks: [{ market: "1X2", selection: "Team C thắng", odds: 2.0, suitability: "single" as const, reason: "OK" }],
          keyPoints: [],
          risks: [],
          summary: "Tổng quan cache",
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
          preferredScoreline: "2-1",
          scoreConfidence: 58,
          recommendation: "Phân tích B",
          confidence: 58,
          picks: [{ market: "GG/NG", selection: "GG", odds: 1.9, suitability: "parlay" as const, reason: "Ghép xiên" }],
          keyPoints: [],
          risks: [],
          summary: "Tổng quan cache",
        },
        verifiedConfirmed: null,
        verifiedConfidence: null,
        verifiedComment: null,
        revisedAfterReject: false,
      },
    ]);

    await oddsRunner.runOddsCheck();

    // Cache hit — không gọi AI
    expect(state.generateCombinedAnalysis).not.toHaveBeenCalled();
    expect(state.saveBettingAnalysisSnapshot).not.toHaveBeenCalled();
    // sendMessage được gọi với nội dung cache (chỉ 1 message + 2 odds messages)
    expect(state.sendMessage).toHaveBeenCalledTimes(3);
    expect(state.sendMessage).toHaveBeenNthCalledWith(3, expect.stringContaining("từ cache"));
    expect(state.sendMessage).toHaveBeenNthCalledWith(3, expect.stringContaining("Tổng quan"));
  });

  test("cache miss (thiếu 1 gameId): gọi AI như luồng cũ", async () => {
    // Chỉ trả 1 snapshot cho gameId="2", thiếu gameId="1"
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([
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
          preferredScoreline: "1-0",
          scoreConfidence: 65,
          recommendation: "Phân tích C",
          confidence: 65,
          picks: [],
          keyPoints: [],
          risks: [],
          summary: "Cache riêng",
        },
        verifiedConfirmed: null,
        verifiedConfidence: null,
        verifiedComment: null,
        revisedAfterReject: false,
      },
    ]);

    await oddsRunner.runOddsCheck();

    // Cache miss → phải gọi AI
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(2);
  });

  test("loadRecentSnapshotsByGameIds throw: không crash, fallback gọi AI", async () => {
    state.loadRecentSnapshotsByGameIds.mockRejectedValue(new Error("DB timeout"));

    await oddsRunner.runOddsCheck();

    // Không crash, vẫn gọi AI
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(2);
  });

  test("cache hit with plan cache: displays full message with kèo ghép", async () => {
    const mockPlan = {
      summary: "Kế hoạch đặt cược",
      matches: [],
      parlays: [{ type: "xiên 2", legs: [], combinedOdds: 3.0, stake: 100, potentialWin: 300 }],
      remainingSingles: [],
    };

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
          preferredScoreline: "1-0",
          scoreConfidence: 61,
          recommendation: "Phân tích",
          confidence: 61,
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
        gameId: "2",
        date: "2026-07-02",
        home: "Team C",
        away: "Team D",
        kickoffUnix: 2000,
        odds: { updatedUnix: 0, legend: "", markets: [] },
        correctScore: null,
        analysis: {
          match: "Team C vs Team D",
          preferredScoreline: "1-1",
          scoreConfidence: 45,
          recommendation: "Phân tích",
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
    state.loadRecentPlanCache.mockResolvedValue(mockPlan);
    state.generateCombinedAnalysis.mockReset();

    await oddsRunner.runOddsCheck();

    // Cache hit → không gọi AI
    expect(state.generateCombinedAnalysis).not.toHaveBeenCalled();
    // Nhưng phải gửi message với kèo ghép
    expect(state.sendMessage).toHaveBeenCalled();
    const messages = state.sendMessage.mock.calls.map((call) => call[0]);
    const fullMessage = messages.find((msg) => String(msg).includes("PHÂN TÍCH + KẾ HOẠCH"));
    expect(fullMessage).toBeTruthy();
  });

  test("cache hit without plan cache: displays cache message + warning about missing plan", async () => {
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
          preferredScoreline: "1-0",
          scoreConfidence: 61,
          recommendation: "Phân tích",
          confidence: 61,
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
        gameId: "2",
        date: "2026-07-02",
        home: "Team C",
        away: "Team D",
        kickoffUnix: 2000,
        odds: { updatedUnix: 0, legend: "", markets: [] },
        correctScore: null,
        analysis: {
          match: "Team C vs Team D",
          preferredScoreline: "1-1",
          scoreConfidence: 45,
          recommendation: "Phân tích",
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
    state.loadRecentPlanCache.mockResolvedValue(null);
    state.generateCombinedAnalysis.mockReset();

    await oddsRunner.runOddsCheck();

    // Cache hit → không gọi AI
    expect(state.generateCombinedAnalysis).not.toHaveBeenCalled();
    // Nhưng phải gửi message với warning về missing plan
    expect(state.sendMessage).toHaveBeenCalled();
    const messages = state.sendMessage.mock.calls.map((call) => call[0]);
    const fullMessage = messages.find((msg) => String(msg).includes("KẾ HOẠCH ĐẶT CƯỢC"));
    expect(fullMessage).toBeTruthy();
    expect(String(fullMessage)).toContain("không còn");
  });

  test("cache miss: saves plan cache after AI analysis", async () => {
    state.loadRecentSnapshotsByGameIds.mockResolvedValue([]); // cache miss
    state.generateCombinedAnalysis.mockResolvedValue({
      summary: "Kế hoạch mới",
      matches: [],
      parlays: [],
      remainingSingles: [],
    });

    await oddsRunner.runOddsCheck();

    // Cache miss → gọi AI + lưu plan cache
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    expect(state.savePlanCache).toHaveBeenCalledTimes(1);
    expect(state.savePlanCache.mock.calls[0][0]).toBe("2026-07-02");
    expect(state.savePlanCache.mock.calls[0][1]).toEqual(["1", "2"]);
  });
});
