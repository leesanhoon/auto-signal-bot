import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  detectBbMock,
  detectRbMock,
  detectSbMock,
  isFalseBreakMock,
  nullDetectorMock,
} = vi.hoisted(() => ({
  detectBbMock: vi.fn(),
  detectRbMock: vi.fn(),
  detectSbMock: vi.fn(),
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

vi.mock("../../src/charts/setups/dd.js", () => ({
  detectDd: nullDetectorMock,
}));

vi.mock("../../src/charts/setups/fb.js", () => ({
  detectFb: nullDetectorMock,
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

vi.mock("../../src/charts/setups/sb.js", () => ({
  detectSb: detectSbMock,
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
    takeProfit1: 101.6,
    takeProfit2: 102.4,
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
    takeProfit1: 151.6,
    takeProfit2: 152.4,
    confidence: 52,
    triggerIndex: index,
    ruleTrace: ["mock RB"],
  };
}

function makeSbSignal(index: number) {
  return {
    setup: "SB" as const,
    pair: "EUR/USD",
    timeframe: "H4" as const,
    direction: "SHORT" as const,
    entry: 99.8,
    stopLoss: 100.2,
    takeProfit1: 99.2,
    takeProfit2: 98.8,
    confidence: 35,
    triggerIndex: index,
    ruleTrace: ["mock SB"],
  };
}

describe("runSetupBacktest queue behavior", () => {
  beforeEach(() => {
    detectBbMock.mockReset();
    detectRbMock.mockReset();
    detectSbMock.mockReset();
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
    detectSbMock.mockReturnValue(null);

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
          takeProfit1: 110.0,
          takeProfit2: 120.0,
        };
      }
      return null;
    });
    detectSbMock.mockReturnValue(null);

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

  it("does not double-count a false-break signal and its SB reversal", () => {
    isFalseBreakMock.mockImplementation((_candles, breakoutIndex) => breakoutIndex === 30);
    detectBbMock.mockImplementation((_candles, index) => (index === 30 ? makeBbSignal(index) : null));
    detectSbMock.mockImplementation((_candles, index) => (index === 33 ? makeSbSignal(index) : null));
    detectRbMock.mockImplementation((_candles, index) => (index === 33 ? makeRbSignal(index) : null));

    const report = runSetupBacktest(makeCandles(40), "EUR/USD", "H4");

    expect(report.trades).toHaveLength(2);
    expect(report.trades[0]).toMatchObject({
      setup: "SB",
      entryIndex: 33,
    });
    expect(report.trades[1]).toMatchObject({
      setup: "RB",
      entryIndex: 33,
    });
  });

  it("keeps the original triggerIndex when a fresh signal is deferred behind SB", () => {
    const candles = makeCandles(41);
    candles[36] = {
      ...candles[36],
      high: 100.6,
      low: 99.6,
      close: 100.2,
    };

    isFalseBreakMock.mockImplementation((_candles, breakoutIndex) => breakoutIndex === 30);
    detectBbMock.mockImplementation((_candles, index) => (index === 30 ? makeBbSignal(index) : null));
    detectSbMock.mockImplementation((_candles, index) => {
      if (index === 33) {
        return {
          ...makeSbSignal(index),
          stopLoss: 100.4,
          takeProfit1: 99.2,
          takeProfit2: 98.8,
        };
      }
      return null;
    });
    detectRbMock.mockImplementation((_candles, index) => (index === 33 ? makeRbSignal(index) : null));

    const report = runSetupBacktest(candles, "EUR/USD", "H4");

    expect(report.trades).toHaveLength(2);
    expect(report.trades[0]).toMatchObject({
      setup: "SB",
      entryIndex: 33,
    });
    expect(report.trades[1]).toMatchObject({
      setup: "RB",
      entryIndex: 33,
    });
  });

  it("checks SB only once at the first sbIndex", () => {
    isFalseBreakMock.mockImplementation((_candles, breakoutIndex) => breakoutIndex === 30);
    detectBbMock.mockImplementation((_candles, index) => (index === 30 ? makeBbSignal(index) : null));
    detectSbMock.mockImplementation((_candles, index) => {
      if (index === 33) {
        return null;
      }
      if (index === 34) {
        return makeSbSignal(index);
      }
      return null;
    });

    const report = runSetupBacktest(makeCandles(40), "EUR/USD", "H4");

    expect(report.trades).toHaveLength(0);
    expect(detectSbMock).toHaveBeenCalledTimes(1);
    expect(detectSbMock).toHaveBeenCalledWith(
      expect.any(Array),
      33,
      expect.objectContaining({
        pair: "EUR/USD",
        timeframe: "H4",
      }),
      expect.objectContaining({
        setup: "BB",
        triggerIndex: 30,
      }),
    );
  });

  it("catches detectSb throws without crashing the backtest", () => {
    isFalseBreakMock.mockImplementation((_candles, breakoutIndex) => breakoutIndex === 30);
    detectBbMock.mockImplementation((_candles, index) => (index === 30 ? makeBbSignal(index) : null));
    detectSbMock.mockImplementation(() => {
      throw new Error("boom");
    });

    let report: ReturnType<typeof runSetupBacktest> | undefined;
    expect(() => {
      report = runSetupBacktest(makeCandles(40), "EUR/USD", "H4");
    }).not.toThrow();

    expect(report).toBeDefined();
    expect(report!.trades).toHaveLength(0);
    expect(detectSbMock).toHaveBeenCalledTimes(1);
  });
});
