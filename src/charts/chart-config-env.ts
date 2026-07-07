export type ChartEngineMode = "ai" | "deterministic" | "shadow";
export type ChartRunContext = "manual" | "auto";
export type ChartTimeframeMode = "multi" | "single";

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

export function getConfiguredChartTimeframeMode(): ChartTimeframeMode {
  const raw = process.env.CHART_TIMEFRAME_MODE?.trim().toLowerCase();
  if (raw === "multi" || raw === "single") {
    return raw;
  }
  return "multi";
}

export function getConfiguredChartPrimaryTimeframe(): import("./chart-types.js").ChartTimeframe {
  const raw = process.env.CHART_PRIMARY_TIMEFRAME?.trim().toUpperCase();
  if (raw === "M15" || raw === "H4" || raw === "D1") {
    return raw;
  }
  return "M15";
}

export function getConfiguredPendingOrderExpiryRuns(): number {
  const raw = process.env.PENDING_ORDER_EXPIRY_RUNS?.trim();
  if (!raw) return 2;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 2;
}

export function getConfiguredChartRunContext(): ChartRunContext {
  const override = process.env.CHART_RUN_CONTEXT?.trim().toLowerCase();
  if (override === "manual" || override === "auto") {
    return override;
  }

  const githubEventName = process.env.GITHUB_EVENT_NAME?.trim().toLowerCase();
  if (githubEventName === "schedule") {
    return "auto";
  }
  if (githubEventName === "workflow_dispatch") {
    return "manual";
  }

  return "manual";
}

function readBooleanEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

export function shouldUseLatestCacheForManualRun(): boolean {
  return readBooleanEnv("CHART_HEARTBEAT_USE_LATEST_CACHE", true);
}

export function shouldSendHeartbeatOutsideCloseWindow(): boolean {
  return readBooleanEnv("CHART_SEND_HEARTBEAT_OUTSIDE_CLOSE_WINDOW", true);
}

export function shouldSendHeartbeatOnManualRun(): boolean {
  return readBooleanEnv("CHART_SEND_HEARTBEAT_ON_MANUAL_RUN", true);
}
