/**
 * Session/killzone detection cho SMC signal - thuần theo giờ UTC.
 */

export type SmcSessionInfo = {
  session: string;
  sessionLabel: string;
};

export function detectSession(candleTimeMs: number): SmcSessionInfo {
  const hourUtc = new Date(candleTimeMs).getUTCHours();

  if (hourUtc >= 0 && hourUtc < 7) {
    return { session: "ASIA", sessionLabel: "ASIA (Á)" };
  }
  if (hourUtc >= 7 && hourUtc < 12) {
    return { session: "LONDON", sessionLabel: "LONDON (Khung giờ vàng)" };
  }
  if (hourUtc >= 12 && hourUtc < 16) {
    return {
      session: "LONDON_NY_OVERLAP",
      sessionLabel: "LONDON/NY OVERLAP (Thanh khoản cao nhất)",
    };
  }
  if (hourUtc >= 16 && hourUtc < 21) {
    return { session: "NEWYORK", sessionLabel: "NEW YORK" };
  }
  return { session: "OFF_HOURS", sessionLabel: "NGOÀI GIỜ (Thanh khoản thấp)" };
}
