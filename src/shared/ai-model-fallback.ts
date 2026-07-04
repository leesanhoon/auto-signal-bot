import { withRetry } from "./retry.js";
import type { OpenRouterRequest, OpenRouterResponse } from "./openrouter.js";
import { callOpenRouter } from "./openrouter.js";
import { createLogger } from "./logger.js";

const logger = createLogger("shared:ai-model-fallback");

export function parseModelFallbacks(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

export async function callOpenRouterWithFallback(
  primaryModel: string,
  fallbackModels: string[],
  requestBuilder: (model: string) => OpenRouterRequest,
  onRetry?: (error: unknown, attempt: number, maxAttempts: number, delayMs: number) => void,
): Promise<{ response: OpenRouterResponse; model: string }> {
  const models = [primaryModel, ...fallbackModels];
  let lastError: unknown = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const isLastModel = i === models.length - 1;

    try {
      const response = await withRetry(
        () => callOpenRouter(requestBuilder(model)),
        {
          onRetry: (error, attempt, maxAttempts, delayMs) => {
            onRetry?.(error, attempt, maxAttempts, delayMs);
          },
        },
      );
      return { response, model };
    } catch (error) {
      lastError = error;
      if (!isLastModel) {
        logger.warn(`Model ${model} failed, trying fallback`, {
          error: error instanceof Error ? error.message : String(error),
          nextModel: models[i + 1],
        });
      }
    }
  }

  throw lastError || new Error("All vision models failed");
}
