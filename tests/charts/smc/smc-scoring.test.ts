import { describe, expect, it } from "vitest";
import { computeSetupScore } from "../../../src/charts/smc/smc-scoring.js";
import { gradeFromScore } from "../../../src/charts/smc/smc-signal-assembly.js";

describe("computeSetupScore", () => {
  it("BOS hoàn hảo (đúng P/D, overlap session, RVOL cao, wick, HTF thuận) đạt grade A", () => {
    const score = computeSetupScore({
      setup: "SMC_BOS_OB",
      premiumDiscount: "CORRECT",
      session: "LONDON_NY_OVERLAP",
      rvol: 1.8,
      hasRejectionWick: true,
      htfBiasAligned: true,
    });
    expect(score).toBe(100);
    expect(gradeFromScore(score)).toBe("A");
  });

  it("CHOCH hoàn hảo cũng có thể đạt grade A (khác cơ chế cũ)", () => {
    const score = computeSetupScore({
      setup: "SMC_CHOCH_OB",
      premiumDiscount: "CORRECT",
      session: "LONDON_NY_OVERLAP",
      rvol: 1.6,
      hasRejectionWick: true,
      htfBiasAligned: true,
    });
    expect(score).toBe(98);
    expect(gradeFromScore(score)).toBe("A");
  });

  it("setup yếu (FVG, sai P/D, off-hours, không xác nhận) rơi xuống C/D", () => {
    const score = computeSetupScore({
      setup: "SMC_FVG_CONTINUATION",
      premiumDiscount: "WRONG",
      session: "OFF_HOURS",
      rvol: 0.5,
      hasRejectionWick: false,
      htfBiasAligned: false,
    });
    expect(score).toBe(38);
    expect(gradeFromScore(score)).toBe("C");
  });

  it("P/D không xác định được cho điểm trung tính (+5)", () => {
    const unknown = computeSetupScore({
      setup: "SMC_BOS_OB",
      premiumDiscount: "UNKNOWN",
      session: "LONDON",
      rvol: null,
      hasRejectionWick: false,
      htfBiasAligned: false,
    });
    const correct = computeSetupScore({
      setup: "SMC_BOS_OB",
      premiumDiscount: "CORRECT",
      session: "LONDON",
      rvol: null,
      hasRejectionWick: false,
      htfBiasAligned: false,
    });
    expect(correct - unknown).toBe(10);
  });

  it("RVOL null hoặc không hữu hạn không cộng điểm", () => {
    const base = computeSetupScore({
      setup: "SMC_CHOCH_OB",
      premiumDiscount: "UNKNOWN",
      session: "ASIA",
      rvol: null,
      hasRejectionWick: false,
      htfBiasAligned: false,
    });
    const nan = computeSetupScore({
      setup: "SMC_CHOCH_OB",
      premiumDiscount: "UNKNOWN",
      session: "ASIA",
      rvol: Number.NaN,
      hasRejectionWick: false,
      htfBiasAligned: false,
    });
    expect(nan).toBe(base);
  });

  it("score bị clamp trong [0, 100]", () => {
    const max = computeSetupScore({
      setup: "SMC_BOS_OB",
      premiumDiscount: "CORRECT",
      session: "LONDON_NY_OVERLAP",
      rvol: 2,
      hasRejectionWick: true,
      htfBiasAligned: true,
    });
    expect(max).toBeLessThanOrEqual(100);
    expect(max).toBeGreaterThanOrEqual(0);
  });
});
