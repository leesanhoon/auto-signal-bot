import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: [] as Array<{
    date: string;
    region: "mien-bac" | "mien-trung" | "mien-nam";
    method_version: string | null;
    hit: boolean | null;
    hit2: boolean | null;
  }>,
  error: null as { message: string } | null,
  from: vi.fn(),
}));

vi.mock("../../src/shared/infra/db.js", () => ({
  getDb: () => ({ from: state.from }),
}));

let reportModule: typeof import("../../src/lottery/lottery-hit-rate-report.js");

beforeAll(async () => {
  reportModule = await import("../../src/lottery/lottery-hit-rate-report.js");
});

describe("lottery-hit-rate-report", () => {
  beforeEach(() => {
    state.data = [];
    state.error = null;
    state.from.mockReset();

    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(() => chain),
      not: vi.fn(() => chain),
      gte: vi.fn(async () => ({ data: state.data, error: state.error })),
    };

    state.from.mockReturnValue(chain);
  });

  test("computeHitRateStats groups by region and method_version", async () => {
    state.data = [
      { date: "2026-07-08", region: "mien-bac", method_version: "v1", hit: true, hit2: true },
      { date: "2026-07-08", region: "mien-bac", method_version: "v1", hit: false, hit2: true },
      { date: "2026-07-07", region: "mien-bac", method_version: "v1", hit: true, hit2: true },
      { date: "2026-07-08", region: "mien-bac", method_version: "v2", hit: false, hit2: false },
      { date: "2026-07-06", region: "mien-trung", method_version: "v2", hit: true, hit2: true },
    ];

    const stats = await reportModule.computeHitRateStats(30);

    expect(stats).toEqual([
      {
        region: "mien-bac",
        methodVersion: "v1",
        periodsVerified: 2,
        totalPredictions: 3,
        totalHits: 2,
        hitRate: 2 / 3,
        totalHits2: 3,
        hitRate2: 1,
      },
      {
        region: "mien-bac",
        methodVersion: "v2",
        periodsVerified: 1,
        totalPredictions: 1,
        totalHits: 0,
        hitRate: 0,
        totalHits2: 0,
        hitRate2: 0,
      },
      {
        region: "mien-trung",
        methodVersion: "v2",
        periodsVerified: 1,
        totalPredictions: 1,
        totalHits: 1,
        hitRate: 1,
        totalHits2: 1,
        hitRate2: 1,
      },
    ]);

    expect(state.from).toHaveBeenCalledWith("lottery_predictions");
    expect(state.from().select).toHaveBeenCalledWith("date, region, method_version, hit, hit2");
    expect(state.from().not).toHaveBeenCalledWith("verified_at", "is", null);
    expect(state.from().gte.mock.calls[0][0]).toBe("date");
  });

  test("computeHitRateStats maps empty method_version to unknown", async () => {
    state.data = [
      { date: "2026-07-08", region: "mien-nam", method_version: null, hit: false, hit2: true },
    ];

    const stats = await reportModule.computeHitRateStats(7);

    expect(stats).toEqual([
      {
        region: "mien-nam",
        methodVersion: "unknown",
        periodsVerified: 1,
        totalPredictions: 1,
        totalHits: 0,
        hitRate: 0,
        totalHits2: 1,
        hitRate2: 1,
      },
    ]);
  });

  test("formatHitRateReport renders readable markdown and avoids NaN for zero totals", () => {
    const message = reportModule.formatHitRateReport(
      [
        {
          region: "mien-bac",
          methodVersion: "ensemble-v1",
          periodsVerified: 12,
          totalPredictions: 10,
          totalHits: 4,
          hitRate: 0.4,
          totalHits2: 7,
          hitRate2: 0.7,
        },
        {
          region: "mien-trung",
          methodVersion: "cold-start",
          periodsVerified: 0,
          totalPredictions: 0,
          totalHits: 0,
          hitRate: 0,
          totalHits2: 0,
          hitRate2: 0,
        },
      ],
      30,
    );

    expect(message).toContain("LOTTERY HIT-RATE REPORT");
    expect(message).toContain("🟦 Miền Bắc");
    expect(message).toContain("ensemble-v1");
    expect(message).toContain("40.0% (4/10)");
    expect(message).toContain("2 số cuối: 70.0% (7/10)");
    expect(message).toContain("🟨 Miền Trung");
    expect(message).toContain("0.0% (0/0)");
    expect(message).not.toContain("NaN");
  });

  test("formatHitRateReport returns clear fallback when no stats", () => {
    const message = reportModule.formatHitRateReport([], 30);

    expect(message).toContain("Chưa đủ dữ liệu verify");
    expect(message).toContain("30 ngày");
  });
});
