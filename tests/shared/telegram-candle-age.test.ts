import { beforeEach, describe, expect, test, vi } from "vitest";

// We test the buildSmcSignalMessage function to verify candle age is included
// The Volman implementation is tested indirectly through the same logic

import { buildSmcSignalMessage } from "../../src/shared/telegram-smc.js";
import type { TradeSetup } from "../../src/charts/chart-types-smc.js";

const mockSetupBase: TradeSetup = {
  pair: "OANDA:EURUSD",
  direction: "LONG",
  setup: "SMC",
  reasons: ["Test reason"],
  risks: ["Test risk"],
  confidence: 75,
  entry: "1.1000",
  stopLoss: "0.9900",
  takeProfit1: "1.1100",
  takeProfit2: "1.1200",
  riskReward: "1:2",
  summary: "Test setup",
};

describe("Candle Age in Messages - SMC", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test("buildSmcSignalMessage includes candle age with M15 timeframe", () => {
    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "M15",
    };

    const message = buildSmcSignalMessage(setup);

    expect(message).toContain("🕐 Nến gốc");
    expect(message).toContain("[M15]");
    expect(message).toContain("đóng:");
    expect(message).toContain("UTC");
    expect(message).toContain("phút trước");
  });

  test("buildSmcSignalMessage includes candle age with H4 timeframe", () => {
    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "H4",
    };

    const message = buildSmcSignalMessage(setup);

    expect(message).toContain("🕐 Nến gốc");
    expect(message).toContain("[H4]");
    expect(message).toContain("đóng:");
    expect(message).toContain("UTC");
    expect(message).toContain("phút trước");
  });

  test("buildSmcSignalMessage includes candle age with D1 timeframe", () => {
    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "D1",
    };

    const message = buildSmcSignalMessage(setup);

    expect(message).toContain("🕐 Nến gốc");
    expect(message).toContain("[D1]");
  });

  test("buildSmcSignalMessage includes candle age with H1 timeframe", () => {
    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "H1",
    };

    const message = buildSmcSignalMessage(setup);

    expect(message).toContain("🕐 Nến gốc");
    expect(message).toContain("[H1]");
  });

  test("buildSmcSignalMessage includes candle age with M30 timeframe", () => {
    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "M30",
    };

    const message = buildSmcSignalMessage(setup);

    expect(message).toContain("🕐 Nến gốc");
    expect(message).toContain("[M30]");
  });

  test("buildSmcSignalMessage skips candle age when timeframe is missing", () => {
    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: undefined,
    };

    const message = buildSmcSignalMessage(setup);

    // Should not crash, and either skip the line or have "N/A"
    expect(message).toBeDefined();
    expect(typeof message).toBe("string");
  });

  test("buildSmcSignalMessage includes valid HH:mm format", () => {
    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "M15",
    };

    const message = buildSmcSignalMessage(setup);

    // Check for HH:mm format (two digits for hour and minute)
    const timeMatch = message.match(/(\d{2}):(\d{2})/);
    expect(timeMatch).toBeTruthy();

    const hour = parseInt(timeMatch![1]);
    const minute = parseInt(timeMatch![2]);

    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThan(24);
    expect(minute).toBeGreaterThanOrEqual(0);
    expect(minute).toBeLessThan(60);
  });

  test("buildSmcSignalMessage includes valid dd/MM format", () => {
    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "M15",
    };

    const message = buildSmcSignalMessage(setup);

    // Check for dd/MM format
    const dateMatch = message.match(/(\d{2})\/(\d{2})\s+UTC/);
    expect(dateMatch).toBeTruthy();

    const day = parseInt(dateMatch![1]);
    const month = parseInt(dateMatch![2]);

    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });

  test("buildSmcSignalMessage minute count is reasonable (0-1440)", () => {
    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "M15",
    };

    const message = buildSmcSignalMessage(setup);

    const minuteMatch = message.match(/\((\d+)\s+phút trước\)/);
    expect(minuteMatch).toBeTruthy();

    const minutes = parseInt(minuteMatch![1]);
    expect(minutes).toBeGreaterThanOrEqual(0);
    expect(minutes).toBeLessThanOrEqual(1440); // Max 1 day
  });

  test("ISSUE-3 fix: candle close time shows PAST candle, not future (fake timer M15)", () => {
    vi.useFakeTimers();
    // Set time to 2026-07-10T12:32:00Z (32 minutes into M15 candle)
    // Previous candle closed at 12:30:00Z, next closes at 12:45:00Z
    vi.setSystemTime(new Date("2026-07-10T12:32:00Z"));

    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "M15",
    };

    const message = buildSmcSignalMessage(setup);

    // Must show 12:30 (closed 2 min ago), NOT 12:45 (13 min in future)
    expect(message).toContain("12:30");
    expect(message).not.toContain("12:45");
    expect(message).toContain("(2 phút trước)");

    vi.useRealTimers();
  });

  test("ISSUE-3 fix: candle close time shows PAST candle (fake timer H4)", () => {
    vi.useFakeTimers();
    // Set time to 2026-07-10T16:15:00Z (15 minutes into H4 candle starting at 16:00)
    // Previous candle closed at 16:00:00Z (15 min ago)
    vi.setSystemTime(new Date("2026-07-10T16:15:00Z"));

    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "H4",
    };

    const message = buildSmcSignalMessage(setup);

    // Must show 16:00 (closed 15 min ago), NOT 20:00 (next close in 3:45)
    expect(message).toContain("16:00");
    expect(message).not.toContain("20:00");
    expect(message).toContain("(15 phút trước)");

    vi.useRealTimers();
  });

  test("ISSUE-3 fix: candle close time at exact close boundary", () => {
    vi.useFakeTimers();
    // Set time to exactly when candle closes: 2026-07-10T12:30:00Z (M15)
    vi.setSystemTime(new Date("2026-07-10T12:30:00Z"));

    const setup: TradeSetup = {
      ...mockSetupBase,
      primaryTimeframe: "M15",
    };

    const message = buildSmcSignalMessage(setup);

    // Must show 12:30 and "0 phút trước"
    expect(message).toContain("12:30");
    expect(message).toContain("(0 phút trước)");

    vi.useRealTimers();
  });
});

