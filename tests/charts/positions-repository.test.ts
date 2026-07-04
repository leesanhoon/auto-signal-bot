import { beforeEach, describe, expect, test, vi } from "vitest";

const repoState = vi.hoisted(() => ({
  selectResult: { data: [], error: null as null | { message: string } },
  insertResult: { error: null as null | { message: string } },
  updateResult: { error: null as null | { message: string } },
  chainResult: { data: null as unknown, error: null as null | { message: string } },
  select: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  limit: vi.fn(),
  order: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../src/shared/db.js", () => ({
  getDb: () => ({
    from: repoState.from,
  }),
}));

const positionsRepository = await import("../../src/charts/positions-repository.js");
const positionEngine = await import("../../src/charts/position-engine.js");

// Shared across every describe block in this file (both the original suite and the
// ones appended below) so each test starts from the same clean mock chain.
beforeEach(() => {
  repoState.select.mockReset();
  repoState.eq.mockReset();
  repoState.gte.mockReset();
  repoState.limit.mockReset();
  repoState.order.mockReset();
  repoState.insert.mockReset();
  repoState.update.mockReset();
  repoState.from.mockReset();

  repoState.chainResult = { data: null, error: null };

  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    limit: vi.fn(async () => repoState.selectResult),
    order: vi.fn(() => chain),
    insert: vi.fn(async () => repoState.insertResult),
    update: vi.fn(() => chain),
    then: (onFulfilled: (v: any) => any) =>
      Promise.resolve(repoState.chainResult).then(onFulfilled),
  };

  repoState.from.mockReturnValue(chain);
  process.env.POSITION_MIN_RISK_REWARD_RATIO = "1.5";
  process.env.POSITION_TP1_CLOSE_PERCENT = "50";
});

describe("charts/positions-repository", () => {
  test("saveOpenPosition stores the partial TP and risk-reward metadata", async () => {
    repoState.selectResult = { data: [], error: null };
    repoState.insertResult = { error: null };

    const saved = await positionsRepository.saveOpenPosition({
      pair: "EUR/USD",
      direction: "LONG",
      setup: "Breakout",
      emaTouch: true,
      reasons: ["EMA touch"],
      risks: ["False breakout"],
      confidence: 82,
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1080",
      takeProfit2: "1.1120",
      riskReward: "1:2",
      summary: "Valid long",
    });

    expect(saved).toBe(true);
    expect(repoState.from).toHaveBeenCalledWith("open_positions");
    expect(repoState.from().insert).toHaveBeenCalledWith(
      expect.objectContaining({
        pair: "EUR/USD",
        trade_stage: "open",
        tp1_close_percent: 50,
        tp1_closed_percent: 0,
        last_management_action: "NONE",
        risk_reward_ratio: expect.any(Number),
      }),
    );
  });

  test("saveOpenPosition rejects low risk-reward setups before writing to DB", async () => {
    const saved = await positionsRepository.saveOpenPosition({
      pair: "EUR/USD",
      direction: "LONG",
      setup: "Weak setup",
      emaTouch: true,
      reasons: ["weak"],
      risks: ["risk"],
      confidence: 60,
      entry: "1.1000",
      stopLoss: "1.0985",
      takeProfit1: "1.1010",
      takeProfit2: "1.1015",
      riskReward: "1:1",
      summary: "Too weak",
    });

    expect(saved).toBe(false);
    expect(repoState.from).not.toHaveBeenCalled();
  });

  test("updatePositionDecision persists TP1 partial-close state", async () => {
    repoState.updateResult = { error: null };

    await positionsRepository.updatePositionDecision(
      42,
      {
        decision: "HOLD",
        confidence: 88,
        comment: "TP1 reached",
        managementAction: "PARTIAL_TP1",
        partialClosePercent: 50,
        newStopLoss: "1.1000",
        tp1Reached: true,
        tp2Reached: false,
        riskReward: 2.5,
        tp1RiskReward: 2,
        tp2RiskReward: 3,
      },
      {
        tradeStage: "tp1_partial",
        tp1ClosedPercent: 50,
        tp1ClosedAt: "2026-07-01T00:00:00.000Z",
        trailingStopLoss: "1.1000",
        trailingStartedAt: "2026-07-01T00:00:00.000Z",
        lastManagementAction: "PARTIAL_TP1",
        lastManagementComment: "TP1 reached",
        lastManagementAt: "2026-07-01T00:00:00.000Z",
        stopLoss: "1.1000",
      },
    );

    expect(repoState.from().update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_decision: "HOLD",
        last_decision_confidence: 88,
        trade_stage: "tp1_partial",
        tp1_closed_percent: 50,
        trailing_stop_loss: "1.1000",
        stop_loss: "1.1000",
      }),
    );
  });

  test("buildPositionManagementPatch uses TP2 close to close the position", () => {
    const position = {
      id: 1,
      pair: "EUR/USD",
      direction: "LONG" as const,
      setup: "Breakout",
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1080",
      takeProfit2: "1.1120",
      reasons: ["EMA touch"],
      openedAt: "2026-07-01T00:00:00.000Z",
      status: "open" as const,
      lastDecision: null,
      lastDecisionConfidence: null,
      lastDecisionComment: null,
      lastCheckedAt: null,
      closedAt: null,
      tradeStage: "tp1_partial" as const,
      tp1ClosePercent: 50,
      tp1ClosedPercent: 50,
      tp1ClosedAt: "2026-07-01T00:00:00.000Z",
      trailingStopLoss: "1.1000",
      trailingStartedAt: "2026-07-01T00:00:00.000Z",
      riskRewardRatio: 2.5,
      tp1RiskRewardRatio: 2,
      tp2RiskRewardRatio: 3,
      minRiskRewardRatio: 1.5,
      lastManagementAction: "PARTIAL_TP1",
      lastManagementComment: "TP1 reached",
      lastManagementAt: "2026-07-01T00:00:00.000Z",
    };

    const management = positionsRepository.buildPositionManagementPatch(position, {
      decision: "CLOSE",
      confidence: 92,
      comment: "TP2 reached",
      managementAction: "TP2_CLOSE",
      partialClosePercent: 100,
      newStopLoss: "1.1060",
      tp1Reached: false,
      tp2Reached: true,
      riskReward: 3,
      tp1RiskReward: 2,
      tp2RiskReward: 3,
    });

    expect(management.closePosition).toBe(true);
    expect(management.patch).toMatchObject({
      tradeStage: "closed",
      tp1ClosedPercent: 50,
      stopLoss: "1.1060",
      lastManagementAction: "TP2_CLOSE",
    });
  });

  test("closePosition stores realized performance metrics for manual close", async () => {
    repoState.updateResult = { error: null };

    await positionsRepository.closePosition(
      {
        id: 7,
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Breakout",
        entry: "1.1000",
        stopLoss: "1.1000",
        takeProfit1: "1.1080",
        takeProfit2: "1.1120",
        reasons: ["EMA touch"],
        openedAt: "2026-07-01T00:00:00.000Z",
        status: "open",
        lastDecision: null,
        lastDecisionConfidence: null,
        lastDecisionComment: null,
        lastCheckedAt: null,
        closedAt: null,
        tradeStage: "tp1_partial",
        tp1ClosePercent: 50,
        tp1ClosedPercent: 50,
        tp1ClosedAt: "2026-07-01T00:00:00.000Z",
        trailingStopLoss: "1.1000",
        trailingStartedAt: "2026-07-01T00:00:00.000Z",
        riskRewardRatio: 2.5,
        tp1RiskRewardRatio: 2,
        tp2RiskRewardRatio: 3,
        minRiskRewardRatio: 1.5,
        lastManagementAction: "PARTIAL_TP1",
        lastManagementComment: "TP1 reached",
        lastManagementAt: "2026-07-01T00:00:00.000Z",
        closeReason: null,
        realizedRiskRewardRatio: null,
        realizedExitPrice: null,
      },
      {
        decision: "CLOSE",
        confidence: 80,
        comment: "Setup invalidated",
        managementAction: "NONE",
        partialClosePercent: 0,
        newStopLoss: null,
        tp1Reached: false,
        tp2Reached: false,
        riskReward: null,
        tp1RiskReward: 2,
        tp2RiskReward: 3,
      },
      {
        tradeStage: "closed",
        tp1ClosedPercent: 50,
        trailingStopLoss: "1.1000",
        stopLoss: "1.1000",
        lastManagementAction: "NONE",
      },
    );

    expect(repoState.from().update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "closed",
        close_reason: "manual_close",
        realized_risk_reward_ratio: 1,
        realized_exit_price: "1.1000",
      }),
    );
  });
});

describe("savePendingOrder", () => {
  test("inserts with default order_type based on direction and status PENDING, run_count 0", async () => {
    repoState.selectResult = { data: [], error: null };
    repoState.insertResult = { error: null };

    const saved = await positionsRepository.savePendingOrder({
      pair: "GBP/USD",
      direction: "LONG",
      setup: "Breakout",
      entry: "1.2500",
      stopLoss: "1.2450",
      takeProfit1: "1.2600",
      takeProfit2: "1.2650",
      reasons: ["Strong momentum"],
      risks: ["News risk"],
      confidence: 78,
      riskReward: "1:2",
      summary: "Long GBP/USD",
      emaTouch: true,
    } as any);

    expect(saved).toBe(true);
    // lookup on pending_orders
    expect(repoState.from).toHaveBeenNthCalledWith(1, "pending_orders");
    expect(repoState.from().select).toHaveBeenCalledWith("id");
    expect(repoState.from().eq).toHaveBeenCalledWith("status", "PENDING");
    expect(repoState.from().limit).toHaveBeenCalledWith(1);
    // insert on pending_orders — second call
    expect(repoState.from).toHaveBeenNthCalledWith(2, "pending_orders");
    expect(repoState.from().insert).toHaveBeenCalledWith(
      expect.objectContaining({
        pair: "GBP/USD",
        direction: "LONG",
        order_type: "BUY_STOP", // LONG -> BUY_STOP
        status: "PENDING",
        run_count: 0,
      }),
    );
  });

  test("defaults to SELL_STOP for SHORT when no orderType", async () => {
    repoState.selectResult = { data: [], error: null };
    repoState.insertResult = { error: null };

    await positionsRepository.savePendingOrder({
      pair: "USD/JPY",
      direction: "SHORT",
      setup: "Reversal",
      entry: "139.50",
      stopLoss: "139.90",
      takeProfit1: "138.80",
      reasons: ["Resistance"],
      risks: ["Trend continuation"],
      confidence: 65,
      riskReward: "1:2",
      summary: "Short USD/JPY",
      emaTouch: false,
    } as any);

    expect(repoState.from().insert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_type: "SELL_STOP",
      }),
    );
  });

  test("returns false when pending order with same pair already exists", async () => {
    repoState.selectResult = { data: [{ id: 5 }], error: null };
    repoState.insertResult = { error: null };

    const saved = await positionsRepository.savePendingOrder({
      pair: "GBP/USD",
      direction: "LONG",
      entry: "1.2500",
      stopLoss: "1.2450",
      takeProfit1: "1.2600",
      reasons: [],
      risks: [],
      confidence: 50,
      riskReward: "1:2",
      summary: "Duplicate",
      emaTouch: false,
    } as any);

    expect(saved).toBe(false);
    // insert should NOT have been called
    expect(repoState.from().insert).not.toHaveBeenCalled();
  });

  test("throws on lookup error", async () => {
    repoState.selectResult = { data: [], error: { message: "Connection lost" } };

    await expect(
      positionsRepository.savePendingOrder({
        pair: "EUR/USD",
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0960",
        takeProfit1: "1.1080",
        reasons: [],
        risks: [],
        confidence: 50,
        riskReward: "1:2",
        summary: "err",
        emaTouch: false,
      } as any),
    ).rejects.toThrow("savePendingOrder lookup failed");
  });

  test("throws on insert error", async () => {
    repoState.selectResult = { data: [], error: null };
    repoState.insertResult = { error: { message: "Insert timeout" } };

    await expect(
      positionsRepository.savePendingOrder({
        pair: "EUR/USD",
        direction: "LONG",
        entry: "1.1000",
        stopLoss: "1.0960",
        takeProfit1: "1.1080",
        reasons: [],
        risks: [],
        confidence: 50,
        riskReward: "1:2",
        summary: "err",
        emaTouch: false,
      } as any),
    ).rejects.toThrow("savePendingOrder insert failed");
  });
});

describe("loadPendingOrders", () => {
  const dbRow = {
    id: 10,
    pair: "AUD/USD",
    direction: "LONG",
    setup: "Trend continuation",
    order_type: "BUY_STOP",
    entry: "0.6800",
    stop_loss: "0.6760",
    take_profit_1: "0.6880",
    take_profit_2: "0.6920",
    confidence: 82,
    reasons: ["Bullish flag"],
    risks: ["RSI divergence"],
    primary_timeframe: "H4",
    source_chart_filepath: "/charts/aud.png",
    status: "PENDING" as const,
    run_count: 0,
    expiry_runs: 24,
    created_at: "2026-07-01T12:00:00.000Z",
    resolved_at: null,
    resolved_reason: null,
    triggered_position_id: null,
  };

  test("maps snake_case fields to camelCase", async () => {
    repoState.chainResult = { data: [dbRow], error: null };

    const orders = await positionsRepository.loadPendingOrders();

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 10,
      orderType: "BUY_STOP", // snake_case -> camelCase
      stopLoss: "0.6760",
      takeProfit1: "0.6880",
      primaryTimeframe: "H4",
      expiryRuns: 24,
    });
  });

  test("returns empty array when data is null", async () => {
    repoState.chainResult = { data: null, error: null };

    const orders = await positionsRepository.loadPendingOrders();

    expect(orders).toEqual([]);
  });

  test("throws on query error", async () => {
    repoState.chainResult = { data: null, error: { message: "Query crashed" } };

    await expect(positionsRepository.loadPendingOrders()).rejects.toThrow(
      "loadPendingOrders failed",
    );
  });
});

describe("updatePendingOrder", () => {
  test("sends only fields present in patch", async () => {
    repoState.chainResult = { data: null, error: null };

    await positionsRepository.updatePendingOrder(3, { status: "TRIGGERED" });

    expect(repoState.from).toHaveBeenCalledWith("pending_orders");
    const updatePayload = repoState.from().update.mock.calls[0][0];
    expect(updatePayload).toEqual({ status: "TRIGGERED" });
    expect(updatePayload).not.toHaveProperty("run_count");
    expect(updatePayload).not.toHaveProperty("resolved_at");
    expect(repoState.from().eq).toHaveBeenCalledWith("id", 3);
  });

  test("sends resolved_at and triggered_position_id when provided", async () => {
    repoState.chainResult = { data: null, error: null };

    await positionsRepository.updatePendingOrder(3, {
      status: "RESOLVED",
      resolvedAt: "2026-07-04T10:00:00.000Z",
      resolvedReason: "MOVED_TO_MANUAL",
      triggeredPositionId: 42,
    });

    const updatePayload = repoState.from().update.mock.calls[0][0];
    expect(updatePayload).toMatchObject({
      status: "RESOLVED",
      resolved_at: "2026-07-04T10:00:00.000Z",
      resolved_reason: "MOVED_TO_MANUAL",
      triggered_position_id: 42,
    });
  });

  test("sends run_count when provided", async () => {
    repoState.chainResult = { data: null, error: null };

    await positionsRepository.updatePendingOrder(3, { runCount: 5 });

    const updatePayload = repoState.from().update.mock.calls[0][0];
    expect(updatePayload).toEqual({ run_count: 5 });
  });

  test("throws on update error", async () => {
    repoState.chainResult = { data: null, error: { message: "Update failed" } };

    await expect(positionsRepository.updatePendingOrder(1, { status: "TRIGGERED" })).rejects.toThrow(
      "updatePendingOrder failed",
    );
  });
});

describe("findOpenPositionIdByPair", () => {
  test("returns the id when a match is found", async () => {
    repoState.selectResult = { data: [{ id: 99 }], error: null };

    const id = await positionsRepository.findOpenPositionIdByPair("EUR/USD");

    expect(id).toBe(99);
    expect(repoState.from).toHaveBeenCalledWith("open_positions");
    expect(repoState.from().eq).toHaveBeenCalledWith("status", "open");
    expect(repoState.from().eq).toHaveBeenCalledWith("pair", "EUR/USD");
    expect(repoState.from().order).toHaveBeenCalledWith("opened_at", { ascending: false });
    expect(repoState.from().limit).toHaveBeenCalledWith(1);
  });

  test("returns null when no match", async () => {
    repoState.selectResult = { data: [], error: null };

    const id = await positionsRepository.findOpenPositionIdByPair("EUR/USD");

    expect(id).toBeNull();
  });

  test("throws on query error", async () => {
    repoState.selectResult = { data: [], error: { message: "DB unavailable" } };

    await expect(positionsRepository.findOpenPositionIdByPair("EUR/USD")).rejects.toThrow(
      "findOpenPositionIdByPair failed",
    );
  });
});

describe("loadOpenPositions", () => {
  const dbRow = {
    id: 7,
    pair: "NZD/USD",
    direction: "SHORT",
    setup: "Double top",
    entry: "0.5900",
    stop_loss: "0.5940",
    take_profit_1: "0.5840",
    take_profit_2: "0.5800",
    reasons: ["Resistance at 0.5940"],
    opened_at: "2026-07-02T08:00:00.000Z",
    status: "open" as const,
    last_decision: "HOLD" as const,
    last_decision_confidence: 75,
    last_decision_comment: "Let it breathe",
    last_checked_at: "2026-07-02T10:00:00.000Z",
    closed_at: null,
    trade_stage: "open" as const,
    tp1_close_percent: 50,
    tp1_closed_percent: 0,
    tp1_closed_at: null,
    trailing_stop_loss: null,
    trailing_started_at: null,
    risk_reward_ratio: 2.0,
    tp1_risk_reward_ratio: 1.5,
    tp2_risk_reward_ratio: 2.5,
    min_risk_reward_ratio: 1.5,
    last_management_action: "NONE",
    last_management_comment: null,
    last_management_at: null,
    close_reason: undefined,
    realized_risk_reward_ratio: undefined,
    realized_exit_price: undefined,
  };

  test("maps snake_case fields to camelCase with closeReason defaulting to null", async () => {
    repoState.chainResult = { data: [dbRow], error: null };

    const positions = await positionsRepository.loadOpenPositions();

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      id: 7,
      tradeStage: "open",
      tp1ClosedPercent: 0,
      riskRewardRatio: 2.0,
    });
    // closeReason defaults to null when row.close_reason is undefined
    expect(positions[0].closeReason).toBeNull();
  });

  test("returns empty array when data is null", async () => {
    repoState.chainResult = { data: null, error: null };

    const positions = await positionsRepository.loadOpenPositions();

    expect(positions).toEqual([]);
  });

  test("throws on query error", async () => {
    repoState.chainResult = { data: null, error: { message: "Select error" } };

    await expect(positionsRepository.loadOpenPositions()).rejects.toThrow(
      "loadOpenPositions failed",
    );
  });
});

describe("loadClosedPositions", () => {
  const dbRow = {
    id: 12,
    pair: "EUR/USD",
    direction: "LONG",
    entry: "1.1000",
    stop_loss: "1.0960",
    take_profit_1: "1.1080",
    take_profit_2: "1.1120",
    status: "closed" as const,
    closed_at: "2026-07-03T18:00:00.000Z",
    tp1_closed_percent: 50,
    trailing_stop_loss: "1.1040",
    risk_reward_ratio: 2.0,
    tp1_risk_reward_ratio: 1.5,
    tp2_risk_reward_ratio: 3.0,
    last_management_action: "TP1_PARTIAL",
    close_reason: "stop_loss" as const,
    realized_risk_reward_ratio: 1.0,
    realized_exit_price: "1.1040",
  };

  test("does not call gte when since is not provided", async () => {
    repoState.chainResult = { data: [], error: null };

    await positionsRepository.loadClosedPositions();

    expect(repoState.from).toHaveBeenCalledWith("open_positions");
    expect(repoState.from().eq).toHaveBeenCalledWith("status", "closed");
    expect(repoState.from().order).toHaveBeenCalledWith("closed_at", { ascending: true });
    expect(repoState.from().gte).not.toHaveBeenCalled();
  });

  test("calls gte when since is provided", async () => {
    repoState.chainResult = { data: [], error: null };

    await positionsRepository.loadClosedPositions("2026-07-01T00:00:00.000Z");

    expect(repoState.from().gte).toHaveBeenCalledWith("closed_at", "2026-07-01T00:00:00.000Z");
  });

  test("maps snake_case fields to camelCase", async () => {
    repoState.chainResult = { data: [dbRow], error: null };

    const positions = await positionsRepository.loadClosedPositions();

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      id: 12,
      closedAt: "2026-07-03T18:00:00.000Z",
      riskRewardRatio: 2.0,
      realizedExitPrice: "1.1040",
    });
  });

  test("returns empty array when data is null", async () => {
    repoState.chainResult = { data: null, error: null };

    const positions = await positionsRepository.loadClosedPositions();

    expect(positions).toEqual([]);
  });

  test("throws on query error", async () => {
    repoState.chainResult = { data: null, error: { message: "Query failed" } };

    await expect(positionsRepository.loadClosedPositions()).rejects.toThrow(
      "loadClosedPositions failed",
    );
  });
});
