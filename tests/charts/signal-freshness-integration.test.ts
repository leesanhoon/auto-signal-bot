import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TradeSetup } from "../../src/charts/chart-types-smc.js";
import { applySignalFreshnessGuard } from "../../src/charts/signal-freshness.js";
import * as ohlcProvider from "../../src/charts/ohlc-provider.js";

// Only mock fetchLastPrice, call everything else for real
vi.mock("../../src/charts/ohlc-provider.js");

const mockFetchLastPrice = vi.mocked(ohlcProvider.fetchLastPrice);

describe("Signal Freshness Guard — Integration with Real Scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("ISSUE-1 reproduction: SHORT USD/CAD setup stale (real pair format)", async () => {
    // Real production scenario from 2026-07-10
    // Market: SHORT entry 1.41657, TP1 1.41597, SL 1.41687
    // Fresh price: 1.41474 (already past TP1)
    const usdcadStaleSetup: TradeSetup = {
      pair: "USD/CAD", // Production pair format (NOT "OANDA:USDCAD")
      direction: "SHORT",
      setup: "SMC",
      reasons: ["ABCD pattern confirmed"],
      risks: ["Liquidity risk"],
      confidence: 75,
      entry: "1.41657",
      stopLoss: "1.41687",
      takeProfit1: "1.41597",
      takeProfit2: "1.41567",
      riskReward: "1:2",
      summary: "Setup from 2026-07-10",
    };

    // Mock fetchLastPrice to return price that has passed TP1
    mockFetchLastPrice.mockResolvedValue(1.41474);

    const result = await applySignalFreshnessGuard(usdcadStaleSetup, "OANDA:USDCAD");

    // Setup MUST be marked as stale (noSetupReason set)
    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
    expect(result.noSetupReason).toContain("1.41474"); // Fresh price in reason

    // Verify fetchLastPrice was called with correct symbol (not with pair)
    expect(mockFetchLastPrice).toHaveBeenCalledWith("OANDA:USDCAD");
    expect(mockFetchLastPrice).not.toHaveBeenCalledWith("USD/CAD");
  });

  test("Fresh setup passes (price between SL and TP1)", async () => {
    const freshSetup: TradeSetup = {
      pair: "EUR/USD",
      direction: "LONG",
      setup: "SMC",
      reasons: ["Reason"],
      risks: ["Risk"],
      confidence: 80,
      entry: "1.1000",
      stopLoss: "1.0900",
      takeProfit1: "1.1100",
      takeProfit2: "1.1200",
      riskReward: "1:2",
      summary: "Fresh setup",
    };

    // Price between entry and TP1 → fresh
    mockFetchLastPrice.mockResolvedValue(1.1050);

    const result = await applySignalFreshnessGuard(freshSetup, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
  });

  test("Stale setup (price at SL) gets filtered", async () => {
    const setupAtSL: TradeSetup = {
      pair: "GBP/USD",
      direction: "LONG",
      setup: "SMC",
      reasons: ["Reason"],
      risks: ["Risk"],
      confidence: 70,
      entry: "1.2800",
      stopLoss: "1.2700",
      takeProfit1: "1.2900",
      takeProfit2: "1.3000",
      riskReward: "1:2",
      summary: "Setup",
    };

    // Price exactly at SL → stale
    mockFetchLastPrice.mockResolvedValue(1.2700);

    const result = await applySignalFreshnessGuard(setupAtSL, "OANDA:GBPUSD");

    expect(result.noSetupReason).toBeDefined();
  });

  test("SHORT setup stale (price at TP1) gets filtered", async () => {
    const shortSetup: TradeSetup = {
      pair: "USD/JPY",
      direction: "SHORT",
      setup: "SMC",
      reasons: ["Reason"],
      risks: ["Risk"],
      confidence: 75,
      entry: "150.00",
      stopLoss: "151.00",
      takeProfit1: "149.00",
      takeProfit2: "148.00",
      riskReward: "1:2",
      summary: "Short setup",
    };

    // Price exactly at TP1 → stale
    mockFetchLastPrice.mockResolvedValue(149.0);

    const result = await applySignalFreshnessGuard(shortSetup, "OANDA:USDJPY");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("Gia da vuot TP1/SL");
  });

  test("Fetch error → setup not filtered (fail-open)", async () => {
    const setup: TradeSetup = {
      pair: "XAU/USD",
      direction: "LONG",
      setup: "SMC",
      reasons: ["Reason"],
      risks: ["Risk"],
      confidence: 80,
      entry: "2000",
      stopLoss: "1980",
      takeProfit1: "2020",
      takeProfit2: "2040",
      riskReward: "1:2",
      summary: "Setup",
    };

    // Simulate network error when fetching price
    mockFetchLastPrice.mockResolvedValue(new Error("Network error"));

    const result = await applySignalFreshnessGuard(setup, "OANDA:XAUUSD");

    // Setup should NOT be filtered (fail-open behavior)
    expect(result.noSetupReason).toBeUndefined();
  });

  test("Invalid symbol format → setup not filtered", async () => {
    const setup: TradeSetup = {
      pair: "TestPair",
      direction: "LONG",
      setup: "SMC",
      reasons: ["Reason"],
      risks: ["Risk"],
      confidence: 75,
      entry: "100",
      stopLoss: "90",
      takeProfit1: "110",
      takeProfit2: "120",
      riskReward: "1:2",
      summary: "Setup",
    };

    // fetchLastPrice will return error for invalid symbol
    mockFetchLastPrice.mockResolvedValue(new Error("Symbol khong dung dinh dang"));

    const result = await applySignalFreshnessGuard(setup, "INVALID:PAIR");

    // Setup should NOT be filtered
    expect(result.noSetupReason).toBeUndefined();
  });

  test("Feature disabled via env var → setup not filtered even if stale", async () => {
    process.env.SIGNAL_FRESHNESS_GUARD_ENABLED = "false";

    const staleSetup: TradeSetup = {
      pair: "USD/CAD",
      direction: "SHORT",
      setup: "SMC",
      reasons: ["Reason"],
      risks: ["Risk"],
      confidence: 75,
      entry: "1.41657",
      stopLoss: "1.41687",
      takeProfit1: "1.41597",
      takeProfit2: "1.41567",
      riskReward: "1:2",
      summary: "Stale but guard disabled",
    };

    mockFetchLastPrice.mockResolvedValue(1.41474); // Past TP1

    const result = await applySignalFreshnessGuard(staleSetup, "OANDA:USDCAD");

    // Fetch should NOT be called when feature disabled
    expect(mockFetchLastPrice).not.toHaveBeenCalled();
    // Setup should NOT be filtered
    expect(result.noSetupReason).toBeUndefined();

    delete process.env.SIGNAL_FRESHNESS_GUARD_ENABLED;
  });
});
