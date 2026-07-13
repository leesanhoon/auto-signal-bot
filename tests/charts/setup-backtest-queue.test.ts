import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  detectBbMock,
  detectRbMock,
  isFalseBreakMock,
  nullDetectorMock,
} = vi.hoisted(() => ({
  detectBbMock: vi.fn(),
  detectRbMock: vi.fn(),
  isFalseBreakMock: vi.fn(),
  nullDetectorMock: vi.fn(() => null),
}));

vi.mock("../../src/charts/indicators.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/charts/indicators.js")>(
    "../../src/charts/indicators.js",
  );
  return {
    ...actual,
    isFalseBreak: isFalseBreakMock,
  };
});

vi.mock("../../src/charts/setups/bb.js", () => ({
  detectBb: detectBbMock,
}));

vi.mock("../../src/charts/setups/rb.js", () => ({
  detectRb: detectRbMock,
}));

vi.mock("../../src/charts/setups/arb.js", () => ({
  detectArb: nullDetectorMock,
}));

vi.mock("../../src/charts/setups/irb.js", () => ({
  detectIrb: nullDetectorMock,
}));

const { runSetupBacktest } = await import("../../src/charts/setup-backtest.js");

function makeCandles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    time: 1700000000000 + i * 3600000,
    open: 100,
    high: 100.3,
    low: 99.7,
    close: 100.05,
    volume: 100,
  }));
}

function makeBbSignal(index: number) {
  return {
    setup: "BB" as const,
    pair: "EUR/USD",
    timeframe: "H4" as const,
    direction: "LONG" as const,
    entry: 100.4,
    stopLoss: 99.6,
    takeProfit: 102.0,
    confidence: 55,
    triggerIndex: index,
    ruleTrace: ["mock BB"],
  };
}

function makeRbSignal(index: number) {
  return {
    setup: "RB" as const,
    pair: "EUR/USD",
    timeframe: "H4" as const,
    direction: "LONG" as const,
    entry: 150.4,
    stopLoss: 149.6,
    takeProfit: 152.0,
    confidence: 52,
    triggerIndex: index,
    ruleTrace: ["mock RB"],
  };
}

describe("runSetupBacktest queue behavior", () => {
  beforeEach(() => {
    detectBbMock.mockReset();
    detectRbMock.mockReset();
    isFalseBreakMock.mockReset();
    nullDetectorMock.mockImplementation(() => null);
  });

  it("releases an open_at_end trade so later signals still fire", () => {
    isFalseBreakMock.mockReturnValue(false);
    detectBbMock.mockImplementation((_candles, index) => {
      if (index === 30 || index === 33) {
        return makeBbSignal(index);
      }
      return null;
    });

    const report = runSetupBacktest(makeCandles(40), "EUR/USD", "H4");

    expect(report.trades).toHaveLength(2);
    expect(report.trades[0]).toMatchObject({
      setup: "BB",
      entryIndex: 30,
    });
  });

  it("releases an open_at_end trade so later signals still fire", () => {
    isFalseBreakMock.mockReturnValue(false);
    detectBbMock.mockImplementation((_candles, index) => {
      if (index === 30 || index === 35) {
        return {
          ...makeBbSignal(index),
          entry: 100.4,
          stopLoss: 90.0,
          takeProfit: 120.0,
        };
      }
      return null;
    });

    const report = runSetupBacktest(makeCandles(40), "EUR/USD", "H4");

    expect(report.trades).toHaveLength(2);
    expect(report.trades[0]).toMatchObject({
      setup: "BB",
      entryIndex: 30,
      outcome: "open_at_end",
    });
    expect(report.trades[1]).toMatchObject({
      setup: "BB",
      entryIndex: 35,
      outcome: "open_at_end",
    });
  });

  it("drops a false-break signal instead of replacing it with an SB reversal (SB retired)", () => {
    isFalseBreakMock.mockImplementation((_candles, breakoutIndex) => breakoutIndex === 30);
    detectBbMock.mockImplementation((_candles, index) => (index === 30 ? makeBbSignal(index) : null));
    detectRbMock.mockImplementation((_candles, index) => (index === 33 ? makeRbSignal(index) : null));

    const report = runSetupBacktest(makeCandles(40), "EUR/USD", "H4");

    // The BB signal at 30 is a confirmed false break and is dropped outright —
    // no SB reversal trade is spawned. Only the later RB signal survives.
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0]).toMatchObject({
      setup: "RB",
      entryIndex: 33,
    });
  });

  it("only watches a false break once (isFalseBreak checked a single time per pending signal)", () => {
    isFalseBreakMock.mockImplementation((_candles, breakoutIndex) => breakoutIndex === 30);
    detectBbMock.mockImplementation((_candles, index) => (index === 30 ? makeBbSignal(index) : null));

    const report = runSetupBacktest(makeCandles(40), "EUR/USD", "H4");

    expect(report.trades).toHaveLength(0);
    expect(isFalseBreakMock).toHaveBeenCalledTimes(1);
  });
});
