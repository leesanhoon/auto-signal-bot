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
