export type ChartEngineMode = "ai" | "deterministic" | "shadow";

/**
 * Đọc CHART_ENGINE_MODE từ env.
 * Mặc định: "shadow" — chạy song song AI + deterministic, chỉ dùng AI gửi Telegram.
 */
export function getConfiguredChartEngineMode(): ChartEngineMode {
  const raw = process.env.CHART_ENGINE_MODE?.trim().toLowerCase() as ChartEngineMode | undefined;
  if (raw === "ai" || raw === "deterministic" || raw === "shadow") {
    return raw;
  }
  return "shadow";
}

export function getConfiguredChartSignalConfidenceThreshold(): number {
  const raw = process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD?.trim();
  if (!raw) return 70;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 70;
}

export function getConfiguredPendingOrderExpiryRuns(): number {
  const raw = process.env.PENDING_ORDER_EXPIRY_RUNS?.trim();
  if (!raw) return 2;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 2;
}