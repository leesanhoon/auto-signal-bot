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

const positionsRepository = await import("../../src/charts/positions-repository-smc.js");
const positionEngine = await import("../../src/charts/position-engine-smc.js");

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
});

describe("charts/positions-repository-smc", () => {
  test("saveOpenPosition stores the partial TP and risk-reward metadata", async () => {
    repoState.selectResult = { data: [], error: null };
    repoState.insertResult = { error: null };

    const saved = await positionsRepository.saveOpenPosition({
      pair: "EUR/USD",
      direction: "LONG",
      setup: "RB",
      grade: "A",
      score: 85,
      reasons: ["Supply/demand"],
      risks: ["Lower timeframe rejection"],
      confidence: 82,
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1120",
      takeProfit2: "1.1180",
      riskReward: "1:3",
      summary: "Valid long",
      detectionSource: "smc",
    });

    expect(saved).toBe(true);
    expect(repoState.from).toHaveBeenCalledWith("open_positions_smc");
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
      setup: "Weak",
      grade: "C",
      score: 45,
      reasons: ["weak"],
      risks: ["risk"],
      confidence: 60,
      entry: "1.1000",
      stopLoss: "1.0985",
      takeProfit1: "1.1010",
      takeProfit2: "1.1015",
      riskReward: "1:1",
      summary: "Too weak",
      detectionSource: "smc",
    });

    expect(saved).toBe(false);
    expect(repoState.from).not.toHaveBeenCalled();
  });

  test("saveOpenPosition dedup filters by pair only (no system check)", async () => {
    repoState.selectResult = { data: [], error: null };
    repoState.insertResult = { error: null };

    await positionsRepository.saveOpenPosition({
      pair: "EUR/USD",
      direction: "LONG",
      setup: "RB",
      grade: "A",
      score: 85,
      reasons: ["Supply/demand"],
      risks: ["Lower timeframe rejection"],
      confidence: 82,
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1120",
      takeProfit2: "1.1180",
      riskReward: "1:3",
      summary: "Valid long",
      detectionSource: "smc",
    });

    expect(repoState.from).toHaveBeenCalledWith("open_positions_smc");
    const chain = repoState.from() as any;
    expect(chain.eq.mock.calls).toEqual([
      ["status", "open"],
      ["pair", "EUR/USD"],
    ]);
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

    expect(repoState.from).toHaveBeenCalledWith("open_positions_smc");
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
      setup: "RB",
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1080",
      takeProfit2: "1.1120",
      reasons: ["Supply/demand"],
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
      closeReason: null,
      realizedRiskRewardRatio: null,
      realizedExitPrice: null,
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
        setup: "RB",
        entry: "1.1000",
        stopLoss: "1.1000",
        takeProfit1: "1.1080",
        takeProfit2: "1.1120",
        reasons: ["Supply/demand"],
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

    expect(repoState.from).toHaveBeenCalledWith("open_positions_smc");
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
      setup: "RB",
      entry: "1.2500",
      stopLoss: "1.2450",
      takeProfit1: "1.2600",
      takeProfit2: "1.2650",
      reasons: ["Supply/demand"],
      risks: ["News risk"],
      confidence: 78,
      riskReward: "1:2",
      summary: "Long GBP/USD",
      grade: "A",
      score: 80,
      detectionSource: "smc",
    } as any);

    expect(saved).toBe(true);
    expect(repoState.from).toHaveBeenNthCalledWith(1, "pending_orders_smc");
    expect(repoState.from().select).toHaveBeenCalledWith("id");
    expect(repoState.from().eq).toHaveBeenCalledWith("status", "PENDING");
    expect(repoState.from().limit).toHaveBeenCalledWith(1);
    expect(repoState.from).toHaveBeenNthCalledWith(2, "pending_orders_smc");
    expect(repoState.from().insert).toHaveBeenCalledWith(
      expect.objectContaining({
        pair: "GBP/USD",
        direction: "LONG",
        order_type: "BUY_STOP",
        status: "PENDING",
        run_count: 0,
      }),
    );
  });
});
