import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetchActualRecords: vi.fn(),
  loadWeekdayHistory: vi.fn(),
  loadCachedPredictions: vi.fn(),
  predictTopNumbersAI: vi.fn(),
  savePredictions: vi.fn(),
  sendMessage: vi.fn(async () => undefined),
}));

vi.mock("../../src/lottery/lottery-scraper.js", () => ({
  fetchActualRecords: state.fetchActualRecords,
}));
vi.mock("../../src/lottery/lottery-repository.js", () => ({
  loadWeekdayHistory: state.loadWeekdayHistory,
}));
vi.mock("../../src/lottery/lottery-ai-predict.js", () => ({
  predictTopNumbersAI: state.predictTopNumbersAI,
}));
vi.mock("../../src/lottery/lottery-predictions-repository.js", () => ({
  loadCachedPredictions: state.loadCachedPredictions,
  savePredictions: state.savePredictions,
}));
vi.mock("../../src/shared/telegram.js", () => ({
  sendMessage: state.sendMessage,
}));

const runner = await import("../../src/lottery/lottery-predict-runner.js");

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("lottery/lottery-predict-runner", () => {
  beforeEach(() => {
    state.fetchActualRecords.mockReset();
    state.loadWeekdayHistory.mockReset();
    state.loadCachedPredictions.mockReset();
    state.predictTopNumbersAI.mockReset();
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
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-trung",
        province: "Huế",
        prizes: {
          db: "00789",
          g1: "00654",
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
        date: "2026-07-01",
        weekday: 3,
        region: "mien-nam",
        province: "TP.HCM",
        prizes: {
          db: "00987",
          g1: "00654",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ]);
    state.predictTopNumbersAI.mockImplementation(async (_records: unknown[], region: string) => {
      if (region === "mien-trung") {
        throw new Error("OpenRouter timeout");
      }
      return [
        { number: "123", confidence: 0.91, reason: "Lặp tần suất" },
        { number: "456", confidence: 0.74, reason: "Độ trễ tốt" },
      ];
    });
    state.savePredictions.mockResolvedValue(undefined);
  });

  test("continues other regions when one AI prediction fails", async () => {
    await expect(runner.runLotteryPredict()).resolves.toBeUndefined();

    expect(state.predictTopNumbersAI).toHaveBeenCalledTimes(3);
    expect(state.savePredictions).toHaveBeenCalledTimes(2);
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(state.sendMessage.mock.calls[0][0])).toContain("123");
    expect(String(state.sendMessage.mock.calls[0][0])).toContain("91% tin cậy");
    expect(String(state.sendMessage.mock.calls[0][0])).toContain("DỰ ĐOÁN XỔ SỐ");
  });

  test("runs regions in parallel and preserves Telegram ordering", async () => {
    const historyDeferred = createDeferred<
      Awaited<ReturnType<typeof state.loadWeekdayHistory>>
    >();
    const predictionResolvers = new Map<
      string,
      (value: Array<{ number: string; confidence: number; reason: string }>) => void
    >();

    state.loadWeekdayHistory.mockReturnValue(historyDeferred.promise);
    state.predictTopNumbersAI.mockImplementation((_records: unknown[], region: string) => {
      const promise = new Promise<
        Array<{ number: string; confidence: number; reason: string }>
      >((resolve) => {
        predictionResolvers.set(region, resolve);
      });
      return promise;
    });

    const runPromise = runner.runLotteryPredict();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.loadWeekdayHistory).toHaveBeenCalledTimes(1);
    expect(state.predictTopNumbersAI).toHaveBeenCalledTimes(0);

    historyDeferred.resolve([
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-bac",
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
      {
        date: "2026-07-01",
        weekday: 3,
        region: "mien-trung",
        province: "Huế",
        prizes: {
          db: "00789",
          g1: "00654",
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
        date: "2026-07-01",
        weekday: 3,
        region: "mien-nam",
        province: "TP.HCM",
        prizes: {
          db: "00987",
          g1: "00654",
          g2: [],
          g3: [],
          g4: [],
          g5: [],
          g6: [],
          g7: [],
          g8: [],
        },
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.predictTopNumbersAI).toHaveBeenCalledTimes(3);

    predictionResolvers.get("mien-bac")?.([
      { number: "345", confidence: 0.81, reason: "Bắc" },
      { number: "678", confidence: 0.72, reason: "Bắc 2" },
      { number: "901", confidence: 0.61, reason: "Bắc 3" },
    ]);
    predictionResolvers.get("mien-trung")?.([
      { number: "234", confidence: 0.93, reason: "Trung" },
      { number: "567", confidence: 0.74, reason: "Trung 2" },
      { number: "890", confidence: 0.62, reason: "Trung 3" },
    ]);
    predictionResolvers.get("mien-nam")?.([
      { number: "123", confidence: 0.97, reason: "Nam" },
      { number: "456", confidence: 0.76, reason: "Nam 2" },
      { number: "789", confidence: 0.64, reason: "Nam 3" },
    ]);

    await expect(runPromise).resolves.toBeUndefined();

    expect(state.savePredictions).toHaveBeenCalledTimes(3);
    expect(state.sendMessage).toHaveBeenCalledTimes(1);

    const message = String(state.sendMessage.mock.calls[0][0]);
    expect(message.indexOf("🟩 Miền Nam")).toBeGreaterThan(-1);
    expect(message.indexOf("🟨 Miền Trung")).toBeGreaterThan(-1);
    expect(message.indexOf("🟦 Miền Bắc")).toBeGreaterThan(-1);
    expect(message.indexOf("🟩 Miền Nam")).toBeLessThan(message.indexOf("🟨 Miền Trung"));
    expect(message.indexOf("🟨 Miền Trung")).toBeLessThan(message.indexOf("🟦 Miền Bắc"));
  });

  test("uses cached predictions and skips AI when cache exists", async () => {
    state.loadCachedPredictions.mockImplementation(async (_date: string, region: string) => {
      if (region === "mien-nam") {
        return [
          { number: "111", confidence: 0.88, reason: "Cache Nam", rank: 1 },
          { number: "222", confidence: 0.77, reason: "Cache Nam 2", rank: 2 },
          { number: "333", confidence: 0.66, reason: "Cache Nam 3", rank: 3 },
        ];
      }
      return [];
    });
    state.predictTopNumbersAI.mockResolvedValue([
      { number: "123", confidence: 0.91, reason: "Lặp tần suất", hundredsDigit: "1", tensDigit: "2", unitsDigit: "3" },
      { number: "456", confidence: 0.74, reason: "Độ trễ tốt", hundredsDigit: "4", tensDigit: "5", unitsDigit: "6" },
    ]);

    await expect(runner.runLotteryPredict()).resolves.toBeUndefined();

    expect(state.loadCachedPredictions).toHaveBeenCalledTimes(3);
    expect(state.predictTopNumbersAI).toHaveBeenCalledTimes(2);
    expect(state.savePredictions).toHaveBeenCalledTimes(2);
    expect(String(state.sendMessage.mock.calls[0][0])).toContain("111");
    expect(String(state.sendMessage.mock.calls[0][0])).toContain("dùng cache");
  });

  test("continues to call AI when cache read throws", async () => {
    state.loadCachedPredictions.mockImplementation(async (_date: string, region: string) => {
      if (region === "mien-bac") {
        throw new Error("Supabase connection refused");
      }
      return [];
    });
    state.predictTopNumbersAI.mockResolvedValue([
      { number: "123", confidence: 0.91, reason: "Lặp tần suất", hundredsDigit: "1", tensDigit: "2", unitsDigit: "3" },
      { number: "456", confidence: 0.74, reason: "Độ trễ tốt", hundredsDigit: "4", tensDigit: "5", unitsDigit: "6" },
    ]);

    await expect(runner.runLotteryPredict()).resolves.toBeUndefined();

    expect(state.loadCachedPredictions).toHaveBeenCalledTimes(3);
    expect(state.predictTopNumbersAI).toHaveBeenCalledTimes(3);
    expect(state.predictTopNumbersAI).toHaveBeenCalledWith(
      expect.anything(),
      "mien-bac",
      expect.anything(),
      expect.anything(),
    );
    expect(state.savePredictions).toHaveBeenCalledTimes(3);
    expect(String(state.sendMessage.mock.calls[0][0])).toContain("123");
  });

  test("runLotteryPredict with single region only processes that region", async () => {
    await expect(runner.runLotteryPredict(["mien-nam"])).resolves.toBeUndefined();

    expect(state.predictTopNumbersAI).toHaveBeenCalledTimes(1);
    expect(state.predictTopNumbersAI).toHaveBeenCalledWith(
      expect.anything(),
      "mien-nam",
      expect.anything(),
      expect.anything(),
    );
    expect(state.savePredictions).toHaveBeenCalledTimes(1);
    expect(String(state.sendMessage.mock.calls[0][0])).toContain("🟩 Miền Nam");
    expect(String(state.sendMessage.mock.calls[0][0])).not.toContain("🟨 Miền Trung");
    expect(String(state.sendMessage.mock.calls[0][0])).not.toContain("🟦 Miền Bắc");
  });

  test("runLotteryPredict with two regions only processes those two", async () => {
    state.predictTopNumbersAI.mockImplementation(async (_records: unknown[], region: string) => {
      return [
        { number: "111", confidence: 0.9, reason: `${region} prediction` },
        { number: "222", confidence: 0.8, reason: `${region} second` },
      ];
    });

    await expect(runner.runLotteryPredict(["mien-bac", "mien-trung"])).resolves.toBeUndefined();

    expect(state.predictTopNumbersAI).toHaveBeenCalledTimes(2);
    expect(state.savePredictions).toHaveBeenCalledTimes(2);
    expect(String(state.sendMessage.mock.calls[0][0])).toContain("🟦 Miền Bắc");
    expect(String(state.sendMessage.mock.calls[0][0])).toContain("🟨 Miền Trung");
    expect(String(state.sendMessage.mock.calls[0][0])).not.toContain("🟩 Miền Nam");
  });
});
