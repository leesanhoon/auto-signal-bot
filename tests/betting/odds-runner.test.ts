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
  isStandAsideAnalysis: (value: string) => /đứng\s*ngoài/i.test(value),
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

  test("processes matches independently", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    const first = await oddsRunner.processMatch({
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 1000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });
    const second = await oddsRunner.processMatch({
      gameId: "2",
      home: "Team C",
      away: "Team D",
      kickoffUnix: 2000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });

    expect(first.analysis).not.toBeNull();
    expect(second.analysis).not.toBeNull();
    expect(state.analyzeMatchOdds).toHaveBeenCalledTimes(2);
  });

  test("skips verify and revise when analyze returns no picks", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    state.analyzeMatchOdds.mockResolvedValue({
      match: "Team A vs Team B",
      preferredScoreline: "1-0",
      scoreConfidence: 60,
      recommendation: "Đứng ngoài.",
      confidence: 35,
      keyPoints: ["Không có edge"],
      risks: ["Mâu thuẫn"],
      summary: "No bet",
      picks: [],
    });

    await expect(oddsRunner.processMatch({
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 1000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    })).resolves.toMatchObject({
      analysis: expect.objectContaining({ recommendation: "Đứng ngoài." }),
    });

    expect(state.verifyMatchAnalysis).not.toHaveBeenCalled();
    expect(state.reviseMatchAnalysis).not.toHaveBeenCalled();
  });

  test("skips revise when verify returns hard invalid", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const originalVerify = process.env.BETTING_AI_VERIFY_ENABLED;
    process.env.BETTING_AI_VERIFY_ENABLED = "true";
    state.analyzeMatchOdds.mockResolvedValue({
      match: "Team A vs Team B",
      preferredScoreline: "1-0",
      scoreConfidence: 60,
      recommendation: "Theo dõi",
      confidence: 80,
      keyPoints: ["Điểm mạnh"],
      risks: ["Rủi ro"],
      summary: "Tóm tắt",
      picks: [{ candidateId: "P01", market: "1X2", selection: "Team A thắng", odds: 2.1 }],
    });
    state.verifyMatchAnalysis.mockResolvedValue({
      confirmed: false,
      confidence: 55,
      reasonCode: "HARD_INVALID",
      comment: "Sai cấu trúc",
    });

    await expect(oddsRunner.processMatch({
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 1000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    })).resolves.toMatchObject({
      analysis: expect.objectContaining({ recommendation: "Đứng ngoài." }),
    });

    expect(state.verifyMatchAnalysis).toHaveBeenCalledTimes(1);
    expect(state.reviseMatchAnalysis).not.toHaveBeenCalled();
    if (originalVerify === undefined) {
      delete process.env.BETTING_AI_VERIFY_ENABLED;
    } else {
      process.env.BETTING_AI_VERIFY_ENABLED = originalVerify;
    }
  });

  test("revises exactly once for conflict-like verification failure", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const originalVerify = process.env.BETTING_AI_VERIFY_ENABLED;
    process.env.BETTING_AI_VERIFY_ENABLED = "true";
    state.analyzeMatchOdds.mockResolvedValue({
      match: "Team A vs Team B",
      preferredScoreline: "1-0",
      scoreConfidence: 60,
      recommendation: "Theo dõi",
      confidence: 80,
      keyPoints: ["Điểm mạnh"],
      risks: ["Rủi ro"],
      summary: "Tóm tắt",
      picks: [{ candidateId: "P01", market: "1X2", selection: "Team A thắng", odds: 2.1 }],
    });
    state.verifyMatchAnalysis.mockResolvedValue({
      confirmed: false,
      confidence: 60,
      reasonCode: "CONFLICT",
      comment: "Mâu thuẫn market",
    });
    state.reviseMatchAnalysis.mockResolvedValue({
      match: "Team A vs Team B",
      preferredScoreline: "1-0",
      scoreConfidence: 55,
      recommendation: "Theo dõi",
      confidence: 70,
      keyPoints: ["Đã chỉnh"],
      risks: ["Rủi ro"],
      summary: "Đã sửa",
      picks: [{ candidateId: "P01", market: "1X2", selection: "Team A thắng", odds: 2.1 }],
    });

    await expect(oddsRunner.processMatch({
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 1000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    })).resolves.toMatchObject({
      analysis: expect.objectContaining({ verificationStatus: "revised" }),
    });

    expect(state.verifyMatchAnalysis).toHaveBeenCalledTimes(1);
    expect(state.reviseMatchAnalysis).toHaveBeenCalledTimes(1);
    if (originalVerify === undefined) {
      delete process.env.BETTING_AI_VERIFY_ENABLED;
    } else {
      process.env.BETTING_AI_VERIFY_ENABLED = originalVerify;
    }
  });

  test.each([0, 1, 49])("fails closed when confirmed=true at confidence %i and revise throws", async (confidence) => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.BETTING_AI_VERIFY_ENABLED = "true";
    state.analyzeMatchOdds.mockResolvedValue({
      match: "Team A vs Team B",
      preferredScoreline: "1-0",
      scoreConfidence: 60,
      recommendation: "Theo dõi",
      confidence: 80,
      keyPoints: ["Điểm mạnh"],
      risks: ["Rủi ro"],
      summary: "Tóm tắt",
      picks: [{ candidateId: "P01", market: "1X2", selection: "Team A thắng", odds: 2.1 }],
    });
    state.verifyMatchAnalysis.mockResolvedValue({
      confirmed: true,
      confidence,
      reasonCode: "OTHER",
      comment: "ok",
    });
    state.reviseMatchAnalysis.mockRejectedValue(new Error("revise failed"));

    const result = await oddsRunner.processMatch({
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 1000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });

    expect(state.reviseMatchAnalysis).toHaveBeenCalledTimes(1);
    expect(result.analysis).toMatchObject({
      recommendation: "Đứng ngoài.",
      verificationStatus: "failed",
      verifiedConfirmed: false,
      verifiedConfidence: confidence,
      picks: [],
    });
  });

  test("accepts confirmed results at the confidence threshold", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.BETTING_AI_VERIFY_ENABLED = "true";
    state.analyzeMatchOdds.mockResolvedValue({
      match: "Team A vs Team B",
      preferredScoreline: "1-0",
      scoreConfidence: 60,
      recommendation: "Theo dõi",
      confidence: 80,
      keyPoints: ["Điểm mạnh"],
      risks: ["Rủi ro"],
      summary: "Tóm tắt",
      picks: [{ candidateId: "P01", market: "1X2", selection: "Team A thắng", odds: 2.1 }],
    });
    state.verifyMatchAnalysis.mockResolvedValue({
      confirmed: true,
      confidence: 50,
      reasonCode: "OTHER",
      comment: "ok",
    });

    const result = await oddsRunner.processMatch({
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 1000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });

    expect(state.reviseMatchAnalysis).not.toHaveBeenCalled();
    expect(result.analysis).toMatchObject({
      verificationStatus: "confirmed",
      verifiedConfirmed: true,
      verifiedConfidence: 50,
      picks: [{ candidateId: "P01" }],
    });
  });
  test("skips verify when BETTING_AI_VERIFY_ENABLED is unset (defaults to false)", async () => {
    const original = process.env.BETTING_AI_VERIFY_ENABLED;
    delete process.env.BETTING_AI_VERIFY_ENABLED;

    state.analyzeMatchOdds.mockResolvedValue({
      match: "Team A vs Team B",
      preferredScoreline: "1-0",
      scoreConfidence: 60,
      recommendation: "Theo dõi",
      confidence: 80,
      keyPoints: ["Điểm mạnh"],
      risks: ["Rủi ro"],
      summary: "Tóm tắt",
      picks: [{ candidateId: "P01", market: "1X2", selection: "Team A thắng", odds: 2.1 }],
    });

    const result = await oddsRunner.processMatch({
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 1000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });

    expect(state.verifyMatchAnalysis).not.toHaveBeenCalled();
    expect(state.reviseMatchAnalysis).not.toHaveBeenCalled();
    expect(result.analysis).toMatchObject({
      verificationStatus: "skipped",
      verifiedComment: "Bỏ qua verify theo BETTING_AI_VERIFY_ENABLED=false.",
      picks: [{ candidateId: "P01" }],
    });

    if (original === undefined) {
      delete process.env.BETTING_AI_VERIFY_ENABLED;
    } else {
      process.env.BETTING_AI_VERIFY_ENABLED = original;
    }
  });

  test("skips verify and marks analysis as skipped when BETTING_AI_VERIFY_ENABLED=false", async () => {
    const original = process.env.BETTING_AI_VERIFY_ENABLED;
    process.env.BETTING_AI_VERIFY_ENABLED = "false";

    state.analyzeMatchOdds.mockResolvedValue({
      match: "Team A vs Team B",
      preferredScoreline: "1-0",
      scoreConfidence: 60,
      recommendation: "Theo dõi",
      confidence: 80,
      keyPoints: ["Điểm mạnh"],
      risks: ["Rủi ro"],
      summary: "Tóm tắt",
      picks: [{ candidateId: "P01", market: "1X2", selection: "Team A thắng", odds: 2.1 }],
    });

    const result = await oddsRunner.processMatch({
      gameId: "1",
      home: "Team A",
      away: "Team B",
      kickoffUnix: 1000,
      odds: { updatedUnix: 0, legend: "", markets: [] },
    });

    expect(state.verifyMatchAnalysis).not.toHaveBeenCalled();
    expect(state.reviseMatchAnalysis).not.toHaveBeenCalled();
    expect(result.analysis).toMatchObject({
      verificationStatus: "skipped",
      verifiedComment: "Bỏ qua verify theo BETTING_AI_VERIFY_ENABLED=false.",
      picks: [{ candidateId: "P01" }],
    });

    if (original === undefined) {
      delete process.env.BETTING_AI_VERIFY_ENABLED;
    } else {
      process.env.BETTING_AI_VERIFY_ENABLED = original;
    }
  });
});

afterAll(() => {
  process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
});