import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const repoState = vi.hoisted(() => ({
  loadActiveChartSymbols: vi.fn(),
}));

vi.mock("../../src/charts/chart-symbols-repository-volman.js", () => repoState);

describe("charts/volman-charts.config", () => {
  beforeEach(() => {
    vi.resetModules();
    repoState.loadActiveChartSymbols.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("getCharts() flatMaps mỗi base symbol ra 4 timeframe (D1/H4/H1/M15)", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z")); // Wednesday
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
    ]);

    const { getCharts } = await import("../../src/charts/volman-charts.config.js");
    const charts = await getCharts();

    expect(charts).toHaveLength(4);
    expect(charts.map((c) => c.timeframe).sort()).toEqual(["D1", "H1", "H4", "M15"].sort());
    expect(charts.every((c) => c.symbol === "BINANCE:BTCUSDT")).toBe(true);
    expect(charts.find((c) => c.timeframe === "D1")?.name).toBe("BTC/USDT D1");
  });

  test("lọc symbol OANDA: vào cuối tuần (Chủ nhật), giữ nguyên symbol BINANCE:", async () => {
    vi.setSystemTime(new Date("2024-01-14T12:00:00Z")); // Sunday
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
      { name: "EUR/USD", symbol: "OANDA:EURUSD" },
    ]);

    const { getCharts } = await import("../../src/charts/volman-charts.config.js");
    const charts = await getCharts();

    expect(charts.every((c) => c.symbol !== "OANDA:EURUSD")).toBe(true);
    expect(charts.some((c) => c.symbol === "BINANCE:BTCUSDT")).toBe(true);
  });

  test("không lọc symbol OANDA: vào ngày thường", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z")); // Wednesday
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "EUR/USD", symbol: "OANDA:EURUSD" },
    ]);

    const { getCharts } = await import("../../src/charts/volman-charts.config.js");
    const charts = await getCharts();

    expect(charts.some((c) => c.symbol === "OANDA:EURUSD")).toBe(true);
  });

  test("memoize — gọi getCharts() 2 lần chỉ query DB 1 lần", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z"));
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
    ]);

    const { getCharts } = await import("../../src/charts/volman-charts.config.js");
    await getCharts();
    await getCharts();

    expect(repoState.loadActiveChartSymbols).toHaveBeenCalledTimes(1);
  });

  test("cache hết hạn sau TTL — gọi lại getCharts() sẽ query DB thêm 1 lần", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z"));
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
    ]);

    const { getCharts } = await import("../../src/charts/volman-charts.config.js");
    await getCharts();
    expect(repoState.loadActiveChartSymbols).toHaveBeenCalledTimes(1);

    // Advance quá TTL 5 phút
    vi.setSystemTime(new Date("2024-01-17T12:05:01Z"));
    await getCharts();

    expect(repoState.loadActiveChartSymbols).toHaveBeenCalledTimes(2);
  });

  test("getChartsForTimeframeMode('single', 'H4') chỉ trả chart H4", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z"));
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
    ]);

    const { getChartsForTimeframeMode } = await import(
      "../../src/charts/volman-charts.config.js"
    );
    const charts = await getChartsForTimeframeMode("single", "H4");

    expect(charts).toHaveLength(1);
    expect(charts[0].timeframe).toBe("H4");
  });

  test("getChartsForTimeframeMode('multi', 'H4') trả cả 4 timeframe", async () => {
    vi.setSystemTime(new Date("2024-01-17T12:00:00Z"));
    repoState.loadActiveChartSymbols.mockResolvedValue([
      { name: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
    ]);

    const { getChartsForTimeframeMode } = await import(
      "../../src/charts/volman-charts.config.js"
    );
    const charts = await getChartsForTimeframeMode("multi", "H4");

    expect(charts).toHaveLength(4);
  });
});
