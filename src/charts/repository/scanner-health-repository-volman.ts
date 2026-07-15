import { getDb } from "../../shared/infra/db.js";
import { createLogger } from "../../shared/infra/logger.js";

const logger = createLogger("charts:scanner-health-repository");

const HEALTH_TABLE = "scanner_health_volman";
const ALERT_STATE_TABLE = "scanner_alert_state_volman";
const ERROR_WINDOW_MS = 2 * 60 * 60 * 1000;
const SCANNER_SOURCE = "chart-scanner";

export async function recordScannerRunOutcome(
  status: "ok" | "error",
  detail?: string,
): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;

  try {
    const { error } = await (getDb().from(HEALTH_TABLE) as any).insert({
      ts: new Date().toISOString(),
      source: SCANNER_SOURCE,
      status,
      detail: detail ?? null,
    });
    if (error) {
      logger.warn("Failed to record scanner health row", { error: error.message });
    }
  } catch (error) {
    logger.warn("Exception in recordScannerRunOutcome", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function checkAndMaybeSendErrorStreakAlert(
  sendAlert: (streakSinceIso: string) => Promise<void>,
): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;

  try {
    // 1. Find most recent 'ok' status — unbounded (not limited to 2h window)
    //    to determine when the error streak actually started.
    const { data: lastOkRows, error: lastOkError } = await (getDb().from(HEALTH_TABLE) as any)
      .select("ts")
      .eq("status", "ok")
      .order("ts", { ascending: false })
      .limit(1);
    if (lastOkError) return;

    const lastOkTs = lastOkRows && lastOkRows.length > 0 ? (lastOkRows[0].ts as string) : null;

    // 2. If most recent 'ok' is within 2h → system is healthy, don't alert.
    if (lastOkTs && Date.now() - new Date(lastOkTs).getTime() < ERROR_WINDOW_MS) return;

    // 3. Find earliest row of current error streak: oldest row after most recent 'ok'
    //    (or oldest row ever, if no 'ok' has ever occurred).
    let earliestQuery = (getDb().from(HEALTH_TABLE) as any)
      .select("ts")
      .order("ts", { ascending: true })
      .limit(1);
    if (lastOkTs) earliestQuery = earliestQuery.gt("ts", lastOkTs);
    const { data: earliestRows, error: earliestError } = await earliestQuery;
    if (earliestError || !earliestRows || earliestRows.length === 0) return;

    const streakSinceTs = earliestRows[0].ts as string;

    // 4. Only alert if error streak has ACTUALLY lasted >= 2h from this point.
    if (Date.now() - new Date(streakSinceTs).getTime() < ERROR_WINDOW_MS) return;

    // 5. Dedupe: don't re-alert if we just alerted within the last 2h.
    const { data: state } = await (getDb().from(ALERT_STATE_TABLE) as any)
      .select("last_alert_sent_at")
      .eq("id", 1)
      .maybeSingle();
    const lastAlertAt = state?.last_alert_sent_at
      ? new Date(state.last_alert_sent_at as string).getTime()
      : 0;
    if (Date.now() - lastAlertAt < ERROR_WINDOW_MS) return;

    await sendAlert(streakSinceTs);

    await (getDb().from(ALERT_STATE_TABLE) as any).upsert({
      id: 1,
      last_alert_sent_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn("Exception in checkAndMaybeSendErrorStreakAlert", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
