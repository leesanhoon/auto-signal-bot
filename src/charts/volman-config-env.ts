import type { ChartTimeframe } from "./chart-types-common.js";

// ============================================================================
// Type definitions (configuration types)
// ============================================================================

export type ChartEngineMode = "ai" | "deterministic" | "shadow";
export type ChartRunContext = "manual" | "auto";
export type ChartTimeframeMode = "multi" | "single";

// ============================================================================
// Shared helpers
// ============================================================================

function readBooleanEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

// ============================================================================
// Chart runtime configuration
// ============================================================================

export function getConfiguredChartEngineMode(): ChartEngineMode {
  return "deterministic";
}

export function getConfiguredChartTimeframeMode(): ChartTimeframeMode {
  const raw = process.env.CHART_TIMEFRAME_MODE?.trim().toLowerCase();
  if (raw === "multi" || raw === "single") {
    return raw;
  }
  return "multi";
}

export function getConfiguredChartPrimaryTimeframe(): ChartTimeframe {
  const raw = process.env.CHART_PRIMARY_TIMEFRAME?.trim().toUpperCase();
  if (raw === "M15" || raw === "H1" || raw === "H4" || raw === "D1") {
    return raw as ChartTimeframe;
  }
  return "M15";
}

export function getConfiguredChartRunContext(): ChartRunContext {
  const override = process.env.CHART_RUN_CONTEXT?.trim().toLowerCase();
  if (override === "manual" || override === "auto") {
    return override as ChartRunContext;
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

export function getConfiguredPendingOrderExpiryRuns(): number {
  const raw = process.env.PENDING_ORDER_EXPIRY_RUNS?.trim();
  if (!raw) return 2;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 2;
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

// ============================================================================
// Volman-specific configuration (only Volman entrypoint uses these)
// ============================================================================

export function getConfiguredChartSignalConfidenceThreshold(): number {
  const raw = process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD?.trim();
  if (!raw) return 70;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 70;
}

// TP mặc định theo bội số R (docs: TP = 2R), override qua env TP_R_MULTIPLE.
export function getConfiguredTpRMultiple(): number {
  const raw = process.env.TP_R_MULTIPLE?.trim();
  if (!raw) return 2;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

// Nguong % quang duong tu entry den TP1 ma gia da chay qua truoc khi tu choi
// gui tin hieu (chong "duoi gia" — xem docs/superpowers/specs/2026-07-14-signal-timing-fix-design.md).
export function getConfiguredSignalMaxEntryDistancePercent(): number {
  const raw = process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT?.trim();
  if (!raw) return 50;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : 50;
}

// ============================================================================
// EMA Exit configuration (đóng lệnh khi nến đóng cửa cắt EMA ngược hướng)
// ============================================================================

export function isEmaExitEnabled(): boolean {
  const raw = process.env.EMA_EXIT_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export function getEmaExitPeriod(): number {
  const raw = process.env.EMA_EXIT_PERIOD?.trim();
  if (!raw) return 21;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 2 ? parsed : 21;
}
