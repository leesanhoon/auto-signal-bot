import { withConfiguredRateLimit } from "./rate-limit.js";

export type OpenRouterRequest = {
  model: string;
  systemPrompt?: string;
  userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: { type: "json_object" };
  timeoutMs?: number;
  reasoning?: {
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    exclude?: boolean;
  };
  plugins?: Array<{ id: string; max_results?: number }>;
};

export type OpenRouterResponse = {
  text: string;
  usage: { promptTokens: number; completionTokens: number };
  finishReason?: string;
};

type ApiResponse = {
  choices?: Array<{
    finish_reason?: string;
    native_finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning?: string;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

function getRequestTimeoutMs(): number {
  const configured = Number(process.env.OPENROUTER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 300_000;
}

export async function callOpenRouter(
  input: OpenRouterRequest,
): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  return withConfiguredRateLimit(
    { key: "openrouter", envVar: "OPENROUTER_RATE_LIMIT_RPM", defaultRpm: 15 },
    async () => {
      const messages: Array<Record<string, unknown>> = [];
      if (input.systemPrompt)
        messages.push({ role: "system", content: input.systemPrompt });
      messages.push({ role: "user", content: input.userContent });

      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(
            input.timeoutMs && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
              ? input.timeoutMs
              : getRequestTimeoutMs(),
          ),
          body: JSON.stringify({
            model: input.model,
            messages,
            max_tokens: input.maxTokens,
            temperature: input.temperature,
            response_format: input.responseFormat,
            reasoning: input.reasoning,
            plugins: input.plugins,
          }),
        },
      );
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok) {
        throw new Error(
          `OpenRouter request failed (${response.status}): ${payload.error?.message ?? response.statusText}`,
        );
      }

      const choice = payload.choices?.[0];
      const content = choice?.message?.content;
      const finishReason = choice?.finish_reason;
      const text =
        typeof content === "string"
          ? content
          : (content?.map((part) => part.text ?? "").join("") ?? "");
      if (!choice?.message)
        throw new Error("OpenRouter response contained no message");
      if (!text.trim()) {
        const completionTokens = Number(payload.usage?.completion_tokens ?? 0);
        throw new Error(
          `OpenRouter response contained empty content (finish_reason=${choice.finish_reason ?? "unknown"}, native_finish_reason=${choice.native_finish_reason ?? "unknown"}, completion_tokens=${completionTokens})`,
        );
      }

      return {
        text: text.trim(),
        usage: {
          promptTokens: Number(payload.usage?.prompt_tokens ?? 0),
          completionTokens: Number(payload.usage?.completion_tokens ?? 0),
        },
        finishReason,
      };
    },
  );
}
