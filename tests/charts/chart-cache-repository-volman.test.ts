import { beforeEach, describe, expect, test, vi } from "vitest";

const repoState = vi.hoisted(() => ({
  selectResult: { data: null, error: null },
  upsertResult: { error: null },
  select: vi.fn(),
  eq: vi.fn(),
  ilike: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  from: vi.fn(),
}));

const loggerState = vi.hoisted(() => ({
  warn: vi.fn<(msg: string, ctx?: Record<string, unknown>) => void>(),
}));

vi.mock("../../src/shared/db.js", () => ({
  getDb: () => ({
    from: repoState.from,
  }),
}));

vi.mock("../../src/shared/logger.js", () => ({
  createLogger: () => loggerState,
}));

const chartCacheRepository = await import("../../src/charts/chart-cache-repository-volman.js");

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
      emaTouch: true,
      reasons: ["EMA20 dốc lên"],
      risks: ["Khối lượng yếu"],
      confidence: 75,
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1080",
      takeProfit2: "1.1120",
      riskReward: "1:2",
      summary: "Setup long",
      chartContext: {
        candles: [],
        ema20: [],
        triggerIndex: 0,
        sliceStartIndex: 0,
      },
    },
  ],
  noSetupReason: "",
  analysisStats: {
    attemptedPairs: 8,
    okPairs: 2,
    noSetupPairs: 1,
    skippedPairs: 5,
    setupCount: 1,
  },
};

describe("charts/chart-cache-repository-volman", () => {
  beforeEach(() => {
    repoState.from.mockReset();
    repoState.select.mockReset();
    repoState.eq.mockReset();
    repoState.ilike.mockReset();
    repoState.order.mockReset();
    repoState.limit.mockReset();
    repoState.maybeSingle.mockReset();
    repoState.upsert.mockReset();

    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      ilike: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => repoState.selectResult),
      upsert: vi.fn(async () => repoState.upsertResult),
    };

    repoState.from.mockReturnValue(chain);
    loggerState.warn.mockReset();
  });

  describe("saveChartAnalysisCache", () => {
    test("upsert lỗi — không throw (fail silent)", async () => {
      repoState.upsertResult = { error: { message: "DB error" } };

      // Không throw
      await expect(
        chartCacheRepository.saveChartAnalysisCache(CANDLE_KEY, MOCK_RESULT),
      ).resolves.toBeUndefined();
    });
  });

  describe("loadChartAnalysisCache", () => {
    test("trả về AnalysisResult khi có data hợp lệ", async () => {
      repoState.selectResult = {
        data: {
          result: {
            summaries: MOCK_RESULT.summaries,
            setups: MOCK_RESULT.setups,
            noSetupReason: MOCK_RESULT.noSetupReason,
            analysisStats: MOCK_RESULT.analysisStats,
          },
        },
        error: null,
      };

      const result = await chartCacheRepository.loadChartAnalysisCache(CANDLE_KEY);

      expect(result).not.toBeNull();
      expect(result!.summaries).toEqual(MOCK_RESULT.summaries);
      expect(result!.setups).toEqual(MOCK_RESULT.setups);
      expect(result!.noSetupReason).toBe(MOCK_RESULT.noSetupReason);
      expect(result!.analysisStats).toEqual(MOCK_RESULT.analysisStats);
    });

    test("không có row — trả null", async () => {
      repoState.selectResult = { data: null, error: null };

      const result = await chartCacheRepository.loadChartAnalysisCache(CANDLE_KEY);
      expect(result).toBeNull();
    });
  });

  describe("loadLatestChartAnalysisCache", () => {
    test("trả candle_key mới nhất theo engine mode", async () => {
      repoState.selectResult = {
        data: {
          candle_key: "2026-07-03T08:deterministic",
          result: {
            summaries: MOCK_RESULT.summaries,
            setups: MOCK_RESULT.setups,
            noSetupReason: MOCK_RESULT.noSetupReason,
            analysisStats: MOCK_RESULT.analysisStats,
          },
          created_at: "2026-07-03T08:05:00.000Z",
        },
        error: null,
      };

      const result = await chartCacheRepository.loadLatestChartAnalysisCache("deterministic");

      expect(result).not.toBeNull();
      expect(result?.candleKey).toBe("2026-07-03T08:deterministic");
      expect(repoState.from).toHaveBeenCalledWith("analysis_cache_volman");
      expect(repoState.from().ilike).toHaveBeenCalledWith("candle_key", "%:deterministic:multi");
      expect(repoState.from().order).toHaveBeenCalledWith("created_at", { ascending: false });
      expect(repoState.from().limit).toHaveBeenCalledWith(1);
    });
  });

  describe("isValidAnalysisResult", () => {
    const validSetup = {
      pair: "EUR/USD",
      direction: "LONG" as const,
      setup: "RB",
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1080",
      takeProfit2: "1.1120",
      confidence: 75,
      reasons: ["EMA20 dốc lên"],
      risks: ["Khối lượng yếu"],
      riskReward: "1:2",
      summary: "Setup long",
      chartContext: {
        candles: [],
        ema20: [],
        triggerIndex: 0,
        sliceStartIndex: 0,
      },
    };

    const validResult = {
      summaries: [{ pair: "EUR/USD", trend: "LONG", status: "tích lũy", confidence: 80 }],
      setups: [validSetup],
      noSetupReason: "",
    };

    test("valid analysis result → true", () => {
      expect(chartCacheRepository.isValidAnalysisResult(validResult)).toBe(true);
    });

    test("null → false", () => {
      expect(chartCacheRepository.isValidAnalysisResult(null)).toBe(false);
    });

    test("non-object → false", () => {
      expect(chartCacheRepository.isValidAnalysisResult("string")).toBe(false);
    });

    test("thiếu summaries → false", () => {
      const { summaries, ...rest } = validResult;
      expect(chartCacheRepository.isValidAnalysisResult(rest)).toBe(false);
    });

    test("setups không phải array → false", () => {
      expect(chartCacheRepository.isValidAnalysisResult({ ...validResult, setups: "not-array" })).toBe(false);
    });

    test("setup thiếu field bắt buộc → false", () => {
      expect(chartCacheRepository.isValidAnalysisResult({
        ...validResult,
        setups: [{ pair: "EUR/USD", direction: "LONG" }], // thiếu hầu hết field
      })).toBe(false);
    });

    test("setup thiếu chartContext (cache từ trước khi có tính năng chart-photo) → false", () => {
      // Regression: một cached row ghi trước khi TradeSetup.chartContext tồn tại có đủ mọi
      // field bắt buộc khác nhưng thiếu chartContext — phải bị coi là invalid/stale, không thì
      // sendAllAnalysesVolman sẽ gửi text signal mà không có ảnh chart kèm theo (bug đã gặp).
      const { chartContext, ...setupWithoutChartContext } = validSetup;
      expect(chartCacheRepository.isValidAnalysisResult({
        ...validResult,
        setups: [setupWithoutChartContext],
      })).toBe(false);
    });
  });
});
