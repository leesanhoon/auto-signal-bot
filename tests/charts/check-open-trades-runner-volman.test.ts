import { beforeEach, describe, expect, test, vi } from "vitest";

const repository = vi.hoisted(() => ({
  buildPositionManagementPatch: vi.fn(),
  updatePositionDecision: vi.fn(),
  closePosition: vi.fn(),
  loadOpenPositions: vi.fn(),
}));
const telegram = vi.hoisted(() => ({
  buildPositionDecisionMessage: vi.fn(),
  buildPositionClosedMessage: vi.fn(),
}));
const telegramClient = vi.hoisted(() => ({ sendMessage: vi.fn() }));
const decisions = vi.hoisted(() => ({ resolveOpenPositionDecision: vi.fn() }));
const binance = vi.hoisted(() => ({ reconcileBinancePosition: vi.fn() }));
const candles = vi.hoisted(() => ({
  fetchCandleRangeStats: vi.fn(),
  findChartForPair: vi.fn(),
}));

vi.mock("../../src/charts/positions-repository-volman.js", () => repository);
vi.mock("../../src/shared/telegram-volman.js", () => telegram);
vi.mock("../../src/shared/telegram-client.js", () => telegramClient);
vi.mock("../../src/charts/candle-range-stats.js", () => candles);
vi.mock("../../src/charts/volman-charts.config.js", () => ({ CHARTS: [] }));
vi.mock("../../src/charts/position-decision-volman.js", () => decisions);
vi.mock("../../src/charts/binance-execution-volman.js", () => binance);

import {
  processPosition,
  runCheckOpenTrades,
} from "../../src/charts/check-open-trades-runner-volman.js";

const position = {
  id: 1,
  pair: "EUR/USD",
  direction: "LONG" as const,
  setup: "RB",
  entry: "1.1000",
  stopLoss: "1.0960",
  takeProfit1: "1.1080",
  takeProfit2: null,
  reasons: ["test"],
  openedAt: "2026-07-01T00:00:00.000Z",
  status: "open" as const,
  primaryTimeframe: "H1" as const,
  lastDecision: null,
  lastDecisionConfidence: null,
  lastDecisionComment: null,
  lastCheckedAt: null,
  closedAt: null,
  tradeStage: "open" as const,
  riskRewardRatio: 2,
  minRiskRewardRatio: 1.5,
  lastManagementAction: null,
  lastManagementComment: null,
  lastManagementAt: null,
  closeReason: null,
  realizedRiskRewardRatio: null,
  realizedExitPrice: null,
  binanceSymbol: null,
  binanceLeverage: null,
  binanceQuantity: null,
  binanceEntryOrderId: null,
  binanceSlOrderId: null,
  binanceTp1OrderId: null,
  binanceExecutionStatus: null,
  binanceFailureReason: null,
  binanceFailureAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  candles.findChartForPair.mockReturnValue({ symbol: "EUR_USD" });
  candles.fetchCandleRangeStats.mockResolvedValue({
    high: 1.109,
    low: 1.1,
    lastClose: 1.108,
  });
  telegram.buildPositionDecisionMessage.mockReturnValue("decision");
  telegram.buildPositionClosedMessage.mockReturnValue("closed");
  repository.updatePositionDecision.mockResolvedValue(undefined);
  repository.closePosition.mockResolvedValue({
    closeReason: "take_profit",
    realizedExitPrice: "1.1080",
    realizedRiskRewardRatio: 2,
    outcome: "win",
  });
});

describe("check-open-trades-runner-volman", () => {
  test("persists and announces a single-TP close", async () => {
    const decision = {
      decision: "CLOSE" as const,
      confidence: 99,
      comment: "TP reached",
      managementAction: "TAKE_PROFIT_CLOSE" as const,
    };
    decisions.resolveOpenPositionDecision.mockReturnValue(decision);
    repository.buildPositionManagementPatch.mockReturnValue({
      patch: {
        tradeStage: "closed",
        lastManagementAction: "TAKE_PROFIT_CLOSE",
      },
      closePosition: true,
    });

    await processPosition(position as any);

    expect(repository.closePosition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, pair: "EUR/USD" }),
      decision,
      expect.objectContaining({ lastManagementAction: "TAKE_PROFIT_CLOSE" }),
    );
    expect(telegram.buildPositionClosedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, pair: "EUR/USD" }),
      expect.objectContaining({ closeReason: "take_profit" }),
      expect.any(Object),
    );
    expect(telegram.buildPositionDecisionMessage).not.toHaveBeenCalled();
  });

  test("uses Binance reconcile for an executed position", async () => {
    const executed = { ...position, binanceSymbol: "BTCUSDT" };
    binance.reconcileBinancePosition.mockResolvedValue({
      decision: "HOLD",
      confidence: 100,
      comment: "still open",
      managementAction: "NONE",
    });
    repository.buildPositionManagementPatch.mockReturnValue({
      patch: null,
      closePosition: false,
    });

    await processPosition(executed as any);

    expect(binance.reconcileBinancePosition).toHaveBeenCalledWith(executed);
    expect(candles.fetchCandleRangeStats).not.toHaveBeenCalled();
    expect(telegram.buildPositionDecisionMessage).toHaveBeenCalled();
  });

  test("runCheckOpenTrades processes every open position", async () => {
    repository.loadOpenPositions.mockResolvedValue([]);
    await runCheckOpenTrades();
    expect(repository.loadOpenPositions).toHaveBeenCalledTimes(5);
  });
});
