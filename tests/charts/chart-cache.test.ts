import { describe, expect, test } from "vitest";
import { getCurrentH4CandleCloseKey, getLastClosedH4CandleKey, isWithinCandleCloseWindow } from "../../src/charts/chart-cache.js";

describe("charts/chart-cache", () => {
  describe("getCurrentH4CandleCloseKey", () => {
    test("làm tròn xuống mốc H4 gần nhất — 13:45 → 12", () => {
      const now = new Date("2026-07-03T13:45:00Z");
      expect(getCurrentH4CandleCloseKey(now)).toBe("2026-07-03T12");
    });

    test("đúng biên 0:00 → T00", () => {
      const now = new Date("2026-07-03T00:00:00Z");
      expect(getCurrentH4CandleCloseKey(now)).toBe("2026-07-03T00");
    });

    test("gần cuối ngày 23:59 → T20", () => {
      const now = new Date("2026-07-03T23:59:00Z");
      expect(getCurrentH4CandleCloseKey(now)).toBe("2026-07-03T20");
    });

    test("giữa khoảng 0-4: 1:00 → T00", () => {
      const now = new Date("2026-07-03T01:00:00Z");
      expect(getCurrentH4CandleCloseKey(now)).toBe("2026-07-03T00");
    });

    test("đúng biên 4:00 → T04", () => {
      const now = new Date("2026-07-03T04:00:00Z");
      expect(getCurrentH4CandleCloseKey(now)).toBe("2026-07-03T04");
    });

    test("giữa khoảng 4-8: 6:30 → T04", () => {
      const now = new Date("2026-07-03T06:30:00Z");
      expect(getCurrentH4CandleCloseKey(now)).toBe("2026-07-03T04");
    });

    test("đúng mốc cron 8:05 → T08", () => {
      // analyze.yml cron: 5 0,4,8,12,16,20 → chạy lúc 8:05 UTC
      const now = new Date("2026-07-03T08:05:00Z");
      expect(getCurrentH4CandleCloseKey(now)).toBe("2026-07-03T08");
    });

    test("đúng mốc cron 16:05 → T16", () => {
      const now = new Date("2026-07-03T16:05:00Z");
      expect(getCurrentH4CandleCloseKey(now)).toBe("2026-07-03T16");
    });

    test("ngày khác nhau — 2026-07-04T01:30Z → 2026-07-04T00", () => {
      const now = new Date("2026-07-04T01:30:00Z");
      expect(getCurrentH4CandleCloseKey(now)).toBe("2026-07-04T00");
    });
  });

  test("getLastClosedH4CandleKey keeps the same last-closed semantics", () => {
    const now = new Date("2026-07-03T13:45:00Z");
    expect(getLastClosedH4CandleKey(now)).toBe("2026-07-03T12");
  });

  describe("isWithinCandleCloseWindow", () => {
    test("tại thời điểm đóng nến (12:00) — true", () => {
      const now = new Date("2026-07-03T12:00:00Z");
      expect(isWithinCandleCloseWindow(now, 20 * 60 * 1000)).toBe(true);
    });

    test("10 phút sau đóng nến với window 20p — true", () => {
      const now = new Date("2026-07-03T12:10:00Z");
      expect(isWithinCandleCloseWindow(now, 20 * 60 * 1000)).toBe(true);
    });

    test("25 phút sau đóng nến với window 20p — false", () => {
      const now = new Date("2026-07-03T12:25:00Z");
      expect(isWithinCandleCloseWindow(now, 20 * 60 * 1000)).toBe(false);
    });

    test("gần sát nến đóng tiếp theo (03:59) với window 20p — false", () => {
      // Nến hiện tại đóng tại 00:00, diff ~239 phút, ngoài window 20p
      const now = new Date("2026-07-03T03:59:00Z");
      expect(isWithinCandleCloseWindow(now, 20 * 60 * 1000)).toBe(false);
    });

    test("cận trên biên 19:59 với window 20p — true", () => {
      // Nến đóng tại 20:00 — 19:59 là 1 phút trước khi đóng, nến hiện tại là 16-20
      // diff = 19:59 - 16:00 = 3h59m = 239 phút → false
      const now = new Date("2026-07-03T19:59:00Z");
      expect(isWithinCandleCloseWindow(now, 20 * 60 * 1000)).toBe(false);
    });

    test("đúng 20 phút sau đóng nến — false (cận biên)", () => {
      const now = new Date("2026-07-03T12:20:00Z");
      // 20 * 60 * 1000 = 1200000ms, diff = 1200000ms → không < windowMs
      expect(isWithinCandleCloseWindow(now, 20 * 60 * 1000)).toBe(false);
    });

    test("1ms trước 20 phút — true (sát biên dưới)", () => {
      const now = new Date("2026-07-03T12:19:59.999Z");
      expect(isWithinCandleCloseWindow(now, 20 * 60 * 1000)).toBe(true);
    });
  });
});
