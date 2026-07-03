import { describe, expect, test, vi } from "vitest";
import { buildPositionDecisionMessage, sendAllAnalyses } from "../../src/shared/telegram.js";
import type { AnalysisResult, TradeSetup } from "../../src/charts/chart-types.js";

describe("shared/telegram", () => {
  test("buildPositionDecisionMessage labels original reasons compactly", () => {
    const message = buildPositionDecisionMessage(
      {
        id: 1,
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Breakout",
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        reasons: ["Lý do 1", "Lý do 2", "Lý do 3"],
      },
      {
        decision: "HOLD",
        confidence: 88,
        comment: "Giữ lệnh",
        managementAction: "NONE",
        partialClosePercent: 0,
        newStopLoss: null,
      },
    );

    expect(message).toContain("*Lý do gốc khi mở lệnh:*");
    expect(message).toContain("Lý do 1");
    expect(message).toContain("Lý do 2");
    expect(message).not.toContain("Lý do 3");
  });

  test("sendAllAnalyses shows order type and pending wording in Telegram output", async () => {
    const sends: string[] = [];
    const notifier = {
      sendMessage: vi.fn(async (message: string) => {
        sends.push(message);
      }),
      sendPhoto: vi.fn(async () => undefined),
    };

    const setup: TradeSetup = {
      pair: "EUR/USD",
      direction: "LONG",
      setup: "Breakout",
      reasons: ["EMA 20 hỗ trợ"],
      risks: ["Nến giả phá"],
      confidence: 75,
      entry: "1.1000",
      stopLoss: "1.0980",
      takeProfit1: "1.1040",
      takeProfit2: "1.1080",
      riskReward: "1:2",
      summary: "Chờ breakout rõ ràng",
      orderType: "BUY_STOP",
      entryCondition: "Chỉ vào khi phá lên 1.1000",
      currentPriceContext: "Giá hiện tại vẫn nằm dưới entry",
      verifiedConfirmed: true,
    };

    const result: AnalysisResult = {
      summaries: [{ pair: "EUR/USD", trend: "Tăng", status: "OK", confidence: 92 }],
      setups: [setup],
      noSetupReason: "",
      screenshots: [],
    };

    await sendAllAnalyses(result, notifier);

    expect(sends.join("\n")).toContain("Lọc còn *1* cặp đạt ngưỡng");
    expect(sends.join("\n")).toContain("Buy Stop — lệnh chờ breakout lên vùng entry");
    expect(sends.join("\n")).toContain("Điều kiện vào");
    expect(sends.join("\n")).toContain("trigger/pending");
    expect(sends.join("\n")).toContain("ℹ️ Nếu đây là lệnh chờ, chỉ vào khi giá khớp đúng điều kiện trên.");
  });

  test("sendAllAnalyses filters out setups below confidence threshold", async () => {
    const sends: string[] = [];
    const photos: string[] = [];
    const notifier = {
      sendMessage: vi.fn(async (message: string) => {
        sends.push(message);
      }),
      sendPhoto: vi.fn(async (_buffer: Buffer, caption: string) => {
        photos.push(caption);
      }),
    };

    const baseSetup = {
      pair: "EUR/USD",
      direction: "LONG" as const,
      setup: "Breakout",
      reasons: ["EMA 20 hỗ trợ"],
      risks: ["Nến giả phá"],
      entry: "1.1000",
      stopLoss: "1.0980",
      takeProfit1: "1.1040",
      takeProfit2: "1.1080",
      riskReward: "1:2",
      summary: "Chờ breakout rõ ràng",
      orderType: "BUY_STOP" as const,
      entryCondition: "Chỉ vào khi phá lên 1.1000",
      currentPriceContext: "Giá hiện tại vẫn nằm dưới entry",
      verifiedConfirmed: true,
    };

    const result: AnalysisResult = {
      summaries: [
        { pair: "EUR/USD", trend: "Tăng", status: "OK", confidence: 68 },
        { pair: "GBP/USD", trend: "Giảm", status: "OK", confidence: 81 },
      ],
      setups: [
        { ...baseSetup, pair: "EUR/USD", confidence: 69 },
        { ...baseSetup, pair: "GBP/USD", confidence: 82 },
      ],
      noSetupReason: "",
      screenshots: [
        {
          chart: {
            symbol: "GBPUSD",
            name: "GBP/USD H4",
            timeframe: "H4",
            interval: "240",
            description: "",
          },
          buffer: Buffer.from("gbp"),
          filepath: "/tmp/gbp-h4.jpg",
        },
      ],
    };

    await sendAllAnalyses(result, notifier);

    const fullText = sends.join("\n");
    expect(fullText).toContain("Lọc còn *1* cặp đạt ngưỡng");
    expect(fullText).toContain("GBP/USD");
    expect(fullText).not.toContain("EUR/USD — LONG");
    expect(photos).toHaveLength(1);
  });

  test("sendAllAnalyses prefers exact provenance over fuzzy screenshot matching", async () => {
    const sendPhoto = vi.fn(async () => undefined);
    const sends: string[] = [];
    const notifier = {
      sendMessage: vi.fn(async (message: string) => {
        sends.push(message);
      }),
      sendPhoto,
    };

    const exactBuffer = Buffer.from("exact-chart");
    const fallbackBuffer = Buffer.from("fallback-chart");
    const setup: TradeSetup = {
      pair: "EUR/USD",
      direction: "LONG",
      setup: "Breakout",
      reasons: ["EMA 20 hỗ trợ"],
      risks: ["Nến giả phá"],
      confidence: 92,
      entry: "1.1000",
      stopLoss: "1.0980",
      takeProfit1: "1.1040",
      takeProfit2: "1.1080",
      riskReward: "1:2",
      summary: "Chờ breakout rõ ràng",
      orderType: "BUY_STOP",
      entryCondition: "Chỉ vào khi phá lên 1.1000",
      currentPriceContext: "Giá hiện tại vẫn nằm dưới entry",
      verifiedConfirmed: true,
      telegramChart: {
        symbol: "OANDA:EURUSD",
        timeframe: "H4",
        name: "EUR/USD H4",
        filepath: "/tmp/old.jpg",
      },
      sourceCharts: [
        {
          symbol: "OANDA:EURUSD",
          timeframe: "H4",
          name: "EUR/USD H4",
          filepath: "/tmp/old.jpg",
        },
      ],
    };

    const result: AnalysisResult = {
      summaries: [{ pair: "EUR/USD", trend: "Tăng", status: "OK", confidence: 92 }],
      setups: [setup],
      noSetupReason: "",
      screenshots: [
        {
          chart: {
            symbol: "OANDA:EURUSDX",
            name: "EUR/USD H4",
            timeframe: "H4",
            interval: "240",
            description: "",
          },
          buffer: fallbackBuffer,
          filepath: "/tmp/fallback.jpg",
        },
        {
          chart: {
            symbol: "OANDA:EURUSD",
            name: "EUR/USD H4",
            timeframe: "H4",
            interval: "240",
            description: "",
          },
          buffer: exactBuffer,
          filepath: "/tmp/exact.jpg",
        },
      ],
    };

    await sendAllAnalyses(result, notifier);

    expect(sendPhoto).toHaveBeenCalled();
    const calls = sendPhoto.mock.calls as unknown as Array<[Buffer, string]>;
    expect(calls[0][0]).toBe(exactBuffer);
    expect(calls[0][1]).toContain("OANDA:EURUSD H4");
    expect(calls[0][1]).toContain("Nguồn ảnh: exact.jpg");
    expect(sends.join("\n")).toContain("Buy Stop — lệnh chờ breakout lên vùng entry");
  });
});
