import "../shared/env.js";
import { formatFetchErrorDetails } from "../shared/fetch-diagnostics.js";
import { chromium } from "playwright";
import { getPlaywrightDiagnostics } from "../charts/setup-chart-renderer.js";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

function maskKey(value: string): string {
  if (value.length <= 8) return "[REDACTED]";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function runCheck(
  name: string,
  fn: () => Promise<string>,
): Promise<CheckResult> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (error) {
    return { name, ok: false, detail: formatFetchErrorDetails(error) };
  }
}

async function fetchJsonWithSnippet(
  url: string,
  init: RequestInit,
): Promise<string> {
  const startedAt = Date.now();
  const response = await fetch(url, init);
  const elapsedMs = Date.now() - startedAt;
  const bodyText = await response.text();
  const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 240);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${snippet ? ` | ${snippet}` : ""}`,
    );
  }

  return `HTTP ${response.status} ${response.statusText} in ${elapsedMs}ms${snippet ? ` | ${snippet}` : ""}`;
}

async function main(): Promise<void> {
  const checks: Promise<CheckResult>[] = [];
  const tdKey = process.env.TWELVEDATA_API_KEY?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_KEY?.trim();

  if (!tdKey) {
    checks.push(
      Promise.resolve({
        name: "Twelve Data",
        ok: false,
        detail: "TWELVEDATA_API_KEY chua cau hinh",
      }),
    );
  } else {
    const tdUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent("XAU/USD")}&interval=15min&outputsize=1&apikey=${encodeURIComponent(tdKey)}&timezone=UTC`;
    checks.push(
      runCheck("Twelve Data", async () => {
        const result = await fetchJsonWithSnippet(tdUrl, {
          headers: { Accept: "application/json" },
        });
        return `${result} | key=${maskKey(tdKey)}`;
      }),
    );
  }

  if (!supabaseUrl || !supabaseKey) {
    checks.push(
      Promise.resolve({
        name: "Supabase",
        ok: false,
        detail: "SUPABASE_URL hoac SUPABASE_KEY chua cau hinh",
      }),
    );
  } else {
    const normalizedBaseUrl = supabaseUrl.replace(/\/+$/, "");
    const restUrl = `${normalizedBaseUrl}/rest/v1/`;
    checks.push(
      runCheck("Supabase", async () => {
        const result = await fetchJsonWithSnippet(restUrl, {
          headers: {
            Accept: "application/json",
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });
        return `${result} | url=${normalizedBaseUrl}`;
      }),
    );
  }

  checks.push(
    runCheck("Playwright Chromium", async () => {
      try {
        const browser = await chromium.launch({
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        await browser.close();
        return `Launch OK | ${getPlaywrightDiagnostics()}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} | ${getPlaywrightDiagnostics()}`);
      }
    }),
  );

  const results = await Promise.all(checks);
  let hasFailure = false;

  console.log("=== Preflight fetch checks ===");
  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    console.log(`[${status}] ${result.name}: ${result.detail}`);
    if (!result.ok) hasFailure = true;
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[FATAL] ${formatFetchErrorDetails(error)}`);
  process.exit(1);
});
