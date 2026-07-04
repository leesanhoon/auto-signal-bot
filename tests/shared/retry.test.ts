import { describe, it, expect, vi, beforeEach } from "vitest";
import { isRetryableError, withRetry } from "../../src/shared/retry.js";

describe("retry.ts", () => {
  describe("isRetryableError", () => {
    it("should return true for HTTP status codes 429/500/502/503/504", () => {
      const retryableStatuses = [429, 500, 502, 503, 504];
      for (const status of retryableStatuses) {
        const error = new Error("test");
        (error as any).status = status;
        expect(isRetryableError(error)).toBe(true);
      }
    });

    it("should return false for non-retryable HTTP status codes (400, 404)", () => {
      const nonRetryableStatuses = [400, 404];
      for (const status of nonRetryableStatuses) {
        const error = new Error("test");
        (error as any).status = status;
        expect(isRetryableError(error)).toBe(false);
      }
    });

    it("should return true for string status UNAVAILABLE/RESOURCE_EXHAUSTED", () => {
      const error1 = new Error("test");
      (error1 as any).status = "UNAVAILABLE";
      expect(isRetryableError(error1)).toBe(true);

      const error2 = new Error("test");
      (error2 as any).status = "RESOURCE_EXHAUSTED";
      expect(isRetryableError(error2)).toBe(true);

      const error3 = new Error("test");
      (error3 as any).status = "unavailable";
      expect(isRetryableError(error3)).toBe(true);
    });

    it("should return true for timeout/connection messages", () => {
      const timeoutErrors = [
        new Error("ETIMEDOUT"),
        new Error("ECONNRESET"),
        new Error("fetch failed"),
        new Error("network error"),
        new Error("socket hang up"),
        new Error("timeout"),
        new Error("empty content"),
      ];
      for (const error of timeoutErrors) {
        expect(isRetryableError(error)).toBe(true);
      }
    });

    it("should return true for overloaded/high demand messages", () => {
      const errors = [
        new Error("server overloaded"),
        new Error("high demand"),
      ];
      for (const error of errors) {
        expect(isRetryableError(error)).toBe(true);
      }
    });

    it("should return true for status code in error message JSON", () => {
      const error = new Error('{"code": 503}');
      expect(isRetryableError(error)).toBe(true);
    });

    it("should handle non-Error objects (string, null, undefined)", () => {
      expect(isRetryableError("string error")).toBe(false);
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
    });

    it("should return false for unmatched messages", () => {
      const error = new Error("some random error");
      expect(isRetryableError(error)).toBe(false);
    });

    it("should detect OpenRouter HTTP status errors in message", () => {
      const openrouterErrors = [
        new Error("OpenRouter request failed (429): Too Many Requests"),
        new Error("OpenRouter request failed (500): Internal Server Error"),
        new Error("OpenRouter request failed (502): Bad Gateway"),
        new Error("OpenRouter request failed (503): Service Unavailable"),
        new Error("OpenRouter request failed (504): Gateway Timeout"),
      ];
      for (const error of openrouterErrors) {
        expect(isRetryableError(error)).toBe(true);
      }
    });

    it("should not retry OpenRouter errors with non-retryable status", () => {
      const error = new Error("OpenRouter request failed (400): Bad Request");
      expect(isRetryableError(error)).toBe(false);
    });

    it("should check statusCode field as fallback", () => {
      const error = new Error("test");
      (error as any).statusCode = 502;
      expect(isRetryableError(error)).toBe(true);
    });

    it("should check nested error.error.code", () => {
      const error = new Error("test");
      (error as any).error = { code: 429 };
      expect(isRetryableError(error)).toBe(true);
    });

    it("should handle string status codes", () => {
      const error = new Error("test");
      (error as any).statusCode = "503";
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe("withRetry", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should return result on first success without retry", async () => {
      const fn = vi.fn(async () => "success");
      const result = await withRetry(fn);
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure and succeed", async () => {
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          const err = new Error("timeout");
          throw err;
        }
        return "success";
      });

      const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should throw after maxAttempts exceeded", async () => {
      const fn = vi.fn(async () => {
        const error = new Error("timeout");
        throw error;
      });

      await expect(
        withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 }),
      ).rejects.toThrow("timeout");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should not retry for non-retryable errors", async () => {
      const fn = vi.fn(async () => {
        const error = new Error("404 Not Found");
        (error as any).status = 404;
        throw error;
      });

      await expect(
        withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }),
      ).rejects.toThrow("404 Not Found");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should use custom isRetryable function", async () => {
      const fn = vi.fn(async () => {
        throw new Error("custom error");
      });

      const isRetryable = () => false;

      await expect(
        withRetry(fn, { maxAttempts: 3, isRetryable, baseDelayMs: 1 }),
      ).rejects.toThrow("custom error");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should call onRetry callback with correct parameters", async () => {
      const onRetry = vi.fn();
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("timeout");
        }
        return "success";
      });

      await withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 2,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        expect.any(Error),
        1,
        3,
        2 * 2 ** 0,
      );
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        expect.any(Error),
        2,
        3,
        2 * 2 ** 1,
      );
    });

    it("should use fake timers for exponential backoff", async () => {
      vi.useFakeTimers();
      try {
        let callCount = 0;
        const fn = vi.fn(async () => {
          callCount++;
          if (callCount < 3) {
            throw new Error("timeout");
          }
          return "success";
        });

        const promise = withRetry(fn, {
          maxAttempts: 3,
          baseDelayMs: 1000,
        });

        // Advance timers to handle delays
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000);

        const result = await promise;
        expect(result).toBe("success");
      } finally {
        vi.useRealTimers();
      }
    });

    it("should handle default options", async () => {
      const fn = vi.fn(async () => "success");
      const result = await withRetry(fn);
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
