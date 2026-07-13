import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TradeSetup } from "../../src/charts/chart-types-volman.js";
import { applySignalFreshnessGuard } from "../../src/charts/signal-freshness.js";
import * as ohlcProvider from "../../src/charts/ohlc-provider.js";

vi.mock("../../src/charts/ohlc-provider.js");

const mockFetchLastPrice = vi.mocked(ohlcProvider.fetchLastPrice);

const mockSetupLong: TradeSetup = {
  pair: "OANDA:EURUSD",
  direction: "LONG",
  setup: "RB",
  reasons: ["reason1"],
  risks: ["risk1"],
  confidence: 75,
  entry: "1.1000",
  stopLoss: "0.9900",
  takeProfit1: "1.1100",
  takeProfit2: "1.1200",
  riskReward: "1:2",
  summary: "Test setup",
};

const mockSetupShort: TradeSetup = {
  pair: "OANDA:EURUSD",
  direction: "SHORT",
  setup: "RB",
  reasons: ["reason1"],
  risks: ["risk1"],
  confidence: 75,
  entry: "1.1000",
  stopLoss: "1.1100",
  takeProfit1: "1.0900",
  takeProfit2: "1.0800",
  riskReward: "1:2",
  summary: "Test setup",
};

describe("applySignalFreshnessGuard", () => {
  beforeEach(() => {
    delete process.env.SIGNAL_FRESHNESS_GUARD_ENABLED;
    vi.clearAllMocks();
  });

  test("disables guard when SIGNAL_FRESHNESS_GUARD_ENABLED=false", async () => {
    process.env.SIGNAL_FRESHNESS_GUARD_ENABLED = "false";

    mockFetchLastPrice.mockResolvedValue(0.9700);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
    expect(mockFetchLastPrice).not.toHaveBeenCalled();
  });

  test("LONG setup: fresh when price below TP1 and above SL", async () => {
    mockFetchLastPrice.mockResolvedValue(1.1050);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
    expect(mockFetchLastPrice).toHaveBeenCalledWith("OANDA:EURUSD");
  });

  test("LONG setup: stale when price reached TP1", async () => {
    mockFetchLastPrice.mockResolvedValue(1.1100);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
    expect(result.noSetupReason).toContain("1.11");
  });

  test("LONG setup: stale when price exceeded TP1", async () => {
    mockFetchLastPrice.mockResolvedValue(1.1150);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
  });

  test("LONG setup: stale when price touched SL (below)", async () => {
    mockFetchLastPrice.mockResolvedValue(0.9900);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
  });

  test("LONG setup: stale when price exceeded SL (below)", async () => {
    mockFetchLastPrice.mockResolvedValue(0.9850);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
  });

  test("SHORT setup: fresh when price above TP1 and below SL", async () => {
    mockFetchLastPrice.mockResolvedValue(1.0950);

    const result = await applySignalFreshnessGuard(mockSetupShort, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
    expect(mockFetchLastPrice).toHaveBeenCalledWith("OANDA:EURUSD");
  });

  test("SHORT setup: stale when price reached TP1 (below)", async () => {
    mockFetchLastPrice.mockResolvedValue(1.0900);

    const result = await applySignalFreshnessGuard(mockSetupShort, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
  });

  test("SHORT setup: stale when price exceeded TP1 (below)", async () => {
    mockFetchLastPrice.mockResolvedValue(1.0850);

    const result = await applySignalFreshnessGuard(mockSetupShort, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
  });

  test("SHORT setup: stale when price reached SL (above)", async () => {
    mockFetchLastPrice.mockResolvedValue(1.1100);

    const result = await applySignalFreshnessGuard(mockSetupShort, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
  });

  test("SHORT setup: stale when price exceeded SL (above)", async () => {
    mockFetchLastPrice.mockResolvedValue(1.1150);

    const result = await applySignalFreshnessGuard(mockSetupShort, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
  });

  test("returns unchanged setup when price fetch fails (network error)", async () => {
    const error = new Error("Network error");
    mockFetchLastPrice.mockResolvedValue(error);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
    expect(result.pair).toBe("OANDA:EURUSD");
    expect(result.direction).toBe("LONG");
  });

  test("returns unchanged setup when price fetch fails (invalid symbol)", async () => {
    const error = new Error("Symbol khong dung dinh dang");
    mockFetchLastPrice.mockResolvedValue(error);

    const result = await applySignalFreshnessGuard(mockSetupLong, "INVALID:XYZ");

    expect(result.noSetupReason).toBeUndefined();
  });

  test("handles edge case: price equals TP1 exactly for LONG (stale)", async () => {
    mockFetchLastPrice.mockResolvedValue(1.11);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
  });

  test("handles edge case: price equals SL exactly for LONG (stale)", async () => {
    mockFetchLastPrice.mockResolvedValue(0.99);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
  });

  test("handles edge case: price equals TP1 exactly for SHORT (stale)", async () => {
    mockFetchLastPrice.mockResolvedValue(1.09);

    const result = await applySignalFreshnessGuard(mockSetupShort, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
  });

  test("handles edge case: price equals SL exactly for SHORT (stale)", async () => {
    mockFetchLastPrice.mockResolvedValue(1.11);

    const result = await applySignalFreshnessGuard(mockSetupShort, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
  });

  test("setup fields are preserved when fresh", async () => {
    mockFetchLastPrice.mockResolvedValue(1.1050);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.pair).toBe("OANDA:EURUSD");
    expect(result.direction).toBe("LONG");
    expect(result.setup).toBe("RB");
    expect(result.confidence).toBe(75);
    expect(result.entry).toBe("1.1000");
  });

  test("setup fields are preserved when stale", async () => {
    mockFetchLastPrice.mockResolvedValue(1.1150);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.pair).toBe("OANDA:EURUSD");
    expect(result.direction).toBe("LONG");
    expect(result.setup).toBe("RB");
    expect(result.confidence).toBe(75);
    expect(result.entry).toBe("1.1000");
    expect(result.noSetupReason).toBeDefined();
  });

  test("handles setup with string prices containing commas (thousands separator)", async () => {
    const setupWithCommas: TradeSetup = {
      ...mockSetupLong,
      entry: "42,000.00",
      stopLoss: "41,500.00",
      takeProfit1: "43,000.00",
    };

    mockFetchLastPrice.mockResolvedValue(42500);

    const result = await applySignalFreshnessGuard(setupWithCommas, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
  });

  test("feature enabled by default (undefined env var)", async () => {
    expect(process.env.SIGNAL_FRESHNESS_GUARD_ENABLED).toBeUndefined();

    mockFetchLastPrice.mockResolvedValue(1.1150);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(mockFetchLastPrice).toHaveBeenCalled();
  });

  test("handles invalid entry/TP1/SL (returns unchanged)", async () => {
    const invalidSetup: TradeSetup = {
      ...mockSetupLong,
      entry: "invalid",
      stopLoss: "invalid",
      takeProfit1: "invalid",
    };

    mockFetchLastPrice.mockResolvedValue(1.1050);

    const result = await applySignalFreshnessGuard(invalidSetup, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
  });
});
