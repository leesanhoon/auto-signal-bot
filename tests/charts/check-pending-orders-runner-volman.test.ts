import { beforeEach, describe, expect, test, vi } from "vitest";

const candles = vi.hoisted(() => ({
  fetchCandleRangeStats: vi.fn(),
  findChartForPair: vi.fn(),
}));
const telegramClient = vi.hoisted(() => ({ sendMessage: vi.fn() }));
const decisions = vi.hoisted(() => ({ resolvePendingOrderDecision: vi.fn() }));

vi.mock("../../src/charts/candle-range-stats.js", () => candles);
vi.mock("../../src/shared/notification/telegram-client.js", () => telegramClient);
vi.mock("../../src/charts/volman-charts.config.js", () => ({
  getCharts: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/charts/position-decision-volman.js", () => decisions);

import { reviewPendingOrder } from "../../src/charts/check-pending-orders-runner-volman.js";

const order = {
  id: 5,
  pair: "FLOW/USDT",
  direction: "LONG" as const,
  setup: "RB",
  orderType: "BUY_STOP" as const,
  entry: "1.1000",
  stopLoss: "1.0900",
  takeProfit1: "1.1200",
  takeProfit2: null,
  confidence: 70,
  reasons: ["test"],
  risks: [],
  primaryTimeframe: "H1" as const,
  sourceChartFilepath: null,
  status: "pending" as const,
  runCount: 0,
  expiryRuns: 10,
  createdAt: "2026-07-01T00:00:00.000Z",
  resolvedAt: null,
  resolvedReason: null,
  triggeredPositionId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  candles.findChartForPair.mockReturnValue({ symbol: "BINANCE:FLOWUSDT" });
});

describe("check-pending-orders-runner-volman", () => {
  test("khi fetchCandleRangeStats trả về stats hợp lệ, dùng thẳng để đánh giá", async () => {
    const stats = { high: 1.12, low: 1.08, lastClose: 1.11 };
    candles.fetchCandleRangeStats.mockResolvedValue(stats);
    decisions.resolvePendingOrderDecision.mockReturnValue({
      status: "PENDING",
      confidence: 50,
      comment: "chưa chạm entry",
    });

    const result = await reviewPendingOrder(order as any);

    expect(decisions.resolvePendingOrderDecision).toHaveBeenCalledWith(order, stats);
    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(result.status).toBe("PENDING");
  });

  test("khi fetchCandleRangeStats trả về Error, gửi cảnh báo kèm lý do lỗi và coi như thiếu dữ liệu", async () => {
    candles.fetchCandleRangeStats.mockResolvedValue(
      new Error("Binance API tra ve 429 cho FLOWUSDT: Way too many requests"),
    );
    decisions.resolvePendingOrderDecision.mockReturnValue({
      status: "PENDING",
      confidence: 0,
      comment: "Chưa lấy được OHLC để kiểm tra lệnh chờ, giữ pending.",
    });

    await reviewPendingOrder(order as any);

    expect(decisions.resolvePendingOrderDecision).toHaveBeenCalledWith(order, null);
    expect(telegramClient.sendMessage).toHaveBeenCalledTimes(1);
    const message = telegramClient.sendMessage.mock.calls[0][0] as string;
    expect(message).toContain("Không lấy được OHLC");
    expect(message).toContain("Way too many requests");
  });
});
