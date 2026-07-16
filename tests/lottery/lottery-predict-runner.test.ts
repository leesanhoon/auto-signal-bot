import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetchActualRecords: vi.fn(),
  loadWeekdayHistory: vi.fn(),
  loadCachedPredictions: vi.fn(),
  predictTopNumbersEnsemble: vi.fn(),
  savePredictions: vi.fn(),
  sendMessage: vi.fn(async () => undefined),
}));

vi.mock("../../src/lottery/client/lottery-scraper.js", () => ({
  fetchActualRecords: state.fetchActualRecords,
}));
vi.mock("../../src/lottery/repository/lottery-repository.js", () => ({
  loadWeekdayHistory: state.loadWeekdayHistory,
}));
vi.mock("../../src/lottery/service/lottery-ensemble-predict.js", () => ({
  predictTopNumbersEnsemble: state.predictTopNumbersEnsemble,
}));
vi.mock("../../src/lottery/repository/lottery-predictions-repository.js", () => ({
  loadCachedPredictions: state.loadCachedPredictions,
  savePredictions: state.savePredictions,
}));
vi.mock("../../src/shared/notification/telegram-client.js", () => ({
  sendMessage: state.sendMessage,
}));

let runner: typeof import("../../src/lottery/controller/lottery-predict-runner.js");

beforeAll(async () => {
  runner = await import("../../src/lottery/controller/lottery-predict-runner.js");
});

describe("lottery/lottery-predict-runner", () => {
  beforeEach(() => {
    state.fetchActualRecords.mockReset();
    state.loadWeekdayHistory.mockReset();
    state.loadCachedPredictions.mockReset();
    state.predictTopNumbersEnsemble.mockReset();
    state.savePredictions.mockReset();
    state.sendMessage.mockClear();

    state.fetchActualRecords.mockResolvedValue([]);
    state.loadCachedPredictions.mockResolvedValue([]);
    state.loadWeekdayHistory.mockResolvedValue([
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
        province: "Hà Nội",
        prizes: { db: "00123", g1: "00456", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-trung",
        province: "Huế",
        prizes: { db: "00789", g1: "00654", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-nam",
        province: "TP.HCM",
        prizes: { db: "00987", g1: "00654", g2: [], g3: [], g4: [], g5: [], g6: [], g7: [], g8: [] },
      },
    ]);
    state.predictTopNumbersEnsemble.mockImplementation(async (_records: unknown[], region: string) => {
      if (region === "mien-trung") {
        throw new Error("Regression failed");
      }
      return [
        { number: "123", confidence: 0.91, reason: `${region} rank 1`, breakdown: { stats: 0.92, regression: 0.9 } },
        { number: "456", confidence: 0.74, reason: `${region} rank 2`, breakdown: { stats: 0.73, regression: 0.75 } },
      ];
    });
    state.savePredictions.mockResolvedValue(undefined);
  });

  test("continues other regions when one prediction fails", async () => {
    await expect(runner.runLotteryPredict()).resolves.toBeUndefined();

    expect(state.predictTopNumbersEnsemble).toHaveBeenCalledTimes(3);
    expect(state.savePredictions).toHaveBeenCalledTimes(2);
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(String((state.sendMessage as any).mock.calls[0][0])).toContain("123");
    expect(String((state.sendMessage as any).mock.calls[0][0])).toContain("DỰ ĐOÁN XỔ SỐ");
  });

  test("uses cached predictions and skips the ensemble when cache exists", async () => {
    state.loadCachedPredictions.mockImplementation(async (_date: string, region: string) => {
      if (region === "mien-nam") {
        return [
          { number: "111", confidence: 0.88, reason: "Cache Nam", rank: 1, breakdown: { stats: 0.87, regression: 0.86 } },
          { number: "222", confidence: 0.77, reason: "Cache Nam 2", rank: 2, breakdown: { stats: 0.76, regression: 0.75 } },
        ];
      }
      return [];
    });

    await expect(runner.runLotteryPredict()).resolves.toBeUndefined();

    expect(state.predictTopNumbersEnsemble).toHaveBeenCalledTimes(2);
    expect(state.savePredictions).toHaveBeenCalledTimes(1);
    expect(String((state.sendMessage as any).mock.calls[0][0])).toContain("111");
    expect(String((state.sendMessage as any).mock.calls[0][0])).toContain("dùng cache");
  });

  test("runLotteryPredict with single region only processes that region", async () => {
    await expect(runner.runLotteryPredict(["mien-nam"])).resolves.toBeUndefined();

    expect(state.predictTopNumbersEnsemble).toHaveBeenCalledTimes(1);
    expect(state.predictTopNumbersEnsemble).toHaveBeenCalledWith(
      expect.anything(),
      "mien-nam",
      expect.anything(),
      expect.anything(),
    );
    expect(state.savePredictions).toHaveBeenCalledTimes(1);
    expect(String((state.sendMessage as any).mock.calls[0][0])).toContain("🟩 Miền Nam");
    expect(String((state.sendMessage as any).mock.calls[0][0])).not.toContain("🟨 Miền Trung");
    expect(String((state.sendMessage as any).mock.calls[0][0])).not.toContain("🟦 Miền Bắc");
  });
});
