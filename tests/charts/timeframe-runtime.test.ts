import { describe, expect, test } from "vitest";
import { getChartsForTimeframeMode } from "../../src/charts/charts.config.js";
import { buildChartAnalysisCacheKey } from "../../src/charts/analyzer.js";

describe("charts timeframe runtime", () => {
  test("multi timeframe keeps the full chart set", () => {
    const charts = getChartsForTimeframeMode("multi", "M15");
    expect(charts.map((chart) => chart.timeframe)).toEqual(
      expect.arrayContaining(["D1", "H4", "M15"]),
    );
  });

  test("single timeframe keeps only the selected timeframe", () => {
    const charts = getChartsForTimeframeMode("single", "M15");
    expect(charts).toHaveLength(8);
    expect(new Set(charts.map((chart) => chart.timeframe))).toEqual(new Set(["M15"]));
  });

  test("cache key distinguishes multi and single runtime modes", () => {
    expect(buildChartAnalysisCacheKey("2026-07-03T12", "shadow", "multi")).toBe(
      "2026-07-03T12:shadow:multi",
    );
    expect(
      buildChartAnalysisCacheKey("2026-07-03T12", "shadow", "single", "M15"),
    ).toBe("2026-07-03T12:shadow:single:M15");
    expect(
      buildChartAnalysisCacheKey("2026-07-03T12", "shadow", "single", "H4"),
    ).toBe("2026-07-03T12:shadow:single:H4");
  });
});
