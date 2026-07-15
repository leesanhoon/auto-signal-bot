import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetRateLimitStateForTests } from "../../src/shared/infra/rate-limit.js";
import { callOpenRouter } from "../../src/shared/openrouter.js";

describe("shared/openrouter", () => {
  beforeEach(() => {
    resetRateLimitStateForTests();
    process.env.OPENROUTER_API_KEY = "test";
    delete process.env.OPENROUTER_RATE_LIMIT_RPM;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("maps content and token usage", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 7,
        prompt_tokens_details: { cached_tokens: 9 },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callOpenRouter({
      model: "test/model",
      userContent: [{ type: "text", text: "hello" }],
      reasoning: { effort: "none", exclude: true },
    })).resolves.toEqual({
      text: "{\"ok\":true}",
      usage: { promptTokens: 12, completionTokens: 7, cachedTokens: 9 },
      finishReason: "stop",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      reasoning: { effort: "none", exclude: true },
    });
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("rejects empty successful responses with diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: { content: "", reasoning: "reasoning consumed the budget" },
        finish_reason: "length",
        native_finish_reason: "max_tokens",
      }],
      usage: { prompt_tokens: 20, completion_tokens: 600 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(callOpenRouter({
      model: "test/model",
      userContent: [{ type: "text", text: "hello" }],
    })).rejects.toThrow(
      "empty content (finish_reason=length, native_finish_reason=max_tokens, completion_tokens=600)",
    );
  });

});
