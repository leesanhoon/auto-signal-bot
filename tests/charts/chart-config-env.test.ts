import { afterEach, describe, expect, test } from "vitest";
import {
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredPendingOrderExpiryRuns,
} from "../../src/charts/chart-config-env.js";

describe("charts/chart-config-env", () => {
  afterEach(() => {
    delete process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD;
    delete process.env.PENDING_ORDER_EXPIRY_RUNS;
  });

  test("keeps chart confidence threshold parsing unchanged", () => {
    delete process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD;
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);

    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "73";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(73);
  });

  test("chart confidence threshold: out-of-range value falls back to 70", () => {
    // > 100
    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "150";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);

    // < 0
    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "-5";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);
  });

  test("chart confidence threshold: non-numeric value falls back to 70", () => {
    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "abc";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);
  });

  describe("getConfiguredPendingOrderExpiryRuns", () => {
    test("defaults to 2 when env is not set", () => {
      delete process.env.PENDING_ORDER_EXPIRY_RUNS;
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(2);
    });

    test("parses valid integer from env", () => {
      process.env.PENDING_ORDER_EXPIRY_RUNS = "5";
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(5);
    });

    test("non-integer value falls back to 2", () => {
      // Float should not be treated as integer
      process.env.PENDING_ORDER_EXPIRY_RUNS = "2.5";
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(2);
    });

    test("value below 1 falls back to 2", () => {
      process.env.PENDING_ORDER_EXPIRY_RUNS = "0";
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(2);

      process.env.PENDING_ORDER_EXPIRY_RUNS = "-1";
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(2);
    });
  });
});