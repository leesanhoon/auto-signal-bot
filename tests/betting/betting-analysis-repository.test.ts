import { beforeEach, describe, expect, test, vi } from "vitest";

const repoState = vi.hoisted(() => ({
  selectResult: { data: null, error: null },
  select: vi.fn(),
  gte: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../src/shared/db.js", () => ({
  getDb: () => ({
    from: repoState.from,
  }),
}));

const bettingRepo = await import("../../src/betting/betting-analysis-repository.js");

const MOCK_ROW = {
  id: 1,
  game_id: "game-1",
  date: "2026-07-03",
  home: "Team A",
  away: "Team B",
  kickoff_unix: 1000,
  odds: { updatedUnix: 0, legend: "", markets: [] },
  correct_score: null,
  analysis: {
    match: "Team A vs Team B",
    preferredScoreline: "1-0",
    scoreConfidence: 61,
    recommendation: "Phân tích A",
    confidence: 61,
    picks: [{ market: "1X2", selection: "Team A thắng", odds: 2.1, suitability: "single" as const, reason: "Mạnh" }],
    keyPoints: [],
    risks: [],
    summary: "Tổng quan",
  },
  verified_confirmed: null,
  verified_confidence: null,
  verified_comment: null,
  revised_after_reject: false,
  created_at: "2026-07-03T10:00:00.000Z",
};

const SNAPSHOT_INPUT = {
  gameId: "game-1",
  date: "2026-07-03",
  home: "Team A",
  away: "Team B",
  kickoffUnix: 1000,
  odds: { updatedUnix: 0, legend: "", markets: [] },
  correctScore: null,
  analysis: {
    match: "Team A vs Team B",
    preferredScoreline: "1-0",
    scoreConfidence: 61,
    recommendation: "Test",
    confidence: 61,
    picks: [] as Array<{ market: string; selection: string; odds: number; reason: string }>,
    keyPoints: [],
    risks: [],
    summary: "Test",
  },
  verifiedConfirmed: null,
  verifiedConfidence: null,
  verifiedComment: null,
  revisedAfterReject: false,
};

describe("betting/betting-analysis-repository", () => {
  beforeEach(() => {
    repoState.from.mockReset();
    repoState.select.mockReset();
    repoState.gte.mockReset();

    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(() => chain),
      in: vi.fn(() => chain),
      gte: vi.fn(async () => repoState.selectResult),
      upsert: vi.fn(async () => ({ error: null })),
    };

    repoState.from.mockReturnValue(chain);
  });

  describe("loadRecentSnapshotsByGameIds", () => {
    test("gameIds rỗng — trả [] ngay, không gọi query", async () => {
      const result = await bettingRepo.loadRecentSnapshotsByGameIds([], 30_000);
      expect(result).toEqual([]);
      expect(repoState.from).not.toHaveBeenCalled();
    });

    test("query trả data hợp lệ — map đúng field (game_id → gameId, kickoff_unix → kickoffUnix)", async () => {
      repoState.selectResult = { data: [MOCK_ROW], error: null };

      const result = await bettingRepo.loadRecentSnapshotsByGameIds(["game-1"], 30 * 60 * 1000);

      expect(result).toHaveLength(1);
      expect(result[0].gameId).toBe("game-1");
      expect(result[0].kickoffUnix).toBe(1000);
      expect(result[0].home).toBe("Team A");
      expect(result[0].away).toBe("Team B");
      expect(result[0].analysis.summary).toBe("Tổng quan");
      expect(result[0].createdAt).toBe("2026-07-03T10:00:00.000Z");
    });

    test("query trả error — trả []", async () => {
      repoState.selectResult = { data: null, error: { message: "DB error" } };

      const result = await bettingRepo.loadRecentSnapshotsByGameIds(["game-1"], 30_000);
      expect(result).toEqual([]);
    });

    test("query trả data null — trả []", async () => {
      repoState.selectResult = { data: null, error: null };

      const result = await bettingRepo.loadRecentSnapshotsByGameIds(["game-1"], 30_000);
      expect(result).toEqual([]);
    });

    test("getDb throw — trả [], không throw ra ngoài", async () => {
      repoState.from.mockImplementation(() => {
        throw new Error("Network error");
      });

      const result = await bettingRepo.loadRecentSnapshotsByGameIds(["game-1"], 30_000);
      expect(result).toEqual([]);
    });

    test("gọi select đúng cột và filter .in().gte()", async () => {
      repoState.selectResult = { data: [MOCK_ROW], error: null };

      await bettingRepo.loadRecentSnapshotsByGameIds(["game-1", "game-2"], 42_000);

      expect(repoState.from).toHaveBeenCalledWith("betting_analysis_snapshots");
      expect(repoState.from().select).toHaveBeenCalledWith(
        expect.stringContaining("game_id"),
      );
      expect(repoState.from().select().in).toHaveBeenCalledWith("game_id", ["game-1", "game-2"]);
      expect(repoState.from().select().in().gte).toHaveBeenCalledWith(
        "created_at",
        expect.any(String),
      );
    });
  });

  describe("saveBettingAnalysisSnapshot", () => {
    test("includes created_at in upsert payload with current timestamp", async () => {
      const before = Date.now();
      await bettingRepo.saveBettingAnalysisSnapshot(SNAPSHOT_INPUT);
      const after = Date.now();

      expect(repoState.from).toHaveBeenCalledWith("betting_analysis_snapshots");
      const upsertPayload = repoState.from().upsert.mock.calls[0][0];
      expect(upsertPayload.game_id).toBe("game-1");
      expect(upsertPayload.created_at).toBeDefined();
      const createdAtMs = new Date(upsertPayload.created_at).getTime();
      expect(createdAtMs).toBeGreaterThanOrEqual(before - 1);
      expect(createdAtMs).toBeLessThanOrEqual(after + 1);
    });

    test("created_at is refreshed on subsequent upsert for same gameId", async () => {
      await bettingRepo.saveBettingAnalysisSnapshot(SNAPSHOT_INPUT);
      const firstCreatedAt = repoState.from().upsert.mock.calls[0][0].created_at;

      // Wait a real tick so the next new Date() produces a later timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await bettingRepo.saveBettingAnalysisSnapshot(SNAPSHOT_INPUT);
      const secondCreatedAt = repoState.from().upsert.mock.calls[1][0].created_at;

      expect(secondCreatedAt).toBeDefined();
      expect(new Date(secondCreatedAt).getTime()).toBeGreaterThan(new Date(firstCreatedAt).getTime());
    });
  });

});