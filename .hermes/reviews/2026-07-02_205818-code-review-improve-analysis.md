# Code Review: Improve Match Analysis / Verify Toggle / Chart Provenance

**Date:** 2026-07-02 20:58
**Scope:** Uncommitted changes on `main`
**Spec:** `.hermes/plans/2026-07-02_202009-improve-match-analysis-verify-toggle-chart-proof.md`

## Verification

- `npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-runner.test.ts tests/charts/analyzer.test.ts tests/shared/telegram.test.ts tests/charts/chart-config-env.test.ts` — PASS, 32 tests.
- `npm run test` — PASS, 20 files / 73 tests.
- `npm run build` — PASS, `tsc` exit code 0.
- `git diff --check` — PASS; only LF/CRLF warnings from Git on Windows.

## Summary

Implementation mostly follows the plan:

- Added `BETTING_AI_VERIFY_ENABLED` toggle and skipped betting verify/revise when disabled.
- Added `CHART_AI_VERIFY_ENABLED` helper and gated chart verification.
- Changed chart threshold consistency from `>` to `>=` in runner.
- Added chart provenance fields (`sourceCharts`, `telegramChart`) and uses them before fuzzy Telegram matching.
- Added/updated tests for key paths.

However, I found **2 correctness issues** around chart provenance matching that should be fixed before trusting the Telegram chart proof fully.

---

## Issues Requiring Fix

### 1. Valid AI setups can be dropped when the model returns a normalized pair name

**Severity:** Medium

**Location:** `src/charts/analyzer.ts:398-406`

```ts
const availableTimeframes = new Map<string, Set<string>>();
for (const screenshot of screenshots) {
  const timeframes = availableTimeframes.get(getPairName(screenshot)) ?? new Set<string>();
  timeframes.add(screenshot.chart.timeframe);
  availableTimeframes.set(getPairName(screenshot), timeframes);
}
const confluenceSetups = screenshots.every((s) => Boolean(s.chart.timeframe))
  ? setups.filter((setup) => ["D1", "H4", "M15"].every((tf) => availableTimeframes.get(setup.pair)?.has(tf)))
  : setups;
```

**Problem:**

The plan explicitly called out normalizing model-returned pair variants like `EURUSD` vs `EUR/USD`. The new provenance code added `normalizePairKey()`, but the final confluence filter still does an exact `availableTimeframes.get(setup.pair)` lookup.

If AI returns:

```json
{ "pair": "EURUSD", ... }
```

while screenshots are grouped as `EUR/USD`, the setup has valid `sourceCharts` but is filtered out before Telegram output.

**Impact:**

- The bot may report “no setup” even when AI produced a valid setup.
- This directly affects the user-facing chart analysis accuracy.

**Expected fix:**

Use a canonical/normalized pair key for `availableTimeframes`, or derive the confluence check from `setup.sourceCharts`.

Suggested shape:

```ts
const availableTimeframes = new Map<string, Set<string>>();
for (const screenshot of screenshots) {
  const key = normalizePairKey(getPairName(screenshot));
  const timeframes = availableTimeframes.get(key) ?? new Set<string>();
  timeframes.add(screenshot.chart.timeframe);
  availableTimeframes.set(key, timeframes);
}

const confluenceSetups = setups.filter((setup) => {
  const key = normalizePairKey(setup.pair);
  return ["D1", "H4", "M15"].every((tf) => availableTimeframes.get(key)?.has(tf));
});
```

Add a test where screenshots are `EUR/USD D1/H4/M15` but model returns setup pair `EURUSD`; expected setup is retained and has `sourceCharts`.

---

### 2. Provenance fallback can still choose the wrong similar symbol if filepath is missing/stale

**Severity:** Medium

**Locations:**

- `src/charts/analyzer.ts:32-58`
- `src/shared/telegram.ts:417-440`

**Problem:**

The plan required exact provenance matching before fuzzy fallback:

> First try `setup.telegramChart.filepath`, then H4 from `setup.sourceCharts` exact `symbol+timeframe+filepath`, only then fallback.

Current code mostly checks `filepath` only, then falls back to fuzzy pair matching.

In analyzer verify selection:

```ts
if (preferredFilepath) {
  const exact = screenshots.find((s) => s.filepath === preferredFilepath);
  if (exact) return exact;
}

if (preferredTimeframe) {
  const exact = screenshots.find(
    (s) =>
      s.chart.timeframe === preferredTimeframe &&
      normalizePairKey(s.chart.symbol).includes(normalizePairKey(pair)),
  );
  if (exact) return exact;
}
```

In Telegram selection:

```ts
for (const target of exactTargets) {
  const exact = screenshots.find((s) => s.filepath === target.filepath);
  if (exact) return { screenshot: exact, usedFallback: false };
}
```

If `filepath` is missing/stale or multiple screenshots are similar (`EURUSD`, `EURUSDX`, broker variants), fallback can pick the first `symbol.includes(pair)` match rather than the intended `sourceCharts` symbol/timeframe.

**Impact:**

- The verify step may verify a different chart than the one attached in `sourceCharts`.
- Telegram may still send a wrong chart in edge cases, undermining the main goal: “chart gửi Telegram đúng là chart AI đang đưa ra nhận định”.

**Expected fix:**

Add exact `symbol + timeframe` matching from provenance before fuzzy pair matching.

Suggested order:

1. `filepath + symbol + timeframe` exact if all exist.
2. `filepath` exact only if filepath is guaranteed unique in current `screenshots` batch.
3. `symbol + timeframe` exact from `telegramChart` / `sourceCharts`.
4. Fuzzy pair fallback with `usedFallback=true` warning.

Add tests for stale/missing filepath:

- `sourceCharts[0] = { symbol: "OANDA:EURUSD", timeframe: "H4", filepath: "/tmp/old.jpg" }`
- screenshots include `OANDA:EURUSDX H4` first and `OANDA:EURUSD H4` second.
- Expected: choose `OANDA:EURUSD H4`, not first fuzzy match.

---

## Notes / Minor Improvements

### A. Betting verify env test restoration is not fully clean

**Location:** `tests/betting/odds-runner.test.ts:333-370`

The test saves:

```ts
const original = process.env.BETTING_AI_VERIFY_ENABLED;
...
process.env.BETTING_AI_VERIFY_ENABLED = original;
```

If `original` was `undefined`, Node can leave `process.env.BETTING_AI_VERIFY_ENABLED` as the string `"undefined"`. This does not currently break the suite because the test is last and the parser treats it as truthy, but it is better test hygiene to restore with:

```ts
if (original === undefined) delete process.env.BETTING_AI_VERIFY_ENABLED;
else process.env.BETTING_AI_VERIFY_ENABLED = original;
```

Also add direct tests for `0`, `no`, `off` if you want to fully satisfy “tests cover env parse”.

### B. `src/charts/chart-config-env.ts` has no final newline

Build passes, but add newline at EOF to avoid small diff/check noise later.

---

## Acceptance Criteria Status

| Requirement | Status |
|---|---|
| `BETTING_AI_VERIFY_ENABLED=false` skips betting verify/revise | PASS |
| Default/unset betting verify keeps existing behavior | PASS by existing tests |
| Invalid/non-snapshot betting picks cannot appear | PASS existing guardrails |
| Telegram betting output shows verify skipped | PASS |
| `sourceCharts` metadata added to chart setups | PARTIAL — attached, but pair normalization bug can drop setups |
| Telegram prefers provenance over fuzzy matching | PARTIAL — works when filepath exact; weak when filepath missing/stale |
| Caption shows chart source filename/timeframe/symbol | PASS |
| `CHART_AI_VERIFY_ENABLED=false` gates chart verify | PASS by code/helper; no runner integration test |
| Threshold changed to `>=` | PASS |
| Full tests/build pass | PASS |

## Recommended Next Step

Fix Issues 1 and 2, then rerun:

```bash
npm run test -- tests/charts/analyzer.test.ts tests/shared/telegram.test.ts tests/charts/chart-config-env.test.ts
npm run test
npm run build
```
