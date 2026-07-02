import { beforeEach, describe, expect, test, vi } from "vitest";
import * as oddsRunner from "../../src/betting/odds-runner.js";
import {
  formatBettingPlanMessage,
  formatCombinedOddsMessage,
  formatMatchAnalysisMessage,
} from "../../src/betting/odds-text-format.js";

const state = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  buildOddsPayload: vi.fn(),
  loadUpcomingMatches: vi.fn(),
  generateCombinedAnalysis: vi.fn(),
  saveBettingAnalysisSnapshot: vi.fn(),
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
    formatCombinedOddsMessage: vi.fn((payloads) => `RAW:${payloads.length}`),
    formatBettingPlanMessage: vi.fn(() => "PLAN"),
    formatMatchAnalysisMessage: vi.fn(() => "ANALYSIS"),
  };
});

describe("betting/odds-runner combined flow", () => {
  beforeEach(() => {
    state.sendMessage.mockReset();
    state.buildOddsPayload.mockReset();
    state.loadUpcomingMatches.mockReset();
    state.generateCombinedAnalysis.mockReset();
    state.saveBettingAnalysisSnapshot.mockReset();
    state.getConfiguredBookmaker.mockReset();
    state.pickNearestUpcomingDateMatches.mockReset();
    state.sendMessage.mockResolvedValue(undefined);
    state.getConfiguredBookmaker.mockReturnValue("bookmaker");
    state.pickNearestUpcomingDateMatches.mockImplementation((matches: unknown[]) => matches);
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
          gameId: "1",
          home: "Team A",
          away: "Team B",
          kickoffUnix: 1000,
          odds: { updatedUnix: 0, legend: "", markets: [] },
        },
        {
          gameId: "2",
          home: "Team C",
          away: "Team D",
          kickoffUnix: 2000,
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

  test("sends raw odds, combined analysis, and plan", async () => {
    await oddsRunner.runOddsCheck();

    expect(state.sendMessage).toHaveBeenNthCalledWith(1, "RAW:2");
    expect(state.sendMessage).toHaveBeenNthCalledWith(2, expect.stringContaining("📋 *TỔNG QUAN*"));
    expect(state.sendMessage).toHaveBeenNthCalledWith(3, "📋 *KẾ HOẠCH ĐẶT CƯỢC*\nPLAN");
    expect(state.generateCombinedAnalysis).toHaveBeenCalledTimes(1);
    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(2);
    expect(formatCombinedOddsMessage).toHaveBeenCalledTimes(1);
    expect(formatMatchAnalysisMessage).toHaveBeenCalledTimes(2);
    expect(formatBettingPlanMessage).toHaveBeenCalledTimes(1);
  });

  test("falls back to raw odds when combined analysis fails", async () => {
    state.generateCombinedAnalysis.mockResolvedValue(null);

    await oddsRunner.runOddsCheck();

    expect(state.sendMessage).toHaveBeenCalledWith("RAW:2");
    expect(state.sendMessage).toHaveBeenCalledWith(
      "⚠️ AI không phân tích được. Đã gửi dữ liệu odds thô phía trên.",
    );
    expect(state.saveBettingAnalysisSnapshot).not.toHaveBeenCalled();
  });
});
