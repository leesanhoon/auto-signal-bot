# Review — Subtask 10: Rewire Entrypoints and Cleanup

**Verdict:** CHANGES_REQUIRED
**Reviewer:** Lead (Sonnet 5)
**Date:** 2026-07-10

---

## Blocker status (from `blocked.md`)

The blocker recorded in `10-rewire-entrypoints-and-cleanup/blocked.md` ("missing `done.md` for subtasks 01-09") is **RESOLVED**. Verified all nine `done.md` files now exist:

```
01-db-split-tables/done.md
02-shared-data-layer-and-types/done.md
03-split-config-env/done.md
04-split-position-engine/done.md
05-split-positions-repository/done.md
06-split-chart-cache-repository/done.md
07-split-position-decision-and-check-runners/done.md
08-split-performance-report/done.md
09-split-telegram-messaging/done.md
```

Worker may proceed past the point where this blocker stopped it. This is not the reason for CHANGES_REQUIRED below — see the new issue instead.

---

## Verification performed

- `npm run build` → **PASS**, no TypeScript errors.
- `npm run test` → **FAIL**: `Test Files 2 failed | 74 passed (76)`, `Tests 7 failed | 821 passed (828)`.
- Confirmed no cross-imports between the two flows: grepped `src/charts/index.ts`, `deterministic-pipeline.ts`, `signal-assembly.ts`, `volman-charts.config.ts`, `volman-config-env.ts`, `analyzer-volman.ts` for `-smc` imports (none found), and the SMC-side files for `-volman` imports (none found). Rewiring in Steps 2/3 of task.md is correctly done.
- Confirmed Step 4 (workflow/package.json) is done: `package.json:16-17` has `performance-report` → `performance-report-runner-volman.ts` and new `performance-report:smc` → `performance-report-runner-smc.ts`. `.github/workflows/analyze.yml`/`analyze-smc.yml` call `npm run analyze`/`analyze:smc`, no direct old-file references, so no change needed there — correct.
- Confirmed Step 6 (delete old files) is **NOT done**: `src/charts/chart-types.ts`, `position-engine.ts`, `positions-repository.ts`, `chart-cache-repository.ts`, `chart-config-env.ts`, `position-decision.ts`, `check-open-trades-runner.ts`, `check-pending-orders-runner.ts`, `performance-tracking.ts`, `performance-report-runner.ts`, `charts.config.ts`, `src/shared/telegram.ts` all still exist on disk.
- Confirmed Step 7 (drop-legacy-tables migration) is **NOT done**: no `supabase/migrations/*drop_legacy*` file exists.

This matches what `result.md` itself reports ("⏳ Waiting on test passes to proceed with file deletion", "Current Progress: 99% complete").

---

## Issue 1 (blocking) — 7 failing tests must be fixed before Step 6/7 can run

Task instructions (`10-rewire-entrypoints-and-cleanup/task.md:52`, Bước 5) are explicit: **"PHẢI PASS 100% trước khi sang bước 6"**. Currently 7 tests fail, so Steps 6 and 7 (file deletion, DB cleanup migration) must not proceed yet — and the worker correctly did not attempt them. This is not a new blocker requiring escalation; it is a small, mechanical test-fix task within scope, not something requiring another subtask or Lead decision.

Root cause (verified against actual code, not just `result.md`'s claim): the new `sendAllAnalysesVolman`/`sendAllAnalysesSmc` functions (`src/shared/telegram-volman.ts:373-375`, `src/shared/telegram-smc.ts:359-361`) no longer accept/branch on a `systemLabel` field in `deliveryContext` — each function now hardcodes its own `scannerLabel` (`"Bob Volman Multi-Timeframe Scanner"` / `"SMC Multi-Timeframe Scanner"`) since there is only one system per entrypoint now. This matches `plan.md:98` / `context.md:55` ("mỗi bản chỉ còn 1 nhánh cố định, không cần branch nữa") — i.e. **dropping `systemLabel` from the call is the correct, intended behavior**, not a regression. The stale test assertions are the bug, not the code.

Failing assertions still expect a `systemLabel` key in the deliveryContext object passed to `sendAllAnalyses*`:

- `tests/charts/index.test.ts:315` — expects `systemLabel: "bob-volman"` inside an object passed somewhere (part of the "ngoài window + manual run" test, mock call assertion around line 492-498).
- `tests/charts/index.test.ts:498` — `expect(mocks.sendAllAnalyses).toHaveBeenCalledWith(MOCK_RESULT, undefined, ObjectContaining({ candleKey: ..., source: "cached", systemLabel: "bob-volman" }))` — remove `systemLabel: "bob-volman"` from the expected object (or switch to `objectContaining` without that key, matching actual call shape `{ candleKey, source }`).
- `tests/charts/smc-index.test.ts:312` — same pattern for "cache hit" test.
- `tests/charts/smc-index.test.ts:335` — same pattern for "cache miss + trong cửa sổ đóng nến" test.
- `tests/charts/smc-index.test.ts:409` — same pattern for "ngoài window + manual run + có latest cache" test.

Fix instructions:
1. In each of the 5 locations above, remove the `systemLabel: "bob-volman"` / `systemLabel: "smc"` key from the expected `deliveryContext` object passed to `toHaveBeenCalledWith(...)`.
2. Re-run `npm run test` and confirm `828/828` pass (0 failures), not just "99% / non-critical" as characterized in `result.md`. Do not weaken assertions further than removing the now-nonexistent `systemLabel` field — keep `candleKey`/`source` checks intact.
3. Update `result.md` with the new full pass/fail count.

## Issue 2 (blocking, dependent on Issue 1) — Steps 6 and 7 not executed

Once all tests pass 100%, Worker must still complete, exactly as scoped in `task.md`:
- **Step 6**: delete the 12 listed legacy files (`src/charts/chart-types.ts`, `position-engine.ts`, `positions-repository.ts`, `chart-cache-repository.ts`, `chart-config-env.ts`, `position-decision.ts`, `check-open-trades-runner.ts`, `check-pending-orders-runner.ts`, `performance-tracking.ts`, `performance-report-runner.ts`, `charts.config.ts`, `src/shared/telegram.ts`) plus their now-superseded test files under `tests/charts/`/`tests/shared/`, then re-run `npm run build && npm run test` to confirm nothing still imports the deleted files.
- **Step 7**: create `supabase/migrations/<timestamp>_drop_legacy_positions_tables.sql` with `DROP TABLE IF EXISTS open_positions, pending_orders, chart_analysis_cache;`, clearly noting in `result.md` that this is destructive and must only be applied to production after confirming task 01's data migration counts match (per `context.md`/`plan.md` R1/R2).

Note also: `src/charts/positions-repository.ts` (the old, soon-to-be-deleted file) currently has an unrelated stray edit (`git diff` shows `deriveSignalSystem` import removed and replaced inline with `setup.detectionSource === "smc" ? "smc" : "volman"`, lines around 5-116) from a prior session predating this subtask. Since this file is scheduled for deletion in Step 6, this stray edit is harmless and does not need separate remediation — just confirm it is not silently relied upon anywhere once Step 6 deletes it (it is not; grep confirms only stale imports of it remain in `signal-assembly.ts`'s old pre-rewire state, which has already been rewired away per the diff already reviewed).

---

## Non-blocking observations (no action required)

- `chart-types-smc.ts`/`chart-types-volman.ts` gained re-exports of common types (`ChartTimeframe`, `ChartOrderType`, `ChartAnalysisSource`, `ScreenshotResult`) and `chart-types-smc.ts` gained `autoTracked?`, `ruleTrace?`, `entryCondition?` fields on `TradeSetup` per `result.md`. These are additive/compat fields, not new business logic, and are consistent with `context.md:28`'s note that `PairSummary`/`PendingOrder`-adjacent fields can be shared where no business divergence exists. Acceptable.
- `analyzer-smc.ts` was newly created (not originally listed as a Step-10 output file) to give SMC its own `applyPriceSanityChecks`/`formatPrice`/etc. instead of importing the Volman-only `analyzer-volman.ts`. This is a reasonable, plan-consistent fix (avoids exactly the kind of cross-system import the plan forbids) — flagging only so the final task-level review notes it as a deviation from the original file list in `task.md`'s "Files được phép sửa/tạo", but it is in the *spirit* of the plan (full separation) and does not need to be reverted.

---

## Required next action

1. Worker (Haiku) fixes the 5 stale `systemLabel` assertions listed in Issue 1, re-runs `npm run test` to confirm 828/828 pass, and updates `result.md`.
2. Worker then completes Step 6 (delete legacy files + tests) and Step 7 (cleanup migration), re-running `npm run build && npm run test` after each step, and updates `result.md` with final evidence.
3. Bring back to Lead for final review of subtask 10 before task-level `done.md` can be written.

Do not write `10-rewire-entrypoints-and-cleanup/done.md` or the task-level `review.md`/`done.md` until Issues 1 and 2 are resolved.
