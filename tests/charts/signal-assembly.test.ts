import { describe, expect, test } from "vitest";
import type { DetectedSignal } from "../../src/charts/setup-types.js";
import {
  buildTradeSetupFromSignal,
  buildPairSummaryFromContext,
} from "../../src/charts/signal-assembly.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ddSignal: DetectedSignal = {
  setup: "DD",
  pair: "EUR/USD",
  timeframe: "H4",
  direction: "LONG",
  entry: 1.10234,
  stopLoss: 1.1005,
  takeProfit1: 1.1045,
  takeProfit2: 1.1065,
  confidence: 75,
  triggerIndex: 49,
  ruleTrace: [
    "EMA20 slope=0.32 -> UPTREND",
    "2 doji lien tiep tai index 47-48, sat EMA20 (distance=0.18 ATR)",
    "Nen 49 pha vo High cum doji (1.10234) -> entry LONG",
  ],
};

const rbSignal: DetectedSignal = {
  setup: "RB",
  pair: "GBP/USD",
  timeframe: "H4",
  direction: "SHORT",
  entry: 1.2550,
  stopLoss: 1.2580,
  takeProfit1: 1.2500,
  takeProfit2: 1.2450,
  confidence: 60,
  triggerIndex: 35,
  ruleTrace: [
    "Range 6 candle, EMA20 bat dau doc xuong",
    "Gia pha bien duoi range tai 1.2550 -> entry SHORT",
  ],
};

// ---------------------------------------------------------------------------
// buildTradeSetupFromSignal
// ---------------------------------------------------------------------------

describe("buildTradeSetupFromSignal", () => {
  test("builds complete TradeSetup from DD signal", () => {
    const setup = buildTradeSetupFromSignal(ddSignal, { lastPrice: 1.1025 });
    expect(setup.pair).toBe("EUR/USD");
    expect(setup.direction).toBe("LONG");
    expect(setup.setup).toBe("DD");
    expect(setup.entry).toBe("1.10234");
    expect(setup.stopLoss).toBe("1.10050");
    expect(setup.takeProfit1).toBe("1.10450");
    expect(setup.takeProfit2).toBe("1.10650");
    expect(setup.confidence).toBe(75);
    expect(setup.detectionSource).toBe("deterministic");
    expect(setup.reasons.length).toBeGreaterThan(0);
    expect(setup.risks).toBeDefined();
    expect(setup.ruleTrace).toEqual(ddSignal.ruleTrace);
    expect(setup.summary).toContain("EUR/USD");
    expect(setup.summary).toContain("LONG");
    expect(setup.summary).toContain("DD");
    expect(setup.orderType).toBe("BUY_STOP");
    expect(setup.entryCondition).toBeTruthy();
  });

  test("builds complete TradeSetup from RB signal (SHORT)", () => {
    const setup = buildTradeSetupFromSignal(rbSignal, { lastPrice: 1.2555 });
    expect(setup.pair).toBe("GBP/USD");
    expect(setup.direction).toBe("SHORT");
    expect(setup.setup).toBe("RB");
    expect(setup.orderType).toBe("SELL_STOP");
    expect(setup.detectionSource).toBe("deterministic");
  });

  test("includes risks when confidence < 70", () => {
    const setup = buildTradeSetupFromSignal(rbSignal, { lastPrice: 1.2555 });
    expect(setup.confidence).toBe(60);
    expect(setup.risks.length).toBeGreaterThanOrEqual(1);
  });

  test("sets lastPrice from context", () => {
    const setup = buildTradeSetupFromSignal(ddSignal, { lastPrice: 1.1030 });
    expect(setup.lastPrice).toBe(1.1030);
  });

  test("handles null lastPrice", () => {
    const setup = buildTradeSetupFromSignal(ddSignal, { lastPrice: null });
    // applyPriceSanityChecks returns the setup as-is when lastPrice is null
    expect(setup.lastPrice).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildPairSummaryFromContext
// ---------------------------------------------------------------------------

describe("buildPairSummaryFromContext", () => {
  test("maps UPTREND to Tăng", () => {
    const ps = buildPairSummaryFromContext("EUR/USD", "UPTREND", 0.2, true);
    expect(ps.trend).toBe("Tăng");
    expect(ps.emaProximity).toBe("tại");
    expect(ps.status).toBe("Có setup chờ xác nhận");
    expect(ps.confidence).toBe(70);
    expect(ps.detectionSource).toBe("deterministic");
  });

  test("maps DOWNTREND to Giảm", () => {
    const ps = buildPairSummaryFromContext("GBP/USD", "DOWNTREND", 0.5, false);
    expect(ps.trend).toBe("Giảm");
    expect(ps.emaProximity).toBe("gần");
    expect(ps.status).toBe("Không có setup");
    expect(ps.confidence).toBe(0);
  });

  test("maps FLAT to Đi ngang", () => {
    const ps = buildPairSummaryFromContext("XAU/USD", "FLAT", 1.5, false);
    expect(ps.trend).toBe("Đi ngang");
    expect(ps.emaProximity).toBe("xa");
  });

  test("emaProximity is 'gần' for distance 0.5", () => {
    const ps = buildPairSummaryFromContext("EUR/USD", "UPTREND", 0.5, true);
    expect(ps.emaProximity).toBe("gần");
  });

  test("emaProximity is 'xa' for distance 1.5", () => {
    const ps = buildPairSummaryFromContext("EUR/USD", "UPTREND", 1.5, true);
    expect(ps.emaProximity).toBe("xa");
  });
});