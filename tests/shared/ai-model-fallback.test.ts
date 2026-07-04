import { describe, expect, test, vi, beforeEach } from "vitest";
import { parseModelFallbacks, callOpenRouterWithFallback } from "../../src/shared/ai-model-fallback.js";

describe("shared/ai-model-fallback", () => {
  describe("parseModelFallbacks", () => {
    test("parses comma-separated fallback models", () => {
      const fallbacks = parseModelFallbacks("qwen/qwen2.5-vl-72b-instruct,google/gemini-2.0-flash-001");
      expect(fallbacks).toEqual(["qwen/qwen2.5-vl-72b-instruct", "google/gemini-2.0-flash-001"]);
    });

    test("trims whitespace from models", () => {
      const fallbacks = parseModelFallbacks("  model1  ,  model2  ");
      expect(fallbacks).toEqual(["model1", "model2"]);
    });

    test("filters out empty strings", () => {
      const fallbacks = parseModelFallbacks("model1,,model2,  ,model3");
      expect(fallbacks).toEqual(["model1", "model2", "model3"]);
    });

    test("returns empty array for undefined", () => {
      const fallbacks = parseModelFallbacks(undefined);
      expect(fallbacks).toEqual([]);
    });

    test("returns empty array for empty string", () => {
      const fallbacks = parseModelFallbacks("");
      expect(fallbacks).toEqual([]);
    });
  });

  describe("callOpenRouterWithFallback", () => {
    let mockCall: ReturnType<typeof vi.fn>;
    let onRetryFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockCall = vi.fn();
      onRetryFn = vi.fn();
      vi.resetModules();
    });

    test("returns response from primary model on success", async () => {
      mockCall.mockResolvedValue({
        text: "Primary model response",
        usage: { promptTokens: 10, completionTokens: 20 },
      });

      vi.doMock("../../src/shared/retry.js", () => ({
        withRetry: vi.fn(async (fn) => fn()),
      }));
      vi.doMock("../../src/shared/openrouter.js", () => ({
        callOpenRouter: mockCall,
      }));

      const { callOpenRouterWithFallback: fallbackCall } = await import(
        "../../src/shared/ai-model-fallback.js"
      );

      const result = await fallbackCall(
        "primary-model",
        ["fallback-model"],
        (model) => ({ model, userContent: [] }),
        onRetryFn,
      );

      expect(result.model).toBe("primary-model");
      expect(result.response.text).toBe("Primary model response");
    });

    test("tries fallback model when primary fails", async () => {
      const primaryError = new Error("Primary model error");
      mockCall.mockRejectedValueOnce(primaryError).mockResolvedValueOnce({
        text: "Fallback model response",
        usage: { promptTokens: 10, completionTokens: 20 },
      });

      vi.doMock("../../src/shared/retry.js", () => ({
        withRetry: vi.fn(async (fn) => fn()),
      }));
      vi.doMock("../../src/shared/openrouter.js", () => ({
        callOpenRouter: mockCall,
      }));

      const { callOpenRouterWithFallback: fallbackCall } = await import(
        "../../src/shared/ai-model-fallback.js"
      );

      const result = await fallbackCall(
        "primary-model",
        ["fallback-model"],
        (model) => ({ model, userContent: [] }),
      );

      expect(result.model).toBe("fallback-model");
      expect(result.response.text).toBe("Fallback model response");
      expect(mockCall).toHaveBeenCalledTimes(2);
    });
  });
});
