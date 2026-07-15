export type ChartTimeframeMode = "multi" | "single";

export function buildChartAnalysisCacheKey(
  candleKey: string,
  engineMode: string,
  timeframeMode: ChartTimeframeMode,
  primaryTimeframe?: string,
): string {
  return timeframeMode === "single"
    ? `${candleKey}:${engineMode}:${timeframeMode}:${primaryTimeframe ?? "M15"}`
    : `${candleKey}:${engineMode}:${timeframeMode}`;
}

export function cleanResponse(text: string): string {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

export function extractJsonObject(text: string): string {
  const cleaned = cleanResponse(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

export function clampConfidence(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : 0;
}
