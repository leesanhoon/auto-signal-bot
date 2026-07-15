import { describe, test, expect, vi } from "vitest";

const shouldFailRender = vi.hoisted(() => ({ value: false }));

vi.mock("../../src/charts/setup-chart-renderer.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/charts/setup-chart-renderer.js")>();
  return {
    ...actual,
    renderSetupChartsBatch: vi.fn(async (...args: Parameters<typeof actual.renderSetupChartsBatch>) => {
      if (shouldFailRender.value) {
        throw new Error("browserType.launch: Executable doesn't exist at /fake/chromium");
      }
      return actual.renderSetupChartsBatch(...args);
    }),
  };
});

const notifyErrorMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../src/shared/notification/telegram-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/shared/notification/telegram-client.js")>();
  return { ...actual, notifyError: notifyErrorMock };
});

import {
  sendAllAnalysesVolman,
  buildPositionClosedMessage,
  buildPositionDecisionMessage,
  buildBreakevenReminderMessage,
} from "../../src/shared/telegram-volman.js";
import type {
  AnalysisResult,
  TradeSetup,
} from "../../src/charts/chart-types-volman.js";
import type { Notifier } from "../../src/shared/notifier.js";

function createMockNotifier(): Notifier & { sentMessages: string[] } {
  const sentMessages: string[] = [];
  return {
    sentMessages,
    sendMessage: vi.fn(async (text: string) => {
      sentMessages.push(text);
    }),
    sendPhoto: vi.fn(async () => {}),
    sendDocument: vi.fn(async () => {}),
  };
}

const minimalSetup: TradeSetup = {
  pair: "EURUSD",
  direction: "LONG",
  setup: "RB",
  reasons: ["Reason A", "Reason B"],
  risks: ["Risk A"],
  confidence: 85,
  entry: "1.1000",
  stopLoss: "1.0950",
  takeProfit1: "1.1100",
  takeProfit2: null,
  riskReward: "1:2",
  summary: "Test summary",
};

const result: AnalysisResult = {
  summaries: [{ pair: "EURUSD", trend: "up", status: "ok", confidence: 85 }],
  setups: [minimalSetup],
  noSetupReason: "",
};

describe("sendAllAnalysesVolman", () => {
  test("calls sendPhoto before sendMessage for setup with chartContext", async () => {
    const setupWithChart: TradeSetup = {
      ...minimalSetup,
      chartContext: {
        candles: [],
        ma21: [],
        triggerIndex: 10,
        sliceStartIndex: 0,
        geometry: {
          boxes: [],
          markers: [],
        },
      },
    };

    const resultWithChart: AnalysisResult = {
      ...result,
      setups: [setupWithChart],
    };

    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(resultWithChart, mockNotifier);

    expect(mockNotifier.sendPhoto).toHaveBeenCalled();

    // Verify actual call ORDER, not just that both were called — sendPhoto must fire
    // before the specific sendMessage call carrying this setup's text (there's also a
    // header and footer sendMessage call, so match by content rather than assuming
    // "last call" is the setup's).
    const sendMessageMock = vi.mocked(mockNotifier.sendMessage).mock;
    const setupMessageCallIndex = sendMessageMock.calls.findIndex(
      (call) => call[0].includes("EURUSD") && call[0].includes("LONG"),
    );
    expect(setupMessageCallIndex).toBeGreaterThanOrEqual(0);
    const setupMessageOrder = sendMessageMock.invocationCallOrder[setupMessageCallIndex];
    const sendPhotoOrder = vi.mocked(mockNotifier.sendPhoto).mock.invocationCallOrder[0];
    expect(sendPhotoOrder).toBeLessThan(setupMessageOrder);
  });

  test("does not call sendPhoto for setup without chartContext", async () => {
    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(result, mockNotifier);
    expect(mockNotifier.sendPhoto).not.toHaveBeenCalled();
  });

  test("shows the scanned timeframe from deliveryContext.timeframe in the header", async () => {
    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(result, mockNotifier, { timeframe: "M15" });

    const headerMessage = mockNotifier.sentMessages.find((msg) =>
      msg.includes("Bob Volman Multi-Timeframe Scanner"),
    );
    expect(headerMessage).toBeDefined();
    expect(headerMessage).toContain("[M15]");
  });

  test("falls back to a setup's primaryTimeframe when deliveryContext.timeframe is not given", async () => {
    const setupWithTimeframe: TradeSetup = { ...minimalSetup, primaryTimeframe: "H1" };
    const resultWithTimeframe: AnalysisResult = { ...result, setups: [setupWithTimeframe] };

    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(resultWithTimeframe, mockNotifier);

    const headerMessage = mockNotifier.sentMessages.find((msg) =>
      msg.includes("Bob Volman Multi-Timeframe Scanner"),
    );
    expect(headerMessage).toBeDefined();
    expect(headerMessage).toContain("[H1]");
  });

  test("setup message has no consecutive blank lines when optional fields are absent", async () => {
    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(result, mockNotifier);

    const setupMessage = mockNotifier.sentMessages.find(
      (msg) => msg.includes("EURUSD") && msg.includes("LONG")
    );
    expect(setupMessage).toBeDefined();
    expect(setupMessage).not.toContain("\n\n\n");
  });

  test("hides empty risks and formats candle/cache times in Vietnam timezone", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-07-13T20:07:00.000Z"),
    );
    const resultWithEmptyRisks: AnalysisResult = {
      ...result,
      setups: [{ ...minimalSetup, risks: [], primaryTimeframe: "M15" }],
    };
    const mockNotifier = createMockNotifier();

    try {
      await sendAllAnalysesVolman(resultWithEmptyRisks, mockNotifier, {
        source: "cached",
        candleKey: "2026-07-13T20:00:deterministic:single:M15",
        timeframe: "M15",
      });
    } finally {
      nowSpy.mockRestore();
    }

    const headerMessage = mockNotifier.sentMessages[0];
    const setupMessage = mockNotifier.sentMessages.find(
      (msg) => msg.includes("EURUSD") && msg.includes("LONG"),
    );
    expect(headerMessage).toContain(
      "Dữ liệu phân tích lấy từ cache của nến đóng lúc *03:00 14/07 giờ VN*",
    );
    expect(headerMessage).not.toContain("deterministic:single:M15");
    expect(setupMessage).toContain(
      "Nến gốc [M15] đóng: 03:00 14/07 giờ VN (7 phút trước)",
    );
    expect(setupMessage).not.toContain("Rủi ro cần lưu ý");
  });

  test("setup message still contains all required trading data", async () => {
    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(result, mockNotifier);

    const setupMessage = mockNotifier.sentMessages.find(
      (msg) => msg.includes("EURUSD") && msg.includes("LONG")
    );
    expect(setupMessage).toBeDefined();
    expect(setupMessage).toContain("EURUSD");
    expect(setupMessage).toContain("LONG");
    expect(setupMessage).toContain("RB");
    expect(setupMessage).toContain(
      "Range Break — vùng phạm vi (EMA21 phẳng), nén chặt sát biên rồi phá vỡ",
    );
    expect(setupMessage).toContain("1.1000");
    expect(setupMessage).toContain("1.0950");
    expect(setupMessage).toContain("1.1100");
    expect(setupMessage).toContain("TP        : 1.1100 (2R)");
    expect(setupMessage).not.toContain("TP1");
    expect(setupMessage).not.toContain("TP2");
    expect(setupMessage).toContain("1:2");
    expect(setupMessage).toContain("Reason A");
    expect(setupMessage).toContain("Reason B");
    expect(setupMessage).toContain("Risk A");
    expect(setupMessage).toContain("Test summary");
  });

  test("setup message contains no chart-image wording", async () => {
    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(result, mockNotifier);

    const setupMessage = mockNotifier.sentMessages.find(
      (msg) => msg.includes("EURUSD") && msg.includes("LONG")
    );
    expect(setupMessage).toBeDefined();
    expect(setupMessage).not.toContain("Ảnh minh họa");
    expect(setupMessage).not.toContain("Nguồn ảnh");
  });

  test("header message collapses stats into one line and drops the long disclaimer paragraph", async () => {
    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(result, mockNotifier);

    const headerMessage = mockNotifier.sentMessages[0];
    expect(headerMessage).toBeDefined();
    expect(headerMessage).not.toContain(
      "Scanner luôn phân tích theo last closed candle"
    );

    const lines = headerMessage.split("\n");
    const quetLine = lines.find((line) => line.includes("Quét"));
    expect(quetLine).toBeDefined();
    expect(quetLine).toContain("đạt ngưỡng");
  });

  test("footer message is a single short line", async () => {
    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(result, mockNotifier);

    const footerMessage = mockNotifier.sentMessages[mockNotifier.sentMessages.length - 1];
    expect(footerMessage).toBeDefined();
    expect(footerMessage).not.toContain("\n\n");
    expect(footerMessage).toContain("Xong");
  });

  test("sendMessage is called even if sendPhoto fails", async () => {
    const setupWithChart: TradeSetup = {
      ...minimalSetup,
      chartContext: {
        candles: [],
        ma21: [],
        triggerIndex: 10,
        sliceStartIndex: 0,
        geometry: {
          boxes: [],
          markers: [],
        },
      },
    };

    const resultWithChart: AnalysisResult = {
      ...result,
      setups: [setupWithChart],
    };

    const mockNotifier = createMockNotifier();
    mockNotifier.sendPhoto = vi.fn(async () => {
      throw new Error("Photo send failed");
    });

    await sendAllAnalysesVolman(resultWithChart, mockNotifier);

    expect(mockNotifier.sendPhoto).toHaveBeenCalled();
    expect(mockNotifier.sendMessage).toHaveBeenCalled();
    const setupMsg = mockNotifier.sentMessages.find(
      (msg) => msg.includes("EURUSD") && msg.includes("LONG")
    );
    expect(setupMsg).toBeDefined();
  });

  test("sendMessage always called for each setup regardless of chartContext", async () => {
    const setupWithoutChart: TradeSetup = minimalSetup;
    const setupWithChart: TradeSetup = {
      ...minimalSetup,
      pair: "GBPUSD",
      chartContext: {
        candles: [],
        ma21: [],
        triggerIndex: 10,
        sliceStartIndex: 0,
      },
    };

    const resultMixed: AnalysisResult = {
      ...result,
      setups: [setupWithoutChart, setupWithChart],
    };

    const mockNotifier = createMockNotifier();
    await sendAllAnalysesVolman(resultMixed, mockNotifier);

    const eurusdMsg = mockNotifier.sentMessages.find(
      (msg) => msg.includes("EURUSD")
    );
    const gbpusdMsg = mockNotifier.sentMessages.find(
      (msg) => msg.includes("GBPUSD")
    );

    expect(eurusdMsg).toBeDefined();
    expect(gbpusdMsg).toBeDefined();
    expect(mockNotifier.sendPhoto).toHaveBeenCalledTimes(1);
  });

  test("gửi notifyError kèm diagnostics khi renderSetupChartsBatch throw", async () => {
    const setupWithChart: TradeSetup = {
      ...minimalSetup,
      chartContext: {
        candles: [],
        ma21: [],
        triggerIndex: 10,
        sliceStartIndex: 0,
        geometry: { boxes: [], markers: [] },
      },
    };
    const resultWithChart: AnalysisResult = { ...result, setups: [setupWithChart] };
    const mockNotifier = createMockNotifier();

    shouldFailRender.value = true;
    try {
      await sendAllAnalysesVolman(resultWithChart, mockNotifier);
    } finally {
      shouldFailRender.value = false;
    }

    expect(notifyErrorMock).toHaveBeenCalledTimes(1);
    const [scope, message] = notifyErrorMock.mock.calls[0];
    expect(scope).toBe("Render chart batch (Volman)");
    expect(String(message)).toContain("Executable doesn't exist");
    expect(String(message)).toContain("PLAYWRIGHT_BROWSERS_PATH=");
    // Fallback to text-only must still happen — the setup message is still sent.
    expect(mockNotifier.sentMessages.some((m) => m.includes("EURUSD"))).toBe(true);
  });
});

describe("buildPositionClosedMessage", () => {
  test("renders a win outcome with green emoji and correct R-multiple", () => {
    const position = {
      id: 1,
      pair: "EUR/USD",
      direction: "LONG" as const,
      setup: "Breakout",
      entry: "1.1000",
      openedAt: "2026-07-01T12:00:00.000Z",
    };

    const snapshot = {
      closeReason: "take_profit",
      realizedExitPrice: "1.1200",
      realizedRiskRewardRatio: 2,
      outcome: "win" as const,
    };

    const message = buildPositionClosedMessage(position, snapshot);

    expect(message).toContain("🏁 *Vị thế #1 đã đóng*");
    expect(message).toContain("EUR/USD LONG");
    expect(message).toContain("📋 Breakout");
    expect(message).toContain("🟢 *THẮNG* — 2R");
    expect(message).toContain("Lý do: Chạm Take Profit");
    expect(message).toContain("Entry: 1.1000 → Exit: 1.1200");
    expect(message).toContain("Đã mở: 2026-07-01T12:00:00.000Z");
  });

  test("renders a loss outcome with red emoji and correct R-multiple", () => {
    const position = {
      id: 2,
      pair: "GBP/USD",
      direction: "SHORT" as const,
      setup: null,
      entry: "1.2000",
      openedAt: null,
    };

    const snapshot = {
      closeReason: "stop_loss",
      realizedExitPrice: "1.2100",
      realizedRiskRewardRatio: -0.5,
      outcome: "loss" as const,
    };

    const message = buildPositionClosedMessage(position, snapshot);

    expect(message).toContain("🏁 *Vị thế #2 đã đóng*");
    expect(message).toContain("GBP/USD SHORT");
    expect(message).toContain("🔴 *THUA* — -0.5R");
    expect(message).toContain("Lý do: Chạm Stop Loss");
    expect(message).toContain("Entry: 1.2000 → Exit: 1.2100");
    // Setup and openedAt are null/empty, should be filtered out
    expect(message).not.toContain("📋");
    expect(message).not.toContain("Đã mở");
  });

  test("renders a breakeven outcome with white emoji", () => {
    const position = {
      id: 3,
      pair: "USD/JPY",
      direction: "LONG" as const,
      setup: "Block Break",
      entry: "149.00",
      openedAt: "2026-07-02T08:00:00.000Z",
    };

    const snapshot = {
      closeReason: "manual_close",
      realizedExitPrice: "149.00",
      realizedRiskRewardRatio: 0,
      outcome: "breakeven" as const,
    };

    const message = buildPositionClosedMessage(position, snapshot);

    expect(message).toContain("⚪ *HOÀ VỐN* — 0R");
    expect(message).toContain("Lý do: Đóng thủ công (tín hiệu đảo chiều)");
  });

  test("omits empty optional lines (setup and openedAt)", () => {
    const position = {
      id: 4,
      pair: "AUD/USD",
      direction: "SHORT" as const,
      setup: null,
      entry: "0.6500",
      openedAt: null,
    };

    const snapshot = {
      closeReason: "take_profit_2",
      realizedExitPrice: "0.6400",
      realizedRiskRewardRatio: 1.5,
      outcome: "win" as const,
    };

    const message = buildPositionClosedMessage(position, snapshot);

    // Verify no consecutive blank lines
    expect(message).not.toContain("\n\n");
    // Verify optional fields are not present
    expect(message).not.toContain("📋");
    expect(message).not.toContain("Đã mở");
  });

  test("overrides the close-reason label for a fail-safe close instead of showing 'manual close'", () => {
    const position = {
      id: 5,
      pair: "BTC/USDT",
      direction: "LONG" as const,
      setup: "Market",
      entry: "50000",
      openedAt: null,
    };

    // A fail-safe emergency close is stored with the generic "manual_close"
    // bucket (see positions-repository-volman.ts closeReason derivation) —
    // the Telegram label must not repeat that misleading generic bucket.
    const snapshot = {
      closeReason: "manual_close",
      realizedExitPrice: "49000",
      realizedRiskRewardRatio: -1,
      outcome: "loss" as const,
    };

    const message = buildPositionClosedMessage(position, snapshot, {
      isFailSafeClose: true,
    });

    expect(message).toContain(
      "Lý do: Đóng khẩn cấp do lỗi thực thi trên sàn (fail-safe)",
    );
    expect(message).not.toContain("Đóng thủ công (tín hiệu đảo chiều)");
  });
});

describe("buildBreakevenReminderMessage", () => {
  test("renders a breakeven reminder with pair, direction, and entry", () => {
    const message = buildBreakevenReminderMessage(
      {
        id: 7,
        pair: "EUR/USD",
        direction: "LONG",
        setup: "RB",
        entry: "1.1000",
      },
      "Giá đã đạt 1R (1.1040) — dời SL về entry 1.1000.",
    );

    expect(message).toContain("#7");
    expect(message).toContain("EUR/USD");
    expect(message).toContain("LONG");
    expect(message).toContain("1R");
    expect(message).toContain("1.1000");
  });
});

describe("buildPositionDecisionMessage", () => {
  test("renders one TP line and omits the legacy TP2 display", () => {
    const message = buildPositionDecisionMessage(
      {
        id: 6,
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Range Break",
        entry: "1.1000",
        stopLoss: "1.0950",
        takeProfit1: "1.1100",
        takeProfit2: null,
        reasons: ["EMA21 đang đi ngang, phù hợp bối cảnh Range"],
      },
      {
        decision: "HOLD",
        confidence: 85,
        comment: "Tiếp tục giữ theo kế hoạch.",
        managementAction: "NONE",
      },
    );

    expect(message).toContain("TP: 1.1100");
    expect(message).not.toContain("TP1:");
    expect(message).not.toContain("TP2:");
  });
});
