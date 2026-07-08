import { describe, expect, test } from "vitest";
import { resolveOpenPositionDecision, resolvePendingOrderDecision } from "../../src/charts/position-decision.js";

describe("charts/position-decision", () => {
  test("open LONG chạm stop loss → STOP", () => {
    const decision = resolveOpenPositionDecision(
      {
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        tradeStage: "open",
        tp1ClosedPercent: 0,
        trailingStopLoss: null,
      },
      { high: 1.1020, low: 1.0978, lastClose: 1.0982 },
    );
    expect(decision).toMatchObject({ decision: "STOP", comment: expect.stringContaining("stop loss") });
  });

  test("open SHORT chạm TP1 lần đầu → HOLD + PARTIAL_TP1", () => {
    const decision = resolveOpenPositionDecision(
      {
        direction: "SHORT",
        entry: "1.1000",
        stopLoss: "1.1030",
        takeProfit1: "1.0960",
        takeProfit2: "1.0920",
        tradeStage: "open",
        tp1ClosedPercent: 0,
        trailingStopLoss: null,
      },
      { high: 1.1010, low: 1.0955, lastClose: 1.0962 },
    );
    expect(decision).toMatchObject({ decision: "HOLD", managementAction: "PARTIAL_TP1" });
  });

  test("pending BUY_STOP chạm entry → TRIGGERED", () => {
    const decision = resolvePendingOrderDecision(
      {
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0980",
        orderType: "BUY_STOP",
      },
      { high: 1.1008, low: 1.0991, lastClose: 1.1005 },
    );
    expect(decision).toMatchObject({ status: "TRIGGERED" });
  });

  test("open trailing SHORT with trailing stop better than breakeven stays untouched", () => {
    const decision = resolveOpenPositionDecision(
      {
        direction: "SHORT",
        entry: "1.1000",
        stopLoss: "1.1030",
        takeProfit1: "1.0960",
        takeProfit2: "1.0920",
        tradeStage: "trailing",
        tp1ClosedPercent: 50,
        trailingStopLoss: "1.0990",
      },
      { high: 1.1010, low: 1.0965, lastClose: 1.0972 },
    );
    expect(decision).toMatchObject({ decision: "HOLD", managementAction: "NONE", newStopLoss: null });
  });

  test("WAIT_FOR_CONFIRMATION triggers only after close confirms entry", () => {
    const decision = resolvePendingOrderDecision(
      {
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0980",
        orderType: "WAIT_FOR_CONFIRMATION",
      },
      { high: 1.1008, low: 1.0991, lastClose: 1.1005 },
    );
    expect(decision).toMatchObject({ status: "TRIGGERED", comment: expect.stringContaining("WAIT_FOR_CONFIRMATION") });
  });

  test("open position stats null default → OHLC fetch fail comment", () => {
    const decision = resolveOpenPositionDecision(
      {
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        tradeStage: "open",
        tp1ClosedPercent: 0,
        trailingStopLoss: null,
      },
      null,
    );
    expect(decision).toMatchObject({
      decision: "HOLD",
      comment: expect.stringContaining("Chưa lấy được OHLC"),
    });
    expect(decision.comment).not.toContain("Không tìm thấy cấu hình chart");
  });

  test("open position stats null with missing_chart_config reason → chart config comment", () => {
    const decision = resolveOpenPositionDecision(
      {
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        tradeStage: "open",
        tp1ClosedPercent: 0,
        trailingStopLoss: null,
      },
      null,
      "missing_chart_config",
    );
    expect(decision).toMatchObject({
      decision: "HOLD",
      comment: expect.stringContaining("Không tìm thấy cấu hình chart"),
    });
    expect(decision.comment).not.toContain("Chưa lấy được OHLC");
  });

  test("open position stats null with ohlc_fetch_fail reason → OHLC fetch fail comment", () => {
    const decision = resolveOpenPositionDecision(
      {
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        tradeStage: "open",
        tp1ClosedPercent: 0,
        trailingStopLoss: null,
      },
      null,
      "ohlc_fetch_fail",
    );
    expect(decision).toMatchObject({
      decision: "HOLD",
      comment: expect.stringContaining("Chưa lấy được OHLC"),
    });
  });

  test("pending order stats null default → OHLC fetch fail comment", () => {
    const decision = resolvePendingOrderDecision(
      {
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0980",
        orderType: "BUY_STOP",
      },
      null,
    );
    expect(decision).toMatchObject({
      status: "PENDING",
      comment: expect.stringContaining("Chưa lấy được OHLC"),
    });
    expect(decision.comment).not.toContain("Không tìm thấy cấu hình chart");
  });

  test("pending order stats null with missing_chart_config reason → chart config comment", () => {
    const decision = resolvePendingOrderDecision(
      {
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0980",
        orderType: "BUY_STOP",
      },
      null,
      "missing_chart_config",
    );
    expect(decision).toMatchObject({
      status: "PENDING",
      comment: expect.stringContaining("Không tìm thấy cấu hình chart"),
    });
    expect(decision.comment).not.toContain("Chưa lấy được OHLC");
  });

  test("pending order stats null with ohlc_fetch_fail reason → OHLC fetch fail comment", () => {
    const decision = resolvePendingOrderDecision(
      {
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0980",
        orderType: "BUY_STOP",
      },
      null,
      "ohlc_fetch_fail",
    );
    expect(decision).toMatchObject({
      status: "PENDING",
      comment: expect.stringContaining("Chưa lấy được OHLC"),
    });
  });
});
