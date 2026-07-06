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
});