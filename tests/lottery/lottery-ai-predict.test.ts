import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  call: vi.fn(),
  record: vi.fn(),
}));

vi.mock("../../src/shared/openrouter.js", () => ({ callOpenRouter: state.call }));
vi.mock("../../src/shared/ai-usage.js", () => ({ recordOpenRouterUsage: state.record }));

const lotteryAiPredict = await import("../../src/lottery/lottery-ai-predict.js");

describe("lottery/lottery-ai-predict", () => {
  beforeEach(() => {
    state.call.mockReset();
    state.record.mockReset();
    process.env.AI_TEXT_MODEL = "deepseek/deepseek-v4-pro";
  });

  test("predictTopNumbersAI parses, sorts, and dedupes AI predictions", async () => {
    state.call.mockResolvedValueOnce({
      text: '```json\n{"predictions":[{"number":"123","hundredsDigit":"1","tensDigit":"2","unitsDigit":"3","confidence":0.7,"reason":"ra nhiều lần"},{"number":"123","hundredsDigit":"1","tensDigit":"2","unitsDigit":"3","confidence":0.9,"reason":"trùng nhưng cao hơn"},{"number":"456","hundredsDigit":"4","tensDigit":"5","unitsDigit":"6","confidence":0.4,"reason":"xuất hiện gần đây"},{"number":"7a8","hundredsDigit":"7","tensDigit":"a","unitsDigit":"8","confidence":0.8,"reason":"bị lọc"}]}\n```',
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const records = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac" as const,
        province: "Hà Nội",
        prizes: {
          db: "00123",
          g1: "00456",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    const result = await lotteryAiPredict.predictTopNumbersAI(records, "mien-bac", 3, 2);

    expect(result).toEqual([
      { number: "123", confidence: 0.5, reason: "ra nhiều lần", hundredsDigit: "1", tensDigit: "2", unitsDigit: "3" },
      { number: "456", confidence: 0.5, reason: "xuất hiện gần đây", hundredsDigit: "4", tensDigit: "5", unitsDigit: "6" },
    ]);
    expect(state.record).toHaveBeenCalledTimes(1);
    expect(state.call.mock.calls[0][0].systemPrompt).toContain("Miền Bắc");
    expect(state.call.mock.calls[0][0].userContent[0].text).toContain("2026-07-01");
    expect(state.call.mock.calls[0][0].userContent[0].text).toContain("Hà Nội");
    expect(state.call.mock.calls[0][0].userContent[0].text).toContain("Hàng trăm");
    expect(state.call.mock.calls[0][0].userContent[0].text).toContain("Hàng chục");
    expect(state.call.mock.calls[0][0].userContent[0].text).toContain("Hàng đơn vị");
    expect(state.call.mock.calls[0][0].responseFormat).toEqual({ type: "json_object" });
    expect(state.call.mock.calls[0][0].reasoning).toEqual({ effort: "medium" });
  });

  test("predictTopNumbersAI throws when AI returns no valid numbers", async () => {
    state.call.mockResolvedValueOnce({
      text: '{"predictions":[{"number":"abc","hundredsDigit":"a","tensDigit":"b","unitsDigit":"c","confidence":99,"reason":"invalid"}]}',
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    await expect(
      lotteryAiPredict.predictTopNumbersAI(
        [
          {
            date: "2026-07-01",
            weekday: 3,
            region: "mien-bac" as const,
            province: "Hà Nội",
            prizes: {
              db: "00123",
              g1: "00456",
              g2: [],
              g3: [],
              g4: [],
              g5: [],
              g6: [],
              g7: [],
              g8: [],
            },
          },
        ],
        "mien-bac",
        3,
        3,
      ),
    ).rejects.toThrow("AI trả về 0 số hợp lệ");
  });

  test("predictTopNumbersAI throws when history is empty", async () => {
    await expect(lotteryAiPredict.predictTopNumbersAI([], "mien-bac", 3, 3)).rejects.toThrow(
      "Không có dữ liệu lịch sử để dự đoán",
    );
    expect(state.call).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  test("computeDigitPositionStats counts digits per position correctly", () => {
    const records = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac" as const,
        province: "Hà Nội",
        prizes: {
          db: "00123",
          g1: "00456",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    const stats = lotteryAiPredict.computeDigitPositionStats(records);

    // extractNums from prizes gives ["123", "456"]
    // hundreds: 1→1, 4→1  tens: 2→1, 5→1  units: 3→1, 6→1
    expect(stats.hundreds[0].digit).toBe("1");
    expect(stats.hundreds[0].count).toBe(1);
    expect(stats.hundreds[1].digit).toBe("4");
    expect(stats.hundreds[1].count).toBe(1);

    expect(stats.tens[0].digit).toBe("2");
    expect(stats.tens[0].count).toBe(1);

    expect(stats.units[0].digit).toBe("3");
    expect(stats.units[0].count).toBe(1);
  });

  test("computeDigitPositionStats handles multiple records and deduped numbers", () => {
    const records = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac" as const,
        province: "Hà Nội",
        prizes: {
          db: "00123",    // → 123  (h=1,t=2,u=3)
          g1: "00123",    // → 123  (deduped by extractNums)
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
      {
        date: "2026-07-08",
        weekday: 3,
        region: "mien-bac" as const,
        province: "Hà Nội",
        prizes: {
          db: "00123",    // → 123 (same number, different date)
          g1: "00789",    // → 789  (h=7,t=8,u=9)
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    const stats = lotteryAiPredict.computeDigitPositionStats(records);

    // extractNums per record:
    // record 1: ["123"] (00123 deduped)
    // record 2: ["123", "789"]
    // total: 3 numbers
    // hundreds: 1→2, 7→1  tens: 2→2, 8→1  units: 3→2, 9→1
    expect(stats.hundreds[0].digit).toBe("1");
    expect(stats.hundreds[0].count).toBe(2);
    expect(stats.hundreds[0].ratio).toBeCloseTo(2 / 3, 4);
    expect(stats.hundreds[1].digit).toBe("7");
    expect(stats.hundreds[1].count).toBe(1);

    expect(stats.tens[0].digit).toBe("2");
    expect(stats.tens[0].count).toBe(2);
    expect(stats.units[0].digit).toBe("3");
    expect(stats.units[0].count).toBe(2);
    expect(stats.units[1].digit).toBe("9");
    expect(stats.units[1].count).toBe(1);
  });

  test("predictTopNumbersAI reconstructs number from digits ignoring AI number field", async () => {
    state.call.mockResolvedValueOnce({
      text: JSON.stringify({
        predictions: [
          { number: "999", hundredsDigit: "1", tensDigit: "8", unitsDigit: "5", confidence: 0.62, reason: "test ghép" },
        ],
      }),
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const records = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac" as const,
        province: "Hà Nội",
        prizes: {
          db: "00123",
          g1: "00456",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    const result = await lotteryAiPredict.predictTopNumbersAI(records, "mien-bac", 3, 1);

    // number should be reconstructed from digits: "1"+"8"+"5" = "185", NOT the AI's "999"
    expect(result[0].number).toBe("185");
    expect(result[0].hundredsDigit).toBe("1");
    expect(result[0].tensDigit).toBe("8");
    expect(result[0].unitsDigit).toBe("5");
    // confidence computed from stats: h=1→0.5, t=8→0 (not in data), u=5→0 (not in data, units are 3,6)
    // weighted: h*0.25 + t*0.35 + u*0.40 = 0.5*0.25 + 0*0.35 + 0*0.40 = 0.125
    expect(result[0].confidence).toBeCloseTo(0.125, 4);
  });

  test("predictTopNumbersAI filters out predictions with non-digit hundredsDigit/tensDigit/unitsDigit", async () => {
    state.call.mockResolvedValueOnce({
      text: JSON.stringify({
        predictions: [
          { number: "999", hundredsDigit: "1", tensDigit: "8", unitsDigit: "5", confidence: 0.62, reason: "valid prediction" },
          { number: "777", hundredsDigit: "7", tensDigit: "ab", unitsDigit: "7", confidence: 0.5, reason: "invalid tensDigit" },
        ],
      }),
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const records = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac" as const,
        province: "Hà Nội",
        prizes: {
          db: "00123",
          g1: "00456",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ];

    const result = await lotteryAiPredict.predictTopNumbersAI(records, "mien-bac", 3, 5);

    // Only the valid prediction (single-digit hundredsDigit/tensDigit/unitsDigit) survives
    expect(result).toHaveLength(1);
    // Reconstructed from digits, ignoring AI's "number" field
    expect(result[0].number).toBe("185");
    expect(result[0].hundredsDigit).toBe("1");
    expect(result[0].tensDigit).toBe("8");
    expect(result[0].unitsDigit).toBe("5");
  });

  test("computeConfidence returns average ratio for valid digits", () => {
    const stats = {
      hundreds: [
        { digit: "1", count: 3, ratio: 0.3 },
        { digit: "2", count: 2, ratio: 0.2 },
      ],
      tens: [
        { digit: "5", count: 1, ratio: 0.1 },
        { digit: "8", count: 4, ratio: 0.4 },
      ],
      units: [
        { digit: "3", count: 5, ratio: 0.5 },
        { digit: "9", count: 2, ratio: 0.2 },
      ],
    };

    const result = lotteryAiPredict.computeConfidence(stats, "1", "8", "3");
    // (0.3 + 0.4 + 0.5) / 3 = 0.4
    expect(result).toBeCloseTo(0.4, 4);
  });

  test("computeConfidence returns 0 for missing digit", () => {
    const stats = {
      hundreds: [{ digit: "1", count: 3, ratio: 0.3 }],
      tens: [{ digit: "5", count: 1, ratio: 0.1 }],
      units: [{ digit: "3", count: 5, ratio: 0.5 }],
    };

    // Digit "9" not in any position → ratio=0, so (0 + 0 + 0) / 3 = 0
    const result = lotteryAiPredict.computeConfidence(stats, "9", "9", "9");
    expect(result).toBe(0);
  });

  test("computeWeightedConfidence applies correct weights: 0.25/0.35/0.40", () => {
    const stats = {
      hundreds: [{ digit: "1", count: 5, ratio: 0.5 }],
      tens: [{ digit: "8", count: 4, ratio: 0.4 }],
      units: [{ digit: "5", count: 3, ratio: 0.3 }],
    };
    // 0.5*0.25 + 0.4*0.35 + 0.3*0.40 = 0.125 + 0.14 + 0.12 = 0.385
    const result = lotteryAiPredict.computeWeightedConfidence(stats, "1", "8", "5");
    expect(result).toBeCloseTo(0.385, 4);
  });

  test("computeUnitsConfidence returns units ratio * 0.40", () => {
    const stats = {
      hundreds: [],
      tens: [],
      units: [{ digit: "7", count: 2, ratio: 0.25 }],
    };
    const result = lotteryAiPredict.computeUnitsConfidence(stats, "7");
    expect(result).toBeCloseTo(0.1, 4);
  });

  test("computeUnitsTrendScore returns correct trend score", () => {
    const records = [
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac" as const,
        province: "Hà Nội",
        prizes: { db: "00123", g1: "00456", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-02",
        weekday: 4,
        region: "mien-bac" as const,
        province: "Hà Nội",
        prizes: { db: "00789", g1: "", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-03",
        weekday: 5,
        region: "mien-bac" as const,
        province: "Hà Nội",
        prizes: { db: "00123", g1: "", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
    ];

    // units 3 appears in 2 out of 3 recent records → 2/3 = 0.666...
    const result = lotteryAiPredict.computeUnitsTrendScore(records, "3");
    expect(result).toBeCloseTo(2 / 3, 4);
  });

  test("computeUnitsTrendScore returns 0 for empty records", () => {
    const result = lotteryAiPredict.computeUnitsTrendScore([], "5");
    expect(result).toBe(0);
  });
});
