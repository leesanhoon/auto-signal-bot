import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";

// ---------------------------------------------------------------------------
// chart-config-env
// ---------------------------------------------------------------------------

describe("getConfiguredChartEngineMode", () => {
  beforeEach(() => {
    delete process.env.CHART_ENGINE_MODE;
  });

  test("defaults to shadow when env is not set", async () => {
    const mod = await import("../../src/charts/chart-config-env.js");
    expect(mod.getConfiguredChartEngineMode()).toBe("shadow");
  });

  test("returns ai when env is set to ai", async () => {
    process.env.CHART_ENGINE_MODE = "ai";
    const mod = await import("../../src/charts/chart-config-env.js");
    expect(mod.getConfiguredChartEngineMode()).toBe("ai");
  });

  test("returns deterministic when env is set to deterministic", async () => {
    process.env.CHART_ENGINE_MODE = "deterministic";
    const mod = await import("../../src/charts/chart-config-env.js");
    expect(mod.getConfiguredChartEngineMode()).toBe("deterministic");
  });

  test("returns shadow when env is set to shadow", async () => {
    process.env.CHART_ENGINE_MODE = "shadow";
    const mod = await import("../../src/charts/chart-config-env.js");
    expect(mod.getConfiguredChartEngineMode()).toBe("shadow");
  });

  test("returns shadow for invalid values", async () => {
    process.env.CHART_ENGINE_MODE = "invalid";
    const mod = await import("../../src/charts/chart-config-env.js");
    expect(mod.getConfiguredChartEngineMode()).toBe("shadow");
  });
});

// ---------------------------------------------------------------------------
// deterministic-pipeline
// ---------------------------------------------------------------------------

describe("analyzeAllChartsDeterministic", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("D1 uses ATR floor but skips intraday session gate", async () => {
    const mod = await import("../../src/charts/deterministic-pipeline.js");
    const ok = mod.passesDeterministicWindowFilter("D1", Date.UTC(2024, 0, 1, 0, 0, 0), 0.0015, 0.005);
    const low = mod.passesDeterministicWindowFilter("D1", Date.UTC(2024, 0, 1, 0, 0, 0), 0.001, 0.005);

    expect(ok).toBe(true);
    expect(low).toBe(false);
  });

  test("returns AnalysisResult shape even with no pairs", async () => {
    const mod = await import("../../src/charts/deterministic-pipeline.js");
    const result = await mod.analyzeAllChartsDeterministic([]);
    expect(result).toHaveProperty("summaries");
    expect(result).toHaveProperty("setups");
    expect(result).toHaveProperty("noSetupReason");
    expect(result).toHaveProperty("screenshots");
    expect(result.summaries).toEqual([]);
    expect(result.setups).toEqual([]);
    expect(result.screenshots).toEqual([]);
  });

  test("handles OHLC fetch error gracefully (skips pair)", async () => {
    // Mock fetchOhlcHistory to return Error
    const ohlcMod = await import("../../src/charts/ohlc-provider.js");
    vi.spyOn(ohlcMod, "fetchOhlcHistory").mockResolvedValue(
      new Error("API error"),
    );

    const detMod = await import("../../src/charts/deterministic-pipeline.js");
    const result = await detMod.analyzeAllChartsDeterministic([
      { pair: "EUR/USD", symbol: "OANDA:EURUSD" },
    ]);
    expect(result.summaries).toHaveLength(0);
    expect(result.setups).toHaveLength(0);
    expect(result.noSetupReason).toContain("EUR/USD");
    expect(result.noSetupReason).toContain("API error");
  });

  test("processes a pair and returns summaries + setups", async () => {
    // Create candle fixture with enough data
    const candles: Candle[] = [];
    // Use timestamps within London/NY overlap (13-21 UTC): hour 14
    // Spread all candles within a few hours, not 200 hours
    for (let i = 0; i < 200; i++) {
      const base = 100 + i * 0.1;
      candles.push({
        time: Date.UTC(2024, 0, 1, 14, 0, 0) + i * 60000, // 1 minute apart, all at hour 14
        open: base,
        high: base + 0.5,
        low: base - 0.3,
        close: base + 0.1,
        volume: 100,
      });
    }

    // Mock fetchOhlcHistory to return our fixture
    const ohlcMod = await import("../../src/charts/ohlc-provider.js");
    vi.spyOn(ohlcMod, "fetchOhlcHistory").mockResolvedValue(candles);

    const detMod = await import("../../src/charts/deterministic-pipeline.js");
    const result = await detMod.analyzeAllChartsDeterministic([
      { pair: "EUR/USD", symbol: "OANDA:EURUSD" },
    ]);

    expect(result.summaries.length).toBeGreaterThanOrEqual(1);
    expect(result.summaries[0].pair).toBe("EUR/USD");
    // Should have at least a PairSummary (may or may not have setups)
    expect(typeof result.summaries[0].confidence).toBe("number");
  });

  test("single timeframe mode fetches the configured primary timeframe", async () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 200; i++) {
      const base = 100 + i * 0.1;
      candles.push({
        time: Date.UTC(2024, 0, 1, 0, 0, 0) + i * 60000,
        open: base,
        high: base + 0.5,
        low: base - 0.3,
        close: base + 0.1,
        volume: 100,
      });
    }

    const ohlcMod = await import("../../src/charts/ohlc-provider.js");
    const fetchSpy = vi.spyOn(ohlcMod, "fetchOhlcHistory").mockResolvedValue(candles);

    const detMod = await import("../../src/charts/deterministic-pipeline.js");
    await detMod.analyzeAllChartsDeterministic(
      [{ pair: "EUR/USD", symbol: "OANDA:EURUSD" }],
      { timeframeMode: "single", primaryTimeframe: "D1" },
    );

    expect(fetchSpy).toHaveBeenCalledWith("OANDA:EURUSD", "D1", 200);
  });

  test("single D1 with valid ATR still processes outside intraday hours", async () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 180; i++) {
      const base = 100 + i * 0.2;
      candles.push({
        time: Date.UTC(2024, 0, 1, 0, 0, 0) + i * 86400000,
        open: base,
        high: base + 2,
        low: base - 2,
        close: base + 0.5,
        volume: 100,
      });
    }
    for (let i = 180; i < 200; i++) {
      const base = 136 + i * 0.01;
      candles.push({
        time: Date.UTC(2024, 0, 1, 0, 0, 0) + i * 86400000,
        open: base,
        high: base + 2,
        low: base - 2,
        close: base + 0.5,
        volume: 100,
      });
    }

    const ohlcMod = await import("../../src/charts/ohlc-provider.js");
    const fetchSpy = vi.spyOn(ohlcMod, "fetchOhlcHistory").mockResolvedValue(candles);

    const detMod = await import("../../src/charts/deterministic-pipeline.js");
    const result = await detMod.analyzeAllChartsDeterministic(
      [{ pair: "EUR/USD", symbol: "OANDA:EURUSD" }],
      { timeframeMode: "single", primaryTimeframe: "D1" },
    );

    expect(fetchSpy).toHaveBeenCalledWith("OANDA:EURUSD", "D1", 200);
    expect(result.noSetupReason).not.toContain("ngoai khung giao dich hop le");
  });

  test("single D1 skips when ATR is below floor", async () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 180; i++) {
      const base = 100 + i * 0.2;
      candles.push({
        time: Date.UTC(2024, 0, 1, 0, 0, 0) + i * 86400000,
        open: base,
        high: base + 2,
        low: base - 2,
        close: base + 0.5,
        volume: 100,
      });
    }
    for (let i = 180; i < 200; i++) {
      const base = 136 + i * 0.01;
      candles.push({
        time: Date.UTC(2024, 0, 1, 0, 0, 0) + i * 86400000,
        open: base,
        high: base + 0.05,
        low: base - 0.05,
        close: base + 0.01,
        volume: 100,
      });
    }

    const ohlcMod = await import("../../src/charts/ohlc-provider.js");
    vi.spyOn(ohlcMod, "fetchOhlcHistory").mockResolvedValue(candles);

    const detMod = await import("../../src/charts/deterministic-pipeline.js");
    const result = await detMod.analyzeAllChartsDeterministic(
      [{ pair: "EUR/USD", symbol: "OANDA:EURUSD" }],
      { timeframeMode: "single", primaryTimeframe: "D1" },
    );

    expect(result.summaries).toHaveLength(0);
    expect(result.setups).toHaveLength(0);
    expect(result.noSetupReason).toContain("EUR/USD");
  });

  test("multi timeframe mode keeps the legacy H4 fetch", async () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 200; i++) {
      const base = 100 + i * 0.1;
      candles.push({
        time: Date.UTC(2024, 0, 1, 14, 0, 0) + i * 60000,
        open: base,
        high: base + 0.5,
        low: base - 0.3,
        close: base + 0.1,
        volume: 100,
      });
    }

    const ohlcMod = await import("../../src/charts/ohlc-provider.js");
    const fetchSpy = vi.spyOn(ohlcMod, "fetchOhlcHistory").mockResolvedValue(candles);

    const detMod = await import("../../src/charts/deterministic-pipeline.js");
    await detMod.analyzeAllChartsDeterministic(
      [{ pair: "EUR/USD", symbol: "OANDA:EURUSD" }],
      { timeframeMode: "multi", primaryTimeframe: "D1" },
    );

    expect(fetchSpy).toHaveBeenCalledWith("OANDA:EURUSD", "H4", 200);
  });
});
