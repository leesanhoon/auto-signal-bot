import { describe, expect, test } from "vitest";
import { getCurrentCandleCloseKey, isWithinCandleCloseWindow } from "../../src/charts/chart-cache.js";

describe("charts/chart-cache", () => {
  describe("getCurrentCandleCloseKey", () => {
    test("M15: 13:45 → 13:45", () => {
      const now = new Date("2026-07-03T13:45:00Z");
      expect(getCurrentCandleCloseKey("M15", now)).toBe("2026-07-03T13:45");
    });

    test("M15: 13:59 → 13:45", () => {
      const now = new Date("2026-07-03T13:59:00Z");
      expect(getCurrentCandleCloseKey("M15", now)).toBe("2026-07-03T13:45");
    });

    test("H4: 13:45 → 12:00", () => {
      const now = new Date("2026-07-03T13:45:00Z");
      expect(getCurrentCandleCloseKey("H4", now)).toBe("2026-07-03T12:00");
    });

    test("D1: 23:59 → 00:00", () => {
      const now = new Date("2026-07-03T23:59:00Z");
      expect(getCurrentCandleCloseKey("D1", now)).toBe("2026-07-03T00:00");
    });
  });

  describe("isWithinCandleCloseWindow", () => {
    test("M15: tại thời điểm đóng nến — true", () => {
      const now = new Date("2026-07-03T12:15:00Z");
      expect(isWithinCandleCloseWindow(now, "M15", 20 * 60 * 1000)).toBe(true);
    });

    test("M15: 10 phút sau đóng nến với window 20p — true", () => {
      const now = new Date("2026-07-03T12:25:00Z");
      expect(isWithinCandleCloseWindow(now, "M15", 20 * 60 * 1000)).toBe(true);
    });

    test("M15: 11 phút sau đóng nến với window 10p — false", () => {
      const now = new Date("2026-07-03T14:11:00Z");
      expect(isWithinCandleCloseWindow(now, "M15", 10 * 60 * 1000)).toBe(false);
    });

    test("H4: tại thời điểm đóng nến — true", () => {
      const now = new Date("2026-07-03T12:00:00Z");
      expect(isWithinCandleCloseWindow(now, "H4", 20 * 60 * 1000)).toBe(true);
    });

    test("H4: 10 phút sau đóng nến với window 20p — true", () => {
      const now = new Date("2026-07-03T12:10:00Z");
      expect(isWithinCandleCloseWindow(now, "H4", 20 * 60 * 1000)).toBe(true);
    });

    test("H4: 25 phút sau đóng nến với window 20p — false", () => {
      const now = new Date("2026-07-03T12:25:00Z");
      expect(isWithinCandleCloseWindow(now, "H4", 20 * 60 * 1000)).toBe(false);
    });

    test("D1: tại thời điểm đóng nến — true", () => {
      const now = new Date("2026-07-03T00:00:00Z");
      expect(isWithinCandleCloseWindow(now, "D1", 20 * 60 * 1000)).toBe(true);
    });

    test("D1: 10 phút sau đóng nến với window 20p — true", () => {
      const now = new Date("2026-07-03T00:10:00Z");
      expect(isWithinCandleCloseWindow(now, "D1", 20 * 60 * 1000)).toBe(true);
    });

    test("D1: 25 phút sau đóng nến với window 20p — false", () => {
      const now = new Date("2026-07-03T00:25:00Z");
      expect(isWithinCandleCloseWindow(now, "D1", 20 * 60 * 1000)).toBe(false);
    });
  });
});
