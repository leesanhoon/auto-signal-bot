import { describe, expect, test } from "vitest";
import {
  buildSmcPairSummary,
  buildTradeSetupFromSmcSignal,
} from "../../../src/charts/smc/smc-signal-assembly.js";
import type { SmcSignal } from "../../../src/charts/smc/smc-types.js";

const longSignal: SmcSignal = {
  setup: "SMC_BOS_OB",
  pair: "XAUTUSDT",
  timeframe: "M15",
  direction: "LONG",
  entry: 4128.37,
  stopLoss: 4110.12,
  takeProfit1: 4162.11,
  takeProfit2: 4199.5,
  takeProfit3: 4240.75,
  entryZone: { low: 4128.37, high: 4131.83 },
  liquidityTargets: [
    { label: "EQL 4056.11", price: 4056.11, target: "TP2" },
    { label: "PWL 3945.00", price: 3945, target: "TP3" },
  ],
  confidence: 87,
  grade: "A",
  score: 91,
  triggerIndex: 42,
  structureEvent: {
    kind: "BOS",
    direction: "LONG",
    breakIndex: 42,
    level: 4118.2,
  },
  liquiditySweep: {
    direction: "LONG",
    sweepIndex: 39,
    sweptLevel: 4102.4,
    reclaimClose: 4111.7,
  },
  orderBlock: {
    direction: "LONG",
    startIndex: 35,
    endIndex: 35,
    high: 4114.8,
    low: 4106.2,
    midpoint: 4110.5,
  },
  fairValueGap: {
    direction: "LONG",
    index: 40,
    high: 4117.1,
    low: 4113.2,
    midpoint: 4115.15,
  },
  ruleTrace: [
    "CHOCH bullish trên M15 sau sweep thanh khoản.",
    "OB + FVG trùng vùng entry.",
  ],
  market: "Binance Spot XAUTUSDT",
  session: "LONDON",
  sessionLabel: "Khung giờ vàng",
};

const shortSignal: SmcSignal = {
  setup: "SMC_CHOCH_OB",
  pair: "EURUSDT",
  timeframe: "H4",
  direction: "SHORT",
  entry: 1.1012,
  stopLoss: 1.1065,
  takeProfit1: 1.096,
  takeProfit2: 1.0912,
  confidence: 58,
  grade: "B",
  score: 66,
  triggerIndex: 18,
  ruleTrace: ["CHOCH giảm từ H4", "Quét buy-side liquidity trước khi vào lệnh"],
};

describe("buildTradeSetupFromSmcSignal", () => {
  test("builds valid LONG TradeSetup with smc detection source", () => {
    const setup = buildTradeSetupFromSmcSignal(longSignal, { lastPrice: 4129.1 });
    expect(setup).not.toBeNull();
    expect(setup?.direction).toBe("LONG");
    expect(setup?.setup).toBe("SMC_BOS_OB");
    expect(setup?.detectionSource).toBe("smc");
    expect(setup?.primaryTimeframe).toBe("M15");
    expect(setup?.orderType).toBe("BUY_LIMIT");
    expect(setup?.entryZone).toEqual({ low: "4128.37", high: "4131.83" });
    expect(setup?.stopLossDistance).toBe("$18.250");
    expect(setup?.takeProfit3).toBe("4240.75");
    expect(setup?.takeProfitAllocations).toEqual({ tp1: 50, tp2: 30, tp3: 20 });
    expect(setup?.liquidityTargets).toEqual([
      { label: "EQL 4056.11", price: "4056.11", target: "TP2", riskReward: "4.0:1" },
      { label: "PWL 3945.00", price: "3945.00", target: "TP3", riskReward: "10.0:1" },
    ]);
    expect(setup?.capitalManagement).toEqual([
      "Risk 1-2% tài khoản cho lệnh này.",
      "Chiến lược chốt lời: 50% tại TP1, 30% tại TP2, 20% tại TP3.",
      "Kéo SL về entry/breakeven khi chạm TP1.",
    ]);
    expect(setup?.reasons.join(" ")).toContain("SMC setup SMC_BOS_OB");
    expect(setup?.ruleTrace).toEqual(longSignal.ruleTrace);
  });

  test("builds valid SHORT TradeSetup", () => {
    const setup = buildTradeSetupFromSmcSignal(shortSignal, { lastPrice: 1.1008 });
    expect(setup).not.toBeNull();
    expect(setup?.direction).toBe("SHORT");
    expect(setup?.orderType).toBe("SELL_LIMIT");
    expect(setup?.detectionSource).toBe("smc");
    expect(setup?.grade).toBe("B");
    expect(setup?.score).toBe(66);
    expect(setup?.capitalManagement).toEqual([
      "Risk 1-2% tài khoản cho lệnh này.",
      "Chiến lược chốt lời: 50% tại TP1, 50% tại TP2.",
      "Kéo SL về entry/breakeven khi chạm TP1.",
    ]);
  });

  test("returns null when last price invalidates stop loss", () => {
    expect(buildTradeSetupFromSmcSignal(longSignal, { lastPrice: 4100 })).toBeNull();
    expect(buildTradeSetupFromSmcSignal(shortSignal, { lastPrice: 1.107 })).toBeNull();
  });
});

describe("buildSmcPairSummary", () => {
  test("marks active and no-setup states with smc source", () => {
    const active = buildSmcPairSummary("XAUTUSDT", "UPTREND", 82, true, ["Trace 1"]);
    const idle = buildSmcPairSummary("XAUTUSDT", "FLAT", 0, false);
    expect(active.detectionSource).toBe("smc");
    expect(active.status).toBe("Có setup SMC đang hoạt động");
    expect(active.confidence).toBe(82);
    expect(active.ruleTrace).toEqual(["Trace 1"]);
    expect(idle.detectionSource).toBe("smc");
    expect(idle.status).toBe("Không có setup SMC");
    expect(idle.confidence).toBe(0);
  });
});
