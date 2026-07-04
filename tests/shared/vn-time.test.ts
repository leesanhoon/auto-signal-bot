import { describe, it, expect } from "vitest";
import { vnDateStr, vnTimeStr, vnDateOffsetStr } from "../../src/shared/vn-time.js";

describe("vn-time.ts", () => {
  describe("vnDateStr", () => {
    it("should convert UTC timestamp to VN date string (YYYY-MM-DD)", () => {
      // 2026-07-04T12:00:00Z = 2026-07-04T19:00:00 VN (UTC+7)
      const timestamp = new Date("2026-07-04T12:00:00Z").getTime();
      const result = vnDateStr(timestamp);
      expect(result).toBe("2026-07-04");
    });

    it("should handle midnight UTC boundary for VN (17:00 UTC = 00:00 VN next day)", () => {
      // 17:00 UTC on 2026-07-04 = 00:00 VN on 2026-07-05
      const timestamp = new Date("2026-07-04T17:00:00Z").getTime();
      const result = vnDateStr(timestamp);
      expect(result).toBe("2026-07-05");
    });

    it("should handle morning UTC for VN (10:00 UTC = 17:00 VN same day)", () => {
      // 10:00 UTC = 17:00 VN (same day)
      const timestamp = new Date("2026-07-04T10:00:00Z").getTime();
      const result = vnDateStr(timestamp);
      expect(result).toBe("2026-07-04");
    });

    it("should handle year and month boundaries", () => {
      // 2025-12-31T17:00:00Z = 2026-01-01T00:00:00 VN
      const timestamp = new Date("2025-12-31T17:00:00Z").getTime();
      const result = vnDateStr(timestamp);
      expect(result).toBe("2026-01-01");
    });
  });

  describe("vnTimeStr", () => {
    it("should convert UTC timestamp to VN time string (HH:mm)", () => {
      // 2026-07-04T12:00:00Z = 2026-07-04T19:00:00 VN
      const timestamp = new Date("2026-07-04T12:00:00Z").getTime();
      const result = vnTimeStr(timestamp);
      expect(result).toBe("19:00");
    });

    it("should handle hour 24 edge case (midnight boundary)", () => {
      // 2026-07-04T17:00:00Z = 2026-07-05T00:00:00 VN (00 hour)
      const timestamp = new Date("2026-07-04T17:00:00Z").getTime();
      const result = vnTimeStr(timestamp);
      expect(result).toBe("00:00");
    });

    it("should handle afternoon time correctly", () => {
      // 2026-07-04T08:30:00Z = 2026-07-04T15:30:00 VN
      const timestamp = new Date("2026-07-04T08:30:00Z").getTime();
      const result = vnTimeStr(timestamp);
      expect(result).toBe("15:30");
    });

    it("should handle morning time correctly", () => {
      // 2026-07-04T02:00:00Z = 2026-07-04T09:00:00 VN
      const timestamp = new Date("2026-07-04T02:00:00Z").getTime();
      const result = vnTimeStr(timestamp);
      expect(result).toBe("09:00");
    });
  });

  describe("vnDateOffsetStr", () => {
    it("should return today's date with offset 0", () => {
      const baseTime = new Date("2026-07-04T12:00:00Z").getTime();
      const result = vnDateOffsetStr(0, baseTime);
      expect(result).toBe("2026-07-04");
    });

    it("should return tomorrow's date with offset +1", () => {
      const baseTime = new Date("2026-07-04T12:00:00Z").getTime();
      const result = vnDateOffsetStr(1, baseTime);
      expect(result).toBe("2026-07-05");
    });

    it("should return yesterday's date with offset -1", () => {
      const baseTime = new Date("2026-07-04T12:00:00Z").getTime();
      const result = vnDateOffsetStr(-1, baseTime);
      expect(result).toBe("2026-07-03");
    });

    it("should handle month boundary (end of month + 1)", () => {
      // 2026-07-31T12:00:00Z + 1 day = 2026-08-01
      const baseTime = new Date("2026-07-31T12:00:00Z").getTime();
      const result = vnDateOffsetStr(1, baseTime);
      expect(result).toBe("2026-08-01");
    });

    it("should handle year boundary (2025-12-31 + 1 = 2026-01-01)", () => {
      // 2025-12-31T12:00:00Z + 1 day = 2026-01-01
      const baseTime = new Date("2025-12-31T12:00:00Z").getTime();
      const result = vnDateOffsetStr(1, baseTime);
      expect(result).toBe("2026-01-01");
    });

    it("should handle year boundary (2026-01-01 - 1 = 2025-12-31)", () => {
      // 2026-01-01T12:00:00Z - 1 day = 2025-12-31
      const baseTime = new Date("2026-01-01T12:00:00Z").getTime();
      const result = vnDateOffsetStr(-1, baseTime);
      expect(result).toBe("2025-12-31");
    });

    it("should handle large offset (+30 days)", () => {
      const baseTime = new Date("2026-07-04T12:00:00Z").getTime();
      const result = vnDateOffsetStr(30, baseTime);
      expect(result).toBe("2026-08-03");
    });

    it("should handle negative offset (-30 days)", () => {
      const baseTime = new Date("2026-07-04T12:00:00Z").getTime();
      const result = vnDateOffsetStr(-30, baseTime);
      expect(result).toBe("2026-06-04");
    });

    it("should use Date.now() when 'now' parameter not provided", () => {
      // This test verifies the function can be called without the 'now' parameter
      const result = vnDateOffsetStr(0);
      // Just check it returns a valid date string format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
