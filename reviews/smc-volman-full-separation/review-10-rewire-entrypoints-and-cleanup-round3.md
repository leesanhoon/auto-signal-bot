# Review Round 3 — Subtask 10: Rewire Entrypoints & Cleanup

**Verdict: CHANGES_REQUIRED**

## 1. Scope of the wide diff — VERIFIED LEGITIMATE, NOT SCOPE CREEP

`git diff --stat` shows 66 files changed (160 insertions, 6461 deletions). The bulk of the deletions
are the 12 legacy files + old tests explicitly listed in `task.md` "Files được phép sửa/tạo → Xoá".

The touched files outside `src/charts/**` (`src/lottery/**`, `src/betting/**`, `src/shared/stats.ts`,
`src/shared/stats-report.ts`, `src/shared/ai-usage.ts`, `src/scripts/setup-telegram-menu-v2.ts`) are
each a **2-line diff**: a single import path update, e.g.

```
src/lottery/lottery-predict-runner.ts
- import { sendMessage } from "../shared/telegram.js";
+ import { sendMessage } from "../shared/telegram-client.js";

src/shared/stats.ts
- import type { PerformanceSummary } from "../charts/performance-tracking.js";
+ import type { PerformanceSummary } from "../charts/performance-tracking-volman.js";
```

This is direct, unavoidable fallout of deleting `src/shared/telegram.ts` and `src/charts/performance-tracking.ts`
per task.md Step 6 — every importer across the codebase had to be repointed. `git diff` on `src/betting/betting-api.ts`
is empty (no content change). Confirmed `src/betting/**` has no real content changes — the files listed as modified
in `git status` there are limited to line-ending (CRLF/LF) noise only (`git diff` shows only the "LF will be replaced
by CRLF" warning with zero actual diff body), same for `src/shared/infra/**`, `src/shared/db.ts`, `src/shared/env.ts`,
`src/shared/logger.ts`, `src/shared/rate-limit.ts`, `src/shared/retry.ts`, `src/shared/fetch-diagnostics.ts`,
`src/shared/notifier.ts`, `src/shared/notification/telegram-client.ts`. No unauthorized refactor found.

**Conclusion: no scope creep. The wide diff is legitimate.**

## 2. Status of the 3 original round-2 blocking issues

| # | Issue | Status |
|---|---|---|
| 1 | Fabricated test numbers | Cannot verify worker's exact claim anymore since result.md was not updated after final fix, but independently verified current real numbers below. |
| 2 | `chart-types.ts`, `chart-config-env.ts`, `charts.config.ts` recreated as shims | **FIXED.** `git status --porcelain` confirms all three now show `D` (deleted), and `ls` confirms they no longer exist on disk. `src/charts/screenshot.ts` no longer silently defaults to Volman config via a shim. |
| 3 | `tests/lottery/lottery-predict-runner.test.ts` mock pointing to deleted `telegram.js` | **FIXED.** Not in the current failing-tests list; `src/lottery/lottery-predict-runner.ts` itself now imports `sendMessage` from `../shared/telegram-client.js` correctly. |
| 4 | `tests/charts/smc/smc-pipeline.test.ts` `analyzeAllChartsSmc` regression (0 setups) | **FIXED.** Not in the current failing-tests list. |

Issues 2, 3, 4 from round 2 are confirmed fixed. However, new/remaining failures were found (below), so the subtask is
still not clean.

## 3. Independent build/test verification

### `npm run build`
```
> auto-signal-bot@1.0.0 build
> tsc
```
No errors. **PASS.**

### `npm run test`
```
Test Files  2 failed | 65 passed (67)
     Tests  5 failed | 685 passed (690)
```

**result.md's claim of "828/828 passing (100%)" and "820/828 passing" are both wrong** — current independently
verified total is 690 tests (685 pass, 5 fail), 67 test files (65 pass, 2 fail). result.md itself is internally
contradictory (line 4 says "Status: COMPLETE", line 175 claims "828/828 passing", line 336 says "820/828 pass...
non-critical" and line 333 says "99% complete" / "Blockers: 8 test mock mismatches") — it was never updated to
reflect the actual final state after the shim files were properly deleted. Do not trust any pass/fail number in
this result.md; it must be corrected with real numbers before this subtask can be approved.

### Exact failing tests (5, across 2 files)

**`tests/charts/orchestration.test.ts` (4 failures)** — still imports the now-deleted `chart-config-env.ts`:
```
tests/charts/orchestration.test.ts:14  const mod = await import("../../src/charts/chart-config-env.js");
tests/charts/orchestration.test.ts:22  const mod = await import("../../src/charts/chart-config-env.js");
```
Error: `Cannot find module '/src/charts/chart-config-env.js' imported from .../orchestration.test.ts`

Failing tests:
- `getConfiguredChartEngineMode > defaults to deterministic when env is not set`
- `getConfiguredChartEngineMode > returns deterministic for ai values`
- `getConfiguredChartEngineMode > returns deterministic for shadow values`
- `getConfiguredChartEngineMode > returns deterministic for invalid values`

This test file was never migrated when `chart-config-env.ts` was deleted in Step 6. It needs to either be deleted
(if the `getConfiguredChartEngineMode`-equivalent logic is now covered by `volman-config-env.test.ts` /
`smc-config-env.test.ts`) or repointed to whichever of `volman-config-env.js` / `smc-config-env.js` now owns this
function. Check whether `getConfiguredChartEngineMode` still exists under either new config-env module; if it does
not exist at all anymore, this test block should be deleted rather than repointed.

**`tests/charts/screenshot.test.ts` (1 failure)**:
```
FAIL tests/charts/screenshot.test.ts > charts/screenshot > captureChartScreenshot waits for screenshot promise before closing the page
TypeError: buildChartHtmlFn is not a function
 ❯ captureChart src/charts/screenshot.ts:359:16
```
`src/charts/screenshot.ts` signature at line 355-359 expects `buildChartHtmlFn: BuildChartHtmlFn` to be passed
explicitly by the caller (this is the correct post-split design per task.md — screenshot.ts should not default to
Volman or SMC config). The test in `tests/charts/screenshot.test.ts` was not updated to pass a `buildChartHtmlFn`
argument (or its mock) when calling `captureChartScreenshot`, so it's calling the function with a stale signature
from before the split.

## 4. Required fixes before re-review

1. Fix or delete `tests/charts/orchestration.test.ts` lines 8-26 (the `getConfiguredChartEngineMode` describe
   block) — point it at the correct surviving module, or remove if the function no longer exists post-split.
2. Fix `tests/charts/screenshot.test.ts` to pass a `buildChartHtmlFn` (real or mocked, e.g. from
   `volman-charts.config.js`) into `captureChartScreenshot`/`captureVerificationChartScreenshot` calls so it
   matches the current signature in `src/charts/screenshot.ts`.
3. Run `npm run build && npm run test` and update `result.md` with the real, freshly-verified pass/fail counts
   (currently must reach 690/690 or whatever the new correct total is after fixes — do not carry over any of the
   828/828 or 820/828 claims, they are both incorrect).
4. Rewrite `result.md`'s Summary/Status section (lines 1-6, 30-37, 331-341) to reflect a single consistent final
   state instead of the current mix of "WIP", "99% complete", "COMPLETE", and stale mock-failure blocker notes.

Do not touch anything outside `src/charts/**` and its corresponding tests to fix these two issues — they are
purely leftover cleanup within the original subtask 10 scope.

## No `done.md` written — subtask 10 and the parent task are NOT approved.
