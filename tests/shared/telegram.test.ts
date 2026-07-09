import { describe, expect, test, vi } from "vitest";
import { buildHeartbeatMessage, buildPositionDecisionMessage, sendAllAnalyses, findScreenshotForSetup, buildSmcSignalMessage } from "../../src/shared/telegram.js";
import type { AnalysisResult, TradeSetup, ScreenshotResult } from "../../src/charts/chart-types.js";

describe("shared/telegram", () => {
  test("buildHeartbeatMessage distinguishes manual no-cache heartbeat", () => {
    const message = buildHeartbeatMessage({
      runContext: "manual",
      engineMode: "shadow",
      reason: "no-cache",
      candleKey: "2026-07-03T12:shadow",
    });

    expect(message).toContain("Manual run");
    expect(message).toContain("no-cache");
    expect(message).toContain("Scanner vẫn đang hoạt động bình thường.");
    expect(message).toContain("Last closed candle");
  });

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
          lastPrice: null,
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

  test("sendAllAnalyses can render cached analysis without screenshots buffer", async () => {
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
      confidence: 78,
      entry: "1.1000",
      stopLoss: "1.0980",
      takeProfit1: "1.1040",
      takeProfit2: "1.1080",
      riskReward: "1:2",
      summary: "Cache summary",
      orderType: "BUY_STOP",
    };

    const result: AnalysisResult = {
      summaries: [{ pair: "EUR/USD", trend: "Tăng", status: "OK", confidence: 80 }],
      setups: [setup],
      noSetupReason: "",
      screenshots: [],
    };

    await sendAllAnalyses(result, notifier, { source: "cached", candleKey: "2026-07-03T08:ai" });

    expect(sends.join("\n")).toContain("từ cache");
    expect(sends.join("\n")).toContain("last closed candle");
    expect(sends.join("\n")).toContain("Cache summary");
    expect(notifier.sendPhoto).not.toHaveBeenCalled();
  });

  test("sendAllAnalyses no-setup message includes stats and truncated skip reasons", async () => {
    const sends: string[] = [];
    const notifier = {
      sendMessage: vi.fn(async (message: string) => {
        sends.push(message);
      }),
      sendPhoto: vi.fn(async () => undefined),
    };

    const result: AnalysisResult = {
      summaries: [],
      setups: [],
      noSetupReason: [
        "[XAU/USD] ATR data chua du hoac ngoai khung giao dich hop le",
        "[EUR/USD] ATR data chua du hoac ngoai khung giao dich hop le",
        "[GBP/USD] ATR data chua du hoac ngoai khung giao dich hop le",
        "[USD/JPY] ATR data chua du hoac ngoai khung giao dich hop le",
        "[AUD/USD] ATR data chua du hoac ngoai khung giao dich hop le",
        "[NZD/USD] ATR data chua du hoac ngoai khung giao dich hop le",
        "[USD/CAD] ATR data chua du hoac ngoai khung giao dich hop le",
        "[USD/CHF] ATR data chua du hoac ngoai khung giao dich hop le",
        "[EUR/GBP] ATR data chua du hoac ngoai khung giao dich hop le",
      ].join("\n"),
      analysisStats: {
        attemptedPairs: 8,
        okPairs: 0,
        noSetupPairs: 0,
        skippedPairs: 8,
        setupCount: 0,
      },
      screenshots: [],
    };

    await sendAllAnalyses(result, notifier);

    const fullText = sends.join("\n");

    expect(fullText).toContain("Đã quét/thử *8* cặp");
    expect(fullText).toContain("Attempted: 8 | Summaries: 0 | Skipped: 8 | Setups: 0");
    expect(fullText).toContain("\\[XAU/USD\\] ATR data chua du hoac ngoai khung giao dich hop le");
    expect(fullText).toContain("\\[USD/CHF\\] ATR data chua du hoac ngoai khung giao dich hop le");
    expect(fullText).not.toContain("\\[EUR/GBP\\] ATR data chua du hoac ngoai khung giao dich hop le");
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
      primaryTimeframe: "M15",
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
        {
          symbol: "OANDA:EURUSD",
          timeframe: "M15",
          name: "EUR/USD M15",
          filepath: "/tmp/exact-m15.jpg",
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
          lastPrice: null,
        },
        {
          chart: {
            symbol: "OANDA:EURUSD",
            name: "EUR/USD M15",
            timeframe: "M15",
            interval: "15",
            description: "",
          },
          buffer: exactBuffer,
          filepath: "/tmp/exact-m15.jpg",
          lastPrice: null,
        },
      ],
    };

    await sendAllAnalyses(result, notifier);

    expect(sendPhoto).toHaveBeenCalled();
    const calls = sendPhoto.mock.calls as unknown as Array<[Buffer, string]>;
    expect(calls[0][0]).toBe(exactBuffer);
    expect(calls[0][1]).toContain("OANDA:EURUSD M15");
    expect(calls[0][1]).toContain("Nguồn ảnh: exact-m15.jpg");
    expect(sends.join("\n")).toContain("Buy Stop — lệnh chờ breakout lên vùng entry");
  });

  test("buildSmcSignalMessage renders SMC format and defaults", () => {
    const message = buildSmcSignalMessage({
      pair: "XAUTUSDT",
      direction: "SHORT",
      setup: "SMC_BOS_OB",
      primaryTimeframe: "M15",
      reasons: ["Đa khung đồng thuận", "OB trùng FVG"],
      risks: [],
      confidence: 51,
      entry: "4128.37",
      stopLoss: "4142.51",
      takeProfit1: "4085.95",
      takeProfit2: "4056.61",
      takeProfit3: "3945.50",
      riskReward: "3:1",
      summary: "SMC summary",
      grade: "B",
      score: 51,
      market: "Binance Spot XAUTUSDT",
      sessionLabel: "LONDON (Khung giờ vàng)",
      entryZone: { low: "4128.37", high: "4131.83" },
      stopLossDistance: "$14.14",
      takeProfitAllocations: { tp1: 50, tp2: 30, tp3: 20 },
      liquidityTargets: [
        { label: "EQL", price: "4056.11", target: "TP2", riskReward: "5.1:1" },
        { label: "PWL", price: "3945.00", target: "TP3", riskReward: "11.2:1" },
      ],
      caution: "Thanh khoản thấp ngoài khung giờ vàng có thể gây biến động bất ngờ.",
      capitalManagement: [
        "Risk 1-2% tài khoản cho lệnh này.",
        "Chiến lược chốt lời: 50% tại TP1, 30% tại TP2, 20% tại TP3.",
        "Kéo SL về entry (breakeven) ngay khi chạm TP1 để bảo toàn vốn.",
      ],
      ruleTrace: [],
      detectionSource: "smc",
    } as TradeSetup);

    expect(message).toContain("[SIGNAL] XAUTUSDT - SELL | Grade: B | Score: 51/100");
    expect(message).toContain("Timeframe: M15 | Session: LONDON (Khung giờ vàng)");
    expect(message).toContain("Market: Binance Spot XAUTUSDT");
    expect(message).toContain("[ENTRY] 4128.37");
    expect(message).toContain("Entry Zone: 4128.37 - 4131.83");
    expect(message).toContain("[SL] 4142.51 | SL Distance: $14.14");
    expect(message).toContain("[TP1] 4085.95 | R:R 3:1 | Chốt 50%");
    expect(message).toContain("[TP2] 4056.61 | R:R 5.1:1 | Chốt 30% | EQL 4056.11");
    expect(message).toContain("[TP3] 3945.50 | R:R 11.2:1 | Chốt 20% | PWL 3945.00");
    expect(message).toContain("NHẬN ĐỊNH:");
    expect(message).toContain("QUẢN LÝ VỐN:");
    expect(message).toContain("THẬN TRỌNG:");
  });

  test("buildSmcSignalMessage computes independent R:R per TP when liquidityTargets missing", () => {
    const message = buildSmcSignalMessage({
      pair: "XAUTUSDT",
      direction: "SHORT",
      setup: "SMC_CHOCH_OB",
      primaryTimeframe: "M15",
      reasons: [],
      risks: [],
      confidence: 51,
      entry: "4128.37",
      stopLoss: "4142.51",
      takeProfit1: "4085.95",
      takeProfit2: "4056.61",
      takeProfit3: "3945.50",
      riskReward: "3.0:1",
      summary: "SMC summary",
      grade: "B",
      score: 51,
      takeProfitAllocations: { tp1: 50, tp2: 30, tp3: 20 },
      ruleTrace: [],
      detectionSource: "smc",
    } as TradeSetup);

    expect(message).toContain("[TP1] 4085.95 | R:R 3.0:1");
    expect(message).toContain("[TP2] 4056.61 | R:R 5.1:1");
    expect(message).toContain("[TP3] 3945.50 | R:R 12.9:1");
  });

  test("sendAllAnalyses routes SMC setup to SMC formatter", async () => {
    const sends: string[] = [];
    const notifier = {
      sendMessage: vi.fn(async (message: string) => {
        sends.push(message);
      }),
      sendPhoto: vi.fn(async () => undefined),
    };
    const result: AnalysisResult = {
      summaries: [{ pair: "XAUTUSDT", trend: "Tăng", status: "OK", confidence: 80 }],
      setups: [{
        pair: "XAUTUSDT",
        direction: "SHORT",
        setup: "SMC_BOS_OB",
        reasons: ["Đa khung đồng thuận"],
        risks: [],
        confidence: 80,
        entry: "4128.37",
        stopLoss: "4142.51",
        takeProfit1: "4085.95",
        takeProfit2: "4056.61",
        riskReward: "3:1",
        summary: "SMC summary",
        detectionSource: "smc",
        grade: "B",
        score: 51,
      } as TradeSetup],
      noSetupReason: "",
      screenshots: [],
    };
    await sendAllAnalyses(result, notifier);
    expect(sends.join("\n")).toContain("[SIGNAL] XAUTUSDT - SELL");
    expect(sends.join("\n")).toContain("SMC Multi-Timeframe Scanner");
  });

  test("sendAllAnalyses keeps SMC scanner header on no-setup run when systemLabel is smc", async () => {
    const sends: string[] = [];
    const notifier = {
      sendMessage: vi.fn(async (message: string) => {
        sends.push(message);
      }),
      sendPhoto: vi.fn(async () => undefined),
    };
    const result: AnalysisResult = {
      summaries: [],
      setups: [],
      noSetupReason: "Khong co setup",
      screenshots: [],
    };

    await sendAllAnalyses(result, notifier, { systemLabel: "smc" });

    expect(sends.join("\n")).toContain("SMC Multi-Timeframe Scanner");
    expect(sends.join("\n")).not.toContain("Bob Volman Multi-Timeframe Scanner");
  });

  test("sendAllAnalyses warns when the chart uses a fallback timeframe", async () => {
    const sendPhoto = vi.fn(async () => undefined);
    const sends: string[] = [];
    const notifier = {
      sendMessage: vi.fn(async (message: string) => {
        sends.push(message);
      }),
      sendPhoto,
    };

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
      primaryTimeframe: "M15",
      sourceCharts: [
        {
          symbol: "OANDA:EURUSD",
          timeframe: "H4",
          name: "EUR/USD H4",
          filepath: "/tmp/fallback-h4.jpg",
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
            symbol: "OANDA:EURUSD",
            timeframe: "H4",
            name: "EUR/USD H4",
            interval: "240",
            description: "",
          },
          buffer: Buffer.from("fallback"),
          filepath: "/tmp/fallback-h4.jpg",
          lastPrice: null,
        },
      ],
    };

    await sendAllAnalyses(result, notifier);

    expect(sends.join("\n")).toContain("Ảnh minh họa không đúng khung thời gian gốc (M15)");
  });

  describe("findScreenshotForSetup", () => {
    const mockScreenshot = (filepath: string, symbol: string, timeframe: string): ScreenshotResult => ({
      filepath,
      chart: { symbol, timeframe, name: `${symbol} ${timeframe}`, interval: "0", description: "" },
      buffer: Buffer.from("test"),
      lastPrice: null,
    });

    test("finds exact triple match (filepath + symbol + timeframe)", () => {
      const setup: TradeSetup = {
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Test",
        primaryTimeframe: "H4",
        reasons: [],
        risks: [],
        confidence: 75,
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        riskReward: "1:2",
        summary: "Test",
        sourceCharts: [{ filepath: "/exact/path", symbol: "EUR/USD", timeframe: "H4" }],
      };

      const screenshots = [
        mockScreenshot("/exact/path", "EUR/USD", "H4"),
        mockScreenshot("/other/path", "EUR/USD", "H4"),
      ];

      const { screenshot, usedFallback } = findScreenshotForSetup(setup, screenshots);

      expect(screenshot?.filepath).toBe("/exact/path");
      expect(usedFallback).toBe(false);
    });

    test("falls back to symbol + timeframe when no exact filepath match", () => {
      const setup: TradeSetup = {
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Test",
        primaryTimeframe: "H4",
        reasons: [],
        risks: [],
        confidence: 75,
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        riskReward: "1:2",
        summary: "Test",
        sourceCharts: [{ filepath: "/wrong/path", symbol: "EUR/USD", timeframe: "H4" }],
      };

      const screenshots = [mockScreenshot("/other/path", "EUR/USD", "H4")];

      const { screenshot, usedFallback } = findScreenshotForSetup(setup, screenshots);

      expect(screenshot?.chart.symbol).toBe("EUR/USD");
      expect(screenshot?.chart.timeframe).toBe("H4");
      expect(usedFallback).toBe(false);
    });

    test("prefers timeframe from sourceCharts over other timeframes", () => {
      const setup: TradeSetup = {
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Test",
        primaryTimeframe: "H4",
        reasons: [],
        risks: [],
        confidence: 75,
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        riskReward: "1:2",
        summary: "Test",
        sourceCharts: [{ filepath: "/source", symbol: "EUR/USD", timeframe: "H4" }],
      };

      const screenshots = [
        mockScreenshot("/other1", "EUR/USD", "H4"),
        mockScreenshot("/other2", "EUR/USD", "M15"),
        mockScreenshot("/other3", "GBP/USD", "H4"),
      ];

      const { screenshot, usedFallback } = findScreenshotForSetup(setup, screenshots);

      expect(screenshot?.chart.timeframe).toBe("H4");
      expect(usedFallback).toBe(false);
    });

    test("uses fallback timeframe when preferred not found", () => {
      const setup: TradeSetup = {
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Test",
        reasons: [],
        risks: [],
        confidence: 75,
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        riskReward: "1:2",
        summary: "Test",
        sourceCharts: [{ filepath: "/source", symbol: "EUR/USD", timeframe: "H4" }],
      };

      const screenshots = [mockScreenshot("/other", "EUR/USD", "H1")];

      const { screenshot, usedFallback } = findScreenshotForSetup(setup, screenshots);

      expect(screenshot?.chart.timeframe).toBe("H1");
      expect(usedFallback).toBe(true);
    });

    test("returns undefined screenshot with usedFallback=true when no match found", () => {
      const setup: TradeSetup = {
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Test",
        reasons: [],
        risks: [],
        confidence: 75,
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        riskReward: "1:2",
        summary: "Test",
        sourceCharts: [{ filepath: "/source", symbol: "EUR/USD", timeframe: "H1" }],
      };

      const screenshots = [mockScreenshot("/other", "GBP/JPY", "D1")];

      const { screenshot, usedFallback } = findScreenshotForSetup(setup, screenshots);

      expect(screenshot).toBeUndefined();
      expect(usedFallback).toBe(true);
    });

    test("handles empty sourceCharts array", () => {
      const setup: TradeSetup = {
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Test",
        reasons: [],
        risks: [],
        confidence: 75,
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        riskReward: "1:2",
        summary: "Test",
        sourceCharts: [],
      };

      const screenshots = [mockScreenshot("/any", "EUR/USD", "H1")];

      const { screenshot, usedFallback } = findScreenshotForSetup(setup, screenshots);

      expect(screenshot).toBeDefined();
      expect(usedFallback).toBe(true);
    });

    test("uses telegramChart when sourceCharts not found", () => {
      const setup: TradeSetup = {
        pair: "EUR/USD",
        direction: "LONG",
        setup: "Test",
        primaryTimeframe: "H4",
        reasons: [],
        risks: [],
        confidence: 75,
        entry: "1.1000",
        stopLoss: "1.0980",
        takeProfit1: "1.1040",
        takeProfit2: "1.1080",
        riskReward: "1:2",
        summary: "Test",
        telegramChart: { filepath: "/telegram", symbol: "EUR/USD", timeframe: "H4" },
      };

      const screenshots = [mockScreenshot("/telegram", "EUR/USD", "H4")];

      const { screenshot, usedFallback } = findScreenshotForSetup(setup, screenshots);

      expect(screenshot?.filepath).toBe("/telegram");
      expect(usedFallback).toBe(false);
    });
  });

  describe("buildPositionDecisionMessage with various managementActions", () => {
    test("formats PARTIAL_TP1 action", () => {
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
          reasons: ["Reason 1"],
        },
        {
          decision: "HOLD",
          confidence: 85,
          comment: "Lấy lợi tại TP1",
          managementAction: "PARTIAL_TP1",
          partialClosePercent: 50,
          newStopLoss: null,
        },
      );

      expect(message).toContain("Partial TP1");
      expect(message).toContain("50%");
    });

    test("formats MOVE_SL_TO_BE action", () => {
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
          reasons: ["Reason 1"],
        },
        {
          decision: "HOLD",
          confidence: 85,
          comment: "Chuyển SL về break-even",
          managementAction: "MOVE_SL_TO_BE",
          partialClosePercent: 0,
          newStopLoss: "1.1000",
        },
      );

      expect(message).toContain("dời về breakeven");
      expect(message).toContain("1.1000");
    });

    test("formats TRAIL_SL action", () => {
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
          reasons: ["Reason 1"],
        },
        {
          decision: "HOLD",
          confidence: 85,
          comment: "Trailing stop loss",
          managementAction: "TRAIL_SL",
          partialClosePercent: 0,
          newStopLoss: "1.1020",
        },
      );

      expect(message).toContain("trailing");
      expect(message).toContain("1.1020");
    });

    test("formats TP2_CLOSE action", () => {
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
          reasons: ["Reason 1"],
        },
        {
          decision: "HOLD",
          confidence: 95,
          comment: "Đóng tại TP2",
          managementAction: "TP2_CLOSE",
          partialClosePercent: 100,
          newStopLoss: null,
        },
      );

      expect(message).toContain("TP2");
      expect(message).toContain("95%");
    });

    test("handles undefined managementAction", () => {
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
          reasons: ["Reason 1"],
        },
        {
          decision: "HOLD",
          confidence: 85,
          comment: "Giữ lệnh",
          managementAction: undefined,
          partialClosePercent: 0,
          newStopLoss: null,
        },
      );

      expect(message).toContain("EUR/USD");
      expect(message).toContain("HOLD");
      expect(message).not.toThrow;
    });
  });
});
