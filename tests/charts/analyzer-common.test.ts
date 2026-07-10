import { describe, expect, test } from "vitest";
import {
  buildChartAnalysisCacheKey,
  clampConfidence,
  cleanResponse,
  extractJsonObject,
} from "../../src/charts/analyzer-common.js";

describe("charts/analyzer-common utilities", () => {
  test("buildChartAnalysisCacheKey preserves timeframe-specific cache keys", () => {
    expect(buildChartAnalysisCacheKey("2026-07-03T12", "deterministic", "multi")).toBe(
      "2026-07-03T12:deterministic:multi",
    );
    expect(buildChartAnalysisCacheKey("2026-07-03T12", "deterministic", "single", "M15")).toBe(
      "2026-07-03T12:deterministic:single:M15",
    );
  });

  test("buildChartAnalysisCacheKey handles default timeframe in single mode", () => {
    expect(buildChartAnalysisCacheKey("key", "ai", "single")).toBe("key:ai:single:M15");
  });

  test("cleanResponse strips code fences from wrapped JSON", () => {
    expect(cleanResponse("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(cleanResponse("```\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(cleanResponse("  ```json  {\"a\":1}  ```  ")).toBe('{"a":1}');
  });

  test("extractJsonObject finds JSON in text", () => {
    expect(extractJsonObject("prefix {\"a\":1} suffix")).toBe('{"a":1}');
    expect(extractJsonObject("{\"a\":1}")).toBe('{"a":1}');
    expect(extractJsonObject("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  test("extractJsonObject returns original if no JSON found", () => {
    expect(extractJsonObject("no json here")).toBe("no json here");
  });

  test("clampConfidence bounds values to 0-100", () => {
    expect(clampConfidence(101)).toBe(100);
    expect(clampConfidence(-5)).toBe(0);
    expect(clampConfidence(50)).toBe(50);
    expect(clampConfidence("55")).toBe(55);
    expect(clampConfidence("150")).toBe(100);
  });

  test("clampConfidence handles invalid input", () => {
    expect(clampConfidence(null)).toBe(0);
    expect(clampConfidence(undefined)).toBe(0);
    expect(clampConfidence("invalid")).toBe(0);
  });

  test("clampConfidence rounds to nearest integer", () => {
    expect(clampConfidence(50.7)).toBe(51);
    expect(clampConfidence(50.4)).toBe(50);
  });
});
