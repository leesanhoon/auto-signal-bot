import { describe, expect, test } from "vitest";
import {
  resolveOpenPositionDecision,
  resolvePendingOrderDecision,
} from "../../src/charts/position-decision-volman.js";

const position = {
  direction: "LONG" as const,
  entry: "1.1000",
  stopLoss: "1.0960",
  takeProfit1: "1.1080",
};

describe("charts/position-decision", () => {
  test("single TP closes the full LONG position", () => {
    expect(
      resolveOpenPositionDecision(position, {
        high: 1.109,
        low: 1.101,
        lastClose: 1.108,
      }),
    ).toMatchObject({
      decision: "CLOSE",
      managementAction: "TAKE_PROFIT_CLOSE",
    });
  });

  test("single TP closes the full SHORT position", () => {
    expect(
      resolveOpenPositionDecision(
        {
          direction: "SHORT",
          entry: "1.1000",
          stopLoss: "1.1040",
          takeProfit1: "1.0920",
        },
        { high: 1.101, low: 1.091, lastClose: 1.092 },
      ),
    ).toMatchObject({
      decision: "CLOSE",
      managementAction: "TAKE_PROFIT_CLOSE",
    });
  });

  test("stop loss takes precedence when a candle crosses both levels", () => {
    expect(
      resolveOpenPositionDecision(position, {
        high: 1.109,
        low: 1.095,
        lastClose: 1.1,
      }),
    ).toMatchObject({ decision: "STOP", managementAction: "NONE" });
  });

  test("EMA exit remains active before SL or TP is reached", () => {
    expect(
      resolveOpenPositionDecision(
        position,
        { high: 1.104, low: 1.098, lastClose: 1.099 },
        undefined,
        { emaValue: 1.1, period: 20, lastClose: 1.099 },
      ),
    ).toMatchObject({ decision: "STOP", managementAction: "NONE" });
  });

  test("pending LIMIT order behavior is unchanged", () => {
    expect(
      resolvePendingOrderDecision(
        {
          direction: "LONG",
          entry: "1.1000",
          stopLoss: "1.0960",
          orderType: "BUY_LIMIT",
        },
        { high: 1.103, low: 1.099, lastClose: 1.101 },
      ),
    ).toMatchObject({ status: "TRIGGERED" });
  });
});
