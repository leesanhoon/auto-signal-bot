import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  launch: vi.fn(),
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: state.launch,
  },
}));

const screenshot = await import("../../src/charts/screenshot.js");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("charts/screenshot", () => {
  beforeEach(() => {
    state.launch.mockReset();
  });

  test("captureChartScreenshot waits for screenshot promise before closing the page", async () => {
    const screenshotResult = deferred<Buffer>();
    const close = vi.fn(async () => undefined);
    const screenshotMock = vi.fn(() => screenshotResult.promise);
    const waitForTimeout = vi.fn(async () => undefined);
    const waitForSelector = vi.fn(async () => ({
      contentFrame: async () => ({
        waitForSelector: async () => undefined,
        locator: () => ({
          innerText: async () => "1m\n30m\n1h\n4h\nIndicators\nC\n1.14525",
        }),
      }),
    }));

    state.launch.mockResolvedValue({
      newContext: async () => ({
        newPage: async () => ({
          setContent: async () => undefined,
          waitForSelector,
          waitForTimeout,
          screenshot: screenshotMock,
          close,
        }),
      }),
      close: async () => undefined,
    });

    const promise = screenshot.captureChartScreenshot({
      symbol: "OANDA:EURUSD",
      name: "EUR/USD H4",
      interval: "240",
      description: "EUR/USD — H4",
      timeframe: "H4",
    });

    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();

    screenshotResult.resolve(Buffer.from("image"));
    const result = await promise;

    expect(close).toHaveBeenCalledTimes(1);
    expect(screenshotMock).toHaveBeenCalledTimes(1);
    expect(result.lastPrice).toBe(1.14525);
    expect(result.buffer).toEqual(Buffer.from("image"));
  });
});
