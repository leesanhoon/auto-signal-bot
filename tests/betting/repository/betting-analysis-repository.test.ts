import { beforeEach, describe, expect, test, vi } from "vitest";

import { createBettingAnalysisRepository } from "../../../src/betting/repository/betting-analysis-repository.js";

const repoState = vi.hoisted(() => ({
  selectResult: { data: null as any, error: null as any },
  from: vi.fn(),
}));

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
    picks: [{ market: "1X2", selection: "Team A thắng", odds: 2.1, reason: "Mạnh" }],
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

describe("betting/repository/betting-analysis-repository", () => {
  let repository: ReturnType<typeof createBettingAnalysisRepository>;

  beforeEach(() => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(() => chain),
      in: vi.fn(() => chain),
      gte: vi.fn(async () => repoState.selectResult),
      order: vi.fn(() => chain),
      upsert: vi.fn(async () => ({ error: null })),
    };

    repoState.from.mockReset();
    repoState.from.mockReturnValue(chain);
    repoState.selectResult = { data: null, error: null };
    repository = createBettingAnalysisRepository({ from: repoState.from } as any);
  });

  test("gameIds rỗng - trả [] ngay, không gọi query", async () => {
    expect(await repository.loadRecentSnapshotsByGameIds([], 30_000)).toEqual([]);
    expect(repoState.from).not.toHaveBeenCalled();
  });

  test("query trả data hợp lệ - map đúng field", async () => {
    repoState.selectResult = { data: [MOCK_ROW], error: null };
    const result = await repository.loadRecentSnapshotsByGameIds(["game-1"], 30 * 60 * 1000);

    expect(result).toHaveLength(1);
    expect(result[0].gameId).toBe("game-1");
    expect(result[0].kickoffUnix).toBe(1000);
    expect(result[0].home).toBe("Team A");
    expect(result[0].away).toBe("Team B");
    expect(result[0].analysis.summary).toBe("Tổng quan");
    expect(result[0].createdAt).toBe("2026-07-03T10:00:00.000Z");
  });

  test("query trả error - trả []", async () => {
    repoState.selectResult = { data: null, error: { message: "DB error" } };
    await expect(repository.loadRecentSnapshotsByGameIds(["game-1"], 30_000)).resolves.toEqual([]);
  });

  test("query trả data null - trả []", async () => {
    repoState.selectResult = { data: null, error: null };
    await expect(repository.loadRecentSnapshotsByGameIds(["game-1"], 30_000)).resolves.toEqual([]);
  });

  test("exception từ db trả []", async () => {
    repoState.from.mockImplementation(() => {
      throw new Error("Network error");
    });
    repository = createBettingAnalysisRepository({ from: repoState.from } as any);
    await expect(repository.loadRecentSnapshotsByGameIds(["game-1"], 30_000)).resolves.toEqual([]);
  });

  test("gọi select đúng cột và filter .in().gte()", async () => {
    repoState.selectResult = { data: [MOCK_ROW], error: null };
    await repository.loadRecentSnapshotsByGameIds(["game-1", "game-2"], 42_000);

    expect(repoState.from).toHaveBeenCalledWith("betting_analysis_snapshots");
    expect(repoState.from().select).toHaveBeenCalledWith(expect.stringContaining("game_id"));
    expect(repoState.from().select().in).toHaveBeenCalledWith("game_id", ["game-1", "game-2"]);
    expect(repoState.from().select().in().gte).toHaveBeenCalledWith("created_at", expect.any(String));
  });

  test("includes created_at in upsert payload with current timestamp", async () => {
    const before = Date.now();
    await repository.saveBettingAnalysisSnapshot(SNAPSHOT_INPUT);
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
    await repository.saveBettingAnalysisSnapshot(SNAPSHOT_INPUT);
    const firstCreatedAt = repoState.from().upsert.mock.calls[0][0].created_at;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await repository.saveBettingAnalysisSnapshot(SNAPSHOT_INPUT);
    const secondCreatedAt = repoState.from().upsert.mock.calls[1][0].created_at;

    expect(new Date(secondCreatedAt).getTime()).toBeGreaterThan(new Date(firstCreatedAt).getTime());
  });
});
