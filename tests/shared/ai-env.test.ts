import { beforeEach, describe, expect, test } from "vitest";

describe("getConfiguredReasoningEffort", () => {
  beforeEach(() => {
    delete process.env.AI_REASONING_EFFORT;
  });

  test("returns fallback when env var not set", async () => {
    const aiEnv = await import("../../src/shared/ai-env.js");
    const result = aiEnv.getConfiguredReasoningEffort("medium");
    expect(result).toBe("medium");
  });

  test("returns env value when valid", async () => {
    process.env.AI_REASONING_EFFORT = "high";
    // Clear module cache to force re-import
    delete (globalThis as any).__aiEnvModule;
    const aiEnv = await import("../../src/shared/ai-env.js");
    const result = aiEnv.getConfiguredReasoningEffort("medium");
    expect(result).toBe("high");
  });

  test("returns fallback when env value is invalid", async () => {
    process.env.AI_REASONING_EFFORT = "invalid-effort";
    const aiEnv = await import("../../src/shared/ai-env.js");
    const result = aiEnv.getConfiguredReasoningEffort("low");
    expect(result).toBe("low");
  });

  test("returns fallback when env value is empty string", async () => {
    process.env.AI_REASONING_EFFORT = "";
    const aiEnv = await import("../../src/shared/ai-env.js");
    const result = aiEnv.getConfiguredReasoningEffort("none");
    expect(result).toBe("none");
  });

  test("handles all valid effort levels", async () => {
    const validEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    const aiEnv = await import("../../src/shared/ai-env.js");
    for (const effort of validEfforts) {
      process.env.AI_REASONING_EFFORT = effort;
      const result = aiEnv.getConfiguredReasoningEffort("medium");
      expect(result).toBe(effort);
    }
  });
});
