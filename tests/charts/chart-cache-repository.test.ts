import { beforeEach, describe, expect, test, vi } from "vitest";

const repoState = vi.hoisted(() => ({
  selectResult: { data: null, error: null },
  upsertResult: { error: null },
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../src/shared/db.js", () => ({
  getDb: () => ({
    from: repoState.from,
  }),
}));

const chartCacheRepository = await import("../../src/charts/chart-cache-repository.js");

const CANDLE_KEY = "2026-07-03T12";

const MOCK_RESULT = {
  summaries: [
    { pair: "EUR/USD", trend: "LONG", status: "tích lũy", confidence: 80 },
  ],
  setups: [
    {
      pair: "EUR/USD",
      direction: "LONG" as const,
      setup: "RB",
      reasons: ["EMA20 dốc lên"],
      risks: ["Khối lượng yếu"],
      confidence: 75,
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1080",
      takeProfit2: "1.1120",
      riskReward: "1:2",
      summary: "Setup long",
    },
  ],
  noSetupReason: "",
  screenshots: [
    {
      chart: { name: "EURUSD H4", symbol: "EURUSD", interval: "H4", description: "H4", timeframe: "H4" as const },
      buffer: Buffer.from("fake-image-bytes"),
      filepath: "/charts/eurusd-h4.png",
      lastPrice: 1.1005,
    },
  ],
};

describe("charts/chart-cache-repository", () => {
  beforeEach(() => {
    repoState.from.mockReset();
    repoState.select.mockReset();
    repoState.eq.mockReset();
    repoState.maybeSingle.mockReset();
    repoState.upsert.mockReset();

    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => repoState.selectResult),
      upsert: vi.fn(async () => repoState.upsertResult),
    };

    repoState.from.mockReturnValue(chain);
  });

  describe("saveChartAnalysisCache", () => {
    test("upsert với candle_key và result đã loại bỏ buffer khỏi screenshots", async () => {
      repoState.upsertResult = { error: null };

      await chartCacheRepository.saveChartAnalysisCache(CANDLE_KEY, MOCK_RESULT);

      expect(repoState.from).toHaveBeenCalledWith("chart_analysis_cache");
      expect(repoState.from().upsert).toHaveBeenCalledTimes(1);

      const upsertArg = (repoState.from().upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(upsertArg.candle_key).toBe(CANDLE_KEY);
      expect(upsertArg.result.summaries).toEqual(MOCK_RESULT.summaries);
      expect(upsertArg.result.setups).toEqual(MOCK_RESULT.setups);
      expect(upsertArg.result.noSetupReason).toBe(MOCK_RESULT.noSetupReason);

      // Buffer bị loại bỏ — chỉ giữ chart, filepath, lastPrice
      expect(upsertArg.result.screenshots).toHaveLength(1);
      expect(upsertArg.result.screenshots[0]).toEqual({
        chart: MOCK_RESULT.screenshots[0].chart,
        filepath: MOCK_RESULT.screenshots[0].filepath,
        lastPrice: MOCK_RESULT.screenshots[0].lastPrice,
      });
      // Buffer không được lưu
      expect(upsertArg.result.screenshots[0]).not.toHaveProperty("buffer");

      expect(upsertArg.candle_key).toBe(CANDLE_KEY);
    });

    test("upsert lỗi — không throw (fail silent)", async () => {
      repoState.upsertResult = { error: { message: "DB error" } };

      // Không throw
      await expect(
        chartCacheRepository.saveChartAnalysisCache(CANDLE_KEY, MOCK_RESULT),
      ).resolves.toBeUndefined();
    });

    test("chain throw — không throw (fail silent)", async () => {
      repoState.from.mockImplementation(() => {
        throw new Error("Network error");
      });

      await expect(
        chartCacheRepository.saveChartAnalysisCache(CANDLE_KEY, MOCK_RESULT),
      ).resolves.toBeUndefined();
    });
  });

  describe("loadChartAnalysisCache", () => {
    test("trả về AnalysisResult khi có data hợp lệ — screenshots luôn rỗng", async () => {
      repoState.selectResult = {
        data: {
          result: {
            summaries: MOCK_RESULT.summaries,
            setups: MOCK_RESULT.setups,
            noSetupReason: MOCK_RESULT.noSetupReason,
            screenshots: [
              {
                chart: MOCK_RESULT.screenshots[0].chart,
                filepath: MOCK_RESULT.screenshots[0].filepath,
                lastPrice: MOCK_RESULT.screenshots[0].lastPrice,
              },
            ],
          },
        },
        error: null,
      };

      const result = await chartCacheRepository.loadChartAnalysisCache(CANDLE_KEY);

      expect(result).not.toBeNull();
      expect(result!.summaries).toEqual(MOCK_RESULT.summaries);
      expect(result!.setups).toEqual(MOCK_RESULT.setups);
      expect(result!.noSetupReason).toBe(MOCK_RESULT.noSetupReason);
      // screenshots luôn rỗng
      expect(result!.screenshots).toEqual([]);
    });

    test("không có row — trả null", async () => {
      repoState.selectResult = { data: null, error: null };

      const result = await chartCacheRepository.loadChartAnalysisCache(CANDLE_KEY);
      expect(result).toBeNull();
    });

    test("data.result null — trả null", async () => {
      repoState.selectResult = { data: { result: null }, error: null };

      const result = await chartCacheRepository.loadChartAnalysisCache(CANDLE_KEY);
      expect(result).toBeNull();
    });

    test("query trả error — trả null", async () => {
      repoState.selectResult = { data: null, error: { message: "DB error" } };

      const result = await chartCacheRepository.loadChartAnalysisCache(CANDLE_KEY);
      expect(result).toBeNull();
    });

    test("chain throw — trả null, không throw", async () => {
      repoState.from.mockImplementation(() => {
        throw new Error("Network error");
      });

      const result = await chartCacheRepository.loadChartAnalysisCache(CANDLE_KEY);
      expect(result).toBeNull();
    });
  });
});
