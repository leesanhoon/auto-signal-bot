import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenRouterRequest } from "./openrouter.js";

function getPromptLogDir(): string {
  return process.env.AI_PROMPT_LOG_DIR?.trim() || ".hermes/prompt-logs";
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug.slice(0, 40) : "prompt";
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderUserContent(request: OpenRouterRequest): string {
  if (request.userContent.length === 0) {
    return "_Không có user content._";
  }

  return request.userContent
    .map((part, index) => {
      const title = `### User Part ${index + 1} (${part.type})`;
      if (part.type === "text") {
        return `${title}\n\n~~~text\n${part.text}\n~~~`;
      }

      const placeholder =
        part.image_url.url.startsWith("data:")
          ? "[image_url omitted: data URL]"
          : `[image_url omitted: ${part.image_url.url}]`;
      return `${title}\n\n${placeholder}`;
    })
    .join("\n\n");
}

export function renderOpenRouterPromptLog(request: OpenRouterRequest): string {
  return [
    "# OpenRouter Prompt",
    "",
    `- model: ${request.model}`,
    `- timestamp: ${new Date().toISOString()}`,
    `- maxTokens: ${request.maxTokens ?? ""}`,
    `- temperature: ${request.temperature ?? ""}`,
    `- timeoutMs: ${request.timeoutMs ?? ""}`,
    `- responseFormat: ${request.responseFormat ? formatJson(request.responseFormat) : ""}`,
    `- reasoning: ${request.reasoning ? formatJson(request.reasoning) : ""}`,
    `- plugins: ${request.plugins ? formatJson(request.plugins) : ""}`,
    "",
    "## System Prompt",
    "",
    request.systemPrompt ? `~~~text\n${request.systemPrompt}\n~~~` : "_No system prompt._",
    "",
    "## User Content",
    "",
    renderUserContent(request),
    "",
  ].join("\n");
}

export async function writeOpenRouterPromptLog(
  request: OpenRouterRequest,
): Promise<string> {
  const dir = getPromptLogDir();
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${stamp}-${slugify(request.model)}-${randomUUID().slice(0, 8)}.md`;
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, renderOpenRouterPromptLog(request), "utf8");
  return filePath;
}
