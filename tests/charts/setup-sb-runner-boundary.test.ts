import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "../../src/charts/ohlc-provider.js";
import type { DetectedSignal, DetectionContext } from "../../src/charts/setup-types.js";

const { detectSbMock } = vi.hoisted(() => ({
  detectSbMock: vi.fn(),
}));

vi.mock("../../src/charts/setups/sb.js", () => ({
  detectSb: detectSbMock,
}));

const { runSbDetection } = await import("../../src/charts/setup-sb-runner.js");

describe("setup-sb-runner: boundary guard", () => {
  let ctx: DetectionContext;
  let candles: Candle[];

  beforeEach(() => {
    detectSbMock.mockReset();
    ctx = {
      ma21: Array(10).fill(100),
      atr14: Array(10).fill(2),
      pair: "EUR/USD",
      timeframe: "H4",
    };

    candles = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { time: 1, open: 100, high: 106, low: 100, close: 105, volume: 100 },
      { time: 2, open: 105, high: 105.5, low: 100.5, close: 102, volume: 100 },
    ];
  });

  it("skips SB detection when there are insufficient trailing candles after a false break", () => {
    const signal: DetectedSignal = {
      setup: "FB",
      pair: "EUR/USD",
      timeframe: "H4",
      direction: "LONG",
      entry: 105,
      stopLoss: 100,
      takeProfit: 110,
      confidence: 70,
      triggerIndex: 1,
      ruleTrace: ["FB trigger"],
    };

    const { resolved } = runSbDetection(candles, [signal], 2, ctx);

    expect(detectSbMock).not.toHaveBeenCalled();
    expect(resolved.find((s) => s.setup === "FB")).toBeUndefined();
    expect(resolved.find((s) => s.setup === "SB")).toBeUndefined();
  });
});
