import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetRateLimitStateForTests } from "../../src/shared/rate-limit.js";
import { callOpenRouter } from "../../src/shared/openrouter.js";

describe("shared/openrouter", () => {
  let promptLogDir = "";

  beforeEach(() => {
    resetRateLimitStateForTests();
    process.env.OPENROUTER_API_KEY = "test";
    delete process.env.OPENROUTER_RATE_LIMIT_RPM;
    delete process.env.AI_PROMPT_LOG_DIR;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_PROMPT_LOG_DIR;
    if (promptLogDir) {
      void rm(promptLogDir, { recursive: true, force: true });
      promptLogDir = "";
    }
  });

  test("maps content and token usage", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callOpenRouter({
      model: "test/model",
      userContent: [{ type: "text", text: "hello" }],
      reasoning: { effort: "none", exclude: true },
    })).resolves.toEqual({
      text: "{\"ok\":true}",
      usage: { promptTokens: 12, completionTokens: 7 },
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

  test("writes the request prompt to a markdown file", async () => {
    promptLogDir = await mkdtemp(join(tmpdir(), "auto-signal-bot-prompts-"));
    process.env.AI_PROMPT_LOG_DIR = promptLogDir;

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await callOpenRouter({
      model: "test/model",
      systemPrompt: "system prompt",
      userContent: [{ type: "text", text: "hello prompt" }],
      temperature: 0.2,
    });

    const files = await readdir(promptLogDir);
    expect(files).toHaveLength(1);
    const content = await readFile(join(promptLogDir, files[0]), "utf8");
    expect(content).toContain("# OpenRouter Prompt");
    expect(content).toContain("test/model");
    expect(content).toContain("system prompt");
    expect(content).toContain("hello prompt");
  });
});
