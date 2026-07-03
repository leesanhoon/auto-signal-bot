import { afterEach, describe, expect, test } from "vitest";
import {
  getConfiguredChartSignalConfidenceThreshold,
} from "../../src/charts/chart-config-env.js";

describe("charts/chart-config-env", () => {
  afterEach(() => {
    delete process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD;
  });

  test("keeps chart confidence threshold parsing unchanged", () => {
    delete process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD;
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);

    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "73";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(73);
  });
});
