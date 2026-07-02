import { afterEach, describe, expect, test } from "vitest";
import {
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredChartVerifyEnabled,
} from "../../src/charts/chart-config-env.js";

describe("charts/chart-config-env", () => {
  afterEach(() => {
    delete process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD;
    delete process.env.CHART_AI_VERIFY_ENABLED;
  });

  test("parses chart verify toggle as true when explicitly set", () => {
    process.env.CHART_AI_VERIFY_ENABLED = "true";
    expect(getConfiguredChartVerifyEnabled()).toBe(true);
  });

  test("parses chart verify toggle defaults and falsey values", () => {
    delete process.env.CHART_AI_VERIFY_ENABLED;
    expect(getConfiguredChartVerifyEnabled()).toBe(false);

    process.env.CHART_AI_VERIFY_ENABLED = "false";
    expect(getConfiguredChartVerifyEnabled()).toBe(false);

    process.env.CHART_AI_VERIFY_ENABLED = "0";
    expect(getConfiguredChartVerifyEnabled()).toBe(false);

    process.env.CHART_AI_VERIFY_ENABLED = "no";
    expect(getConfiguredChartVerifyEnabled()).toBe(false);

    process.env.CHART_AI_VERIFY_ENABLED = "off";
    expect(getConfiguredChartVerifyEnabled()).toBe(false);
  });

  test("keeps chart confidence threshold parsing unchanged", () => {
    delete process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD;
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);

    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "73";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(73);
  });
});
