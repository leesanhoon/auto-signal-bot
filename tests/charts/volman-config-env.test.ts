import { describe, expect, test, beforeEach } from "vitest";
import { getConfiguredSignalMaxEntryDistancePercent } from "../../src/charts/volman-config-env.js";

describe("getConfiguredSignalMaxEntryDistancePercent", () => {
  beforeEach(() => {
    delete process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT;
  });

  test("defaults to 50 when unset", () => {
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(50);
  });

  test("reads a valid override from env", () => {
    process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT = "30";
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(30);
  });

  test("falls back to 50 for a non-numeric value", () => {
    process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT = "abc";
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(50);
  });

  test("falls back to 50 for an out-of-range value (>100)", () => {
    process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT = "150";
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(50);
  });

  test("falls back to 50 for zero or negative values", () => {
    process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT = "0";
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(50);
  });
});
