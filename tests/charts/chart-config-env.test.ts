import { afterEach, describe, expect, test } from "vitest";
import {
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredPendingOrderExpiryRuns,
  getConfiguredChartPrimaryTimeframe,
  getConfiguredChartTimeframeMode,
  getConfiguredChartTradingSystem,
} from "../../src/charts/chart-config-env.js";
import type { TradeSetup } from "../../src/charts/chart-types.js";

describe("charts/chart-config-env", () => {
  afterEach(() => {
    delete process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD;
    delete process.env.PENDING_ORDER_EXPIRY_RUNS;
    delete process.env.CHART_TIMEFRAME_MODE;
    delete process.env.CHART_PRIMARY_TIMEFRAME;
    delete process.env.CHART_TRADING_SYSTEM;
  });

  test("keeps chart confidence threshold parsing unchanged", () => {
    delete process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD;
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);

    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "73";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(73);
  });

  test("chart confidence threshold: out-of-range value falls back to 70", () => {
    // > 100
    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "150";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);

    // < 0
    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "-5";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);
  });

  test("chart confidence threshold: non-numeric value falls back to 70", () => {
    process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD = "abc";
    expect(getConfiguredChartSignalConfidenceThreshold()).toBe(70);
  });

  describe("getConfiguredPendingOrderExpiryRuns", () => {
    test("defaults to 2 when env is not set", () => {
      delete process.env.PENDING_ORDER_EXPIRY_RUNS;
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(2);
    });

    test("parses valid integer from env", () => {
      process.env.PENDING_ORDER_EXPIRY_RUNS = "5";
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(5);
    });

    test("non-integer value falls back to 2", () => {
      // Float should not be treated as integer
      process.env.PENDING_ORDER_EXPIRY_RUNS = "2.5";
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(2);
    });

    test("value below 1 falls back to 2", () => {
      process.env.PENDING_ORDER_EXPIRY_RUNS = "0";
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(2);

      process.env.PENDING_ORDER_EXPIRY_RUNS = "-1";
      expect(getConfiguredPendingOrderExpiryRuns()).toBe(2);
    });
  });

  describe("chart timeframe config", () => {
    test("defaults timeframe mode to multi", () => {
      delete process.env.CHART_TIMEFRAME_MODE;
      expect(getConfiguredChartTimeframeMode()).toBe("multi");
    });

    test("defaults primary timeframe to M15", () => {
      delete process.env.CHART_PRIMARY_TIMEFRAME;
      expect(getConfiguredChartPrimaryTimeframe()).toBe("M15");
    });

    test("parses valid timeframe mode and primary timeframe", () => {
      process.env.CHART_TIMEFRAME_MODE = "single";
      process.env.CHART_PRIMARY_TIMEFRAME = "H4";

      expect(getConfiguredChartTimeframeMode()).toBe("single");
      expect(getConfiguredChartPrimaryTimeframe()).toBe("H4");
    });

    test("invalid timeframe config falls back safely", () => {
      process.env.CHART_TIMEFRAME_MODE = "invalid";
      process.env.CHART_PRIMARY_TIMEFRAME = "H1";

      expect(getConfiguredChartTimeframeMode()).toBe("multi");
      expect(getConfiguredChartPrimaryTimeframe()).toBe("M15");
    });
  });

  describe("getConfiguredChartTradingSystem", () => {
    test("defaults to bob-volman when env unset", () => {
      delete process.env.CHART_TRADING_SYSTEM;
      expect(getConfiguredChartTradingSystem()).toBe("bob-volman");
    });

    test("returns smc when CHART_TRADING_SYSTEM=smc", () => {
      process.env.CHART_TRADING_SYSTEM = "smc";
      expect(getConfiguredChartTradingSystem()).toBe("smc");
    });

    test("returns bob-volman when CHART_TRADING_SYSTEM=bob-volman", () => {
      process.env.CHART_TRADING_SYSTEM = "bob-volman";
      expect(getConfiguredChartTradingSystem()).toBe("bob-volman");
    });

    test("normalizes bob_volman (underscore) to bob-volman", () => {
      process.env.CHART_TRADING_SYSTEM = "bob_volman";
      expect(getConfiguredChartTradingSystem()).toBe("bob-volman");
    });

    test("normalizes uppercase values", () => {
      process.env.CHART_TRADING_SYSTEM = "SMC";
      expect(getConfiguredChartTradingSystem()).toBe("smc");

      process.env.CHART_TRADING_SYSTEM = "  Bob-Volman  ";
      expect(getConfiguredChartTradingSystem()).toBe("bob-volman");
    });

    test("invalid value falls back to bob-volman", () => {
      process.env.CHART_TRADING_SYSTEM = "ict";
      expect(getConfiguredChartTradingSystem()).toBe("bob-volman");

      process.env.CHART_TRADING_SYSTEM = "";
      expect(getConfiguredChartTradingSystem()).toBe("bob-volman");
    });
  });

  describe("TradeSetup SMC metadata type compatibility", () => {
    test("TradeSetup fixture with Bob Volman fields only still compiles", () => {
      const setup: TradeSetup = {
        pair: "BTCUSDT",
        direction: "LONG",
        setup: "DD",
        reasons: [],
        risks: [],
        confidence: 70,
        entry: "100",
        stopLoss: "95",
        takeProfit1: "110",
        takeProfit2: "120",
        riskReward: "1:2",
        summary: "ok",
      };
      expect(setup.pair).toBe("BTCUSDT");
    });

    test("TradeSetup fixture with SMC metadata fields compiles", () => {
      const setup: TradeSetup = {
        pair: "XAUTUSDT",
        direction: "SHORT",
        setup: "SMC_BOS_OB",
        reasons: ["BOS bearish"],
        risks: ["Low liquidity"],
        confidence: 51,
        entry: "4128.37",
        stopLoss: "4142.51",
        takeProfit1: "4085.95",
        takeProfit2: "4056.61",
        riskReward: "1:3",
        summary: "SMC BOS+OB",
        detectionSource: "smc",
        grade: "B",
        score: 51,
        market: "Binance Spot XAUTUSDT",
        sessionLabel: "LONDON (Khung giờ vàng)",
        entryZone: { low: "4128.37", high: "4131.83" },
        stopLossDistance: "$14.14",
        takeProfit3: "3945.50",
        takeProfitAllocations: { tp1: 50, tp2: 30, tp3: 20 },
        liquidityTargets: [
          { label: "EQL", price: "4056.11", target: "TP2" },
          { label: "PWL", price: "3945.00", target: "TP3" },
        ],
        caution: "Thanh khoản thấp ngoài khung giờ vàng.",
        capitalManagement: ["Risk 1-2% tài khoản cho lệnh này."],
      };
      expect(setup.grade).toBe("B");
      expect(setup.liquidityTargets?.length).toBe(2);
    });
  });
});
