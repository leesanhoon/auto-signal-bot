import { beforeEach, describe, expect, test } from "vitest";
import { getConfiguredSmcMinRiskPct } from "../../src/charts/smc-config-env.js";

describe("getConfiguredSmcMinRiskPct", () => {
  beforeEach(() => {
    delete process.env.SMC_MIN_RISK_PCT;
  });

  test("returns 0.5 when env var not set", () => {
    const result = getConfiguredSmcMinRiskPct();
    expect(result).toBe(0.5);
  });

  test("returns 0.3 when SMC_MIN_RISK_PCT='0.3'", () => {
    process.env.SMC_MIN_RISK_PCT = "0.3";
    const result = getConfiguredSmcMinRiskPct();
    expect(result).toBe(0.3);
  });

  test("returns 0 when SMC_MIN_RISK_PCT='0' (filter disabled)", () => {
    process.env.SMC_MIN_RISK_PCT = "0";
    const result = getConfiguredSmcMinRiskPct();
    expect(result).toBe(0);
  });

  test("returns 0.5 when SMC_MIN_RISK_PCT='abc' (invalid)", () => {
    process.env.SMC_MIN_RISK_PCT = "abc";
    const result = getConfiguredSmcMinRiskPct();
    expect(result).toBe(0.5);
  });

  test("returns 0.5 when SMC_MIN_RISK_PCT='-1' (negative)", () => {
    process.env.SMC_MIN_RISK_PCT = "-1";
    const result = getConfiguredSmcMinRiskPct();
    expect(result).toBe(0.5);
  });

  test("returns 0.5 when SMC_MIN_RISK_PCT='10' (out of range)", () => {
    process.env.SMC_MIN_RISK_PCT = "10";
    const result = getConfiguredSmcMinRiskPct();
    expect(result).toBe(0.5);
  });
});
