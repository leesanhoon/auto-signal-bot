import { beforeEach, describe, expect, test, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  selectResult: { data: [] as unknown[], error: null as null | { message: string } },
}));

vi.mock("../../src/shared/db.js", () => ({
  getDb: () => ({
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(async () => dbState.selectResult),
        insert: dbState.insert,
        update: dbState.update,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      dbState.insert.mockImplementation(async () => ({ error: null }));
      dbState.update.mockImplementation(() => chain);
      return chain;
    }),
  }),
}));

const repository = await import("../../src/charts/positions-repository-volman.js");
type OpenPosition = import("../../src/charts/positions-repository-volman.js").OpenPosition;

const position: OpenPosition = {
  id: 1,
  pair: "EUR/USD",
  direction: "LONG",
  setup: "RB",
  entry: "1.1000",
  stopLoss: "1.0960",
  takeProfit1: "1.1080",
  takeProfit2: null,
  reasons: ["test"],
  openedAt: "2026-07-01T00:00:00.000Z",
  status: "open",
  primaryTimeframe: "H1",
  lastDecision: null,
  lastDecisionConfidence: null,
  lastDecisionComment: null,
  lastCheckedAt: null,
  closedAt: null,
  tradeStage: "open",
  riskRewardRatio: 2,
  minRiskRewardRatio: 1.5,
  lastManagementAction: "NONE",
  lastManagementComment: null,
  lastManagementAt: null,
  closeReason: null,
  realizedRiskRewardRatio: null,
  realizedExitPrice: null,
  binanceSymbol: "EURUSDT",
  binanceLeverage: 5,
  binanceQuantity: 1,
  binanceEntryOrderId: 10,
  binanceSlOrderId: 11,
  binanceTp1OrderId: 12,
  binanceExecutionStatus: "placed",
  binanceFailureReason: null,
  binanceFailureAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.POSITION_MIN_RISK_REWARD_RATIO = "1.5";
});

describe("charts/positions-repository-volman", () => {
  test("saveOpenPosition writes one TP and no partial-management fields", async () => {
    const saved = await repository.saveOpenPosition({
      pair: "EUR/USD",
      direction: "LONG",
      setup: "RB",
      emaTouch: true,
      reasons: ["test"],
      risks: [],
      confidence: 80,
      entry: "1.1000",
      stopLoss: "1.0960",
      takeProfit1: "1.1080",
      takeProfit2: null,
      riskReward: "1:2",
      summary: "test",
      detectionSource: "deterministic",
      primaryTimeframe: "H1",
    });

    expect(saved).toBe(true);
    const row = dbState.insert.mock.calls[0][0];
    expect(row).toMatchObject({
      take_profit_1: "1.1080",
      take_profit_2: null,
      trade_stage: "open",
    });
    expect(row).not.toHaveProperty("tp1_closed_percent");
    expect(row).not.toHaveProperty("trailing_stop_loss");
  });

  test("management patch closes on the single take profit", () => {
    const result = repository.buildPositionManagementPatch(position, {
      decision: "CLOSE",
      confidence: 100,
      comment: "TP filled",
      managementAction: "TAKE_PROFIT_CLOSE",
    });

    expect(result.closePosition).toBe(true);
    expect(result.patch).toMatchObject({
      tradeStage: "closed",
      lastManagementAction: "TAKE_PROFIT_CLOSE",
    });
  });

  test("closePosition persists close_reason take_profit", async () => {
    const snapshot = await repository.closePosition(position, {
      decision: "CLOSE",
      confidence: 100,
      comment: "TP filled",
      managementAction: "TAKE_PROFIT_CLOSE",
    });

    expect(snapshot).toMatchObject({
      closeReason: "take_profit",
      realizedRiskRewardRatio: 2,
    });
    expect(dbState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "closed",
        close_reason: "take_profit",
        realized_risk_reward_ratio: 2,
      }),
    );
  });

  test("saveBinanceExecutionDetails stores only SL and one TP order id", async () => {
    await repository.saveBinanceExecutionDetails(1, {
      binanceSymbol: "EURUSDT",
      binanceLeverage: 5,
      binanceQuantity: 1,
      binanceEntryOrderId: 10,
      binanceSlOrderId: 11,
      binanceTp1OrderId: 12,
      binanceExecutionStatus: "placed",
    });

    const update = dbState.update.mock.calls[0][0];
    expect(update).toMatchObject({
      binance_sl_order_id: 11,
      binance_tp1_order_id: 12,
    });
    expect(update).not.toHaveProperty("binance_tp2_order_id");
  });
});
