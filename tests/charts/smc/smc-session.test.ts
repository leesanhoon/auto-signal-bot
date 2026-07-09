import { describe, expect, test } from "vitest";
import { detectSession } from "../../../src/charts/smc/smc-session.js";

function utcTimestamp(hour: number, minute = 0): number {
  return Date.UTC(2026, 0, 1, hour, minute, 0);
}

describe("detectSession", () => {
  test("returns ASIA for 03:00 UTC", () => {
    expect(detectSession(utcTimestamp(3))).toEqual({
      session: "ASIA",
      sessionLabel: "ASIA (Á)",
    });
  });

  test("returns LONDON for 09:00 UTC", () => {
    expect(detectSession(utcTimestamp(9))).toEqual({
      session: "LONDON",
      sessionLabel: "LONDON (Khung giờ vàng)",
    });
  });

  test("returns LONDON_NY_OVERLAP for 14:00 UTC", () => {
    expect(detectSession(utcTimestamp(14))).toEqual({
      session: "LONDON_NY_OVERLAP",
      sessionLabel: "LONDON/NY OVERLAP (Thanh khoản cao nhất)",
    });
  });

  test("returns NEWYORK for 18:00 UTC", () => {
    expect(detectSession(utcTimestamp(18))).toEqual({
      session: "NEWYORK",
      sessionLabel: "NEW YORK",
    });
  });

  test("returns OFF_HOURS for 22:30 UTC", () => {
    expect(detectSession(utcTimestamp(22, 30))).toEqual({
      session: "OFF_HOURS",
      sessionLabel: "NGOÀI GIỜ (Thanh khoản thấp)",
    });
  });
});
