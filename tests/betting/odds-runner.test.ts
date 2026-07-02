import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  buildOddsPayload: vi.fn(),
  loadUpcomingMatches: vi.fn(),
  analyzeMatchOdds: vi.fn(),
  verifyMatchAnalysis: vi.fn(),
  reviseMatchAnalysis: vi.fn(),
  saveBettingAnalysisSnapshot: vi.fn(),
  getConfiguredBookmaker: vi.fn(),
  pickNearestUpcomingDateMatches: vi.fn(),
}));
const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

vi.mock("../../src/shared/telegram.js", () => ({ sendMessage: state.sendMessage }));
vi.mock("../../src/betting/betting-api.js", () => ({ getConfiguredBookmaker: state.getConfiguredBookmaker }));
vi.mock("../../src/betting/betting.js", () => ({
  buildOddsPayload: state.buildOddsPayload,
  pickNearestUpcomingDateMatches: state.pickNearestUpcomingDateMatches,
}));
vi.mock("../../src/betting/betting-gemini.js", () => ({
  analyzeMatchOdds: state.analyzeMatchOdds,
  reviseMatchAnalysis: state.reviseMatchAnalysis,
  verifyMatchAnalysis: state.verifyMatchAnalysis,
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
      child: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: () => undefined,
      }),
    }),
  }),
}));
vi.mock("../../src/shared/vn-time.js", () => ({
  vnDateStr: () => "2026-07-02",
}));

const oddsRunner = await import("../../src/betting/odds-runner.js");

describe("betting/odds-runner", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    state.sendMessage.mockReset();
    state.buildOddsPayload.mockReset();
    state.loadUpcomingMatches.mockReset();
    state.analyzeMatchOdds.mockReset();
    state.verifyMatchAnalysis.mockReset();
    state.reviseMatchAnalysis.mockReset();
    state.saveBettingAnalysisSnapshot.mockReset();
    state.getConfiguredBookmaker.mockReset();
    state.pickNearestUpcomingDateMatches.mockReset();
    state.sendMessage.mockImplementation(async () => undefined);
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
    state.analyzeMatchOdds.mockResolvedValue({
      match: "Team A vs Team B",
      preferredScoreline: "1-0",
      scoreConfidence: 60,
      recommendation: "Team A",
      confidence: 80,
      keyPoints: ["Điểm mạnh"],
      risks: ["Rủi ro"],
      summary: "Tóm tắt",
    });
    state.verifyMatchAnalysis.mockResolvedValue({ confirmed: true, confidence: 90, comment: "ok" });
    state.saveBettingAnalysisSnapshot.mockResolvedValue(undefined);
  });

  test("continues processing later matches when Telegram send fails for one match", async () => {
    state.sendMessage.mockImplementationOnce(async () => undefined);
    state.sendMessage.mockImplementationOnce(async () => {
      throw new Error("telegram down");
    });

    await expect(oddsRunner.runOddsCheck()).resolves.toBeUndefined();

    expect(state.saveBettingAnalysisSnapshot).toHaveBeenCalledTimes(2);
    expect(state.analyzeMatchOdds).toHaveBeenCalledTimes(2);
    expect(state.sendMessage.mock.calls.some(([message]) => String(message).includes("Team C vs Team D"))).toBe(true);
  });
});

afterAll(() => {
  process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
});
